use ignore::gitignore::Gitignore;
use std::path::{Path, PathBuf};

/// A single `.gitignore` file paired with its scope (the directory it lives in).
/// Rules only apply to paths inside the scope.
struct ScopedGitignore {
    scope: PathBuf,
    matcher: Gitignore,
}

/// Per-workspace gitignore matcher built from all `.gitignore` files found
/// below the workspace root.
///
/// Each discovered `.gitignore` is kept as an independent `Gitignore` matcher
/// rooted at its own containing directory. This is critical: a nested file
/// like `.vite-hooks/_/.gitignore` containing just `*` must only hide files
/// inside `.vite-hooks/_/`, not every file in the workspace. (The previous
/// implementation added every file to a single builder rooted at the workspace
/// root, which re-scoped `*` to `**/*` and hid the entire tree.)
///
/// The matcher is rebuilt whenever a `.gitignore` file changes (or is created
/// / removed). Querying is a pure function of the collected state, so it is
/// safe to share the matcher across threads behind an `Arc`.
pub struct WorkspaceIgnore {
    /// Collected gitignores, sorted deepest-scope first so that nested rules
    /// take precedence over shallower ones (matching git's own behavior).
    gitignores: Vec<ScopedGitignore>,
}

impl WorkspaceIgnore {
    /// Bootstrap matcher with no collected `.gitignore` rules — only the
    /// hardcoded `node_modules` / `.git` safety net applies. Used as a
    /// near-instant placeholder while `load` runs on a background thread so
    /// the IPC thread never blocks on workspace open.
    pub fn bootstrap() -> Self {
        Self {
            gitignores: Vec::new(),
        }
    }

    /// Build a matcher for the workspace at `root`.
    ///
    /// Walks directories (not files) with `git_ignore(true)` so build-artifact
    /// subtrees like `target/`, `dist/`, `node_modules/` are skipped using
    /// their parent's existing `.gitignore` rules — on a real Rust/Node repo
    /// this cuts the walk from ~50k entries to a few hundred. `.git` and
    /// `node_modules` are filtered explicitly as a safety net.
    ///
    /// For each visited directory, we probe for `.gitignore` via a direct
    /// stat rather than relying on the walker to report it. The walker with
    /// `git_ignore(true)` applies nested rules eagerly — a `.gitignore`
    /// containing just `*` would otherwise hide itself from the walker, so
    /// we'd never see it. Probing sidesteps that entirely.
    pub fn load(root: &Path) -> Self {
        let walker = ignore::WalkBuilder::new(root)
            .hidden(false)
            .git_ignore(true)
            .require_git(false)
            .git_global(false)
            .git_exclude(false)
            .parents(false)
            .follow_links(true)
            .filter_entry(|entry| {
                let name = entry.file_name().to_string_lossy();
                name != ".git" && name != "node_modules"
            })
            .build();

        let mut gitignores: Vec<ScopedGitignore> = Vec::new();
        for result in walker {
            let Ok(entry) = result else { continue };
            if !entry.file_type().is_some_and(|ft| ft.is_dir()) {
                continue;
            }
            let dir = entry.path();
            let candidate = dir.join(".gitignore");
            if !candidate.is_file() {
                continue;
            }
            // `Gitignore::new` returns `(Gitignore, Option<Error>)`; swallow
            // errors from a single file so one malformed `.gitignore` doesn't
            // break the whole matcher.
            let (matcher, _err) = Gitignore::new(&candidate);
            gitignores.push(ScopedGitignore {
                scope: dir.to_path_buf(),
                matcher,
            });
        }

        // Deepest scope first — a nested `.gitignore` gets to decide before
        // anything shallower does, including whitelist rules.
        gitignores.sort_by_key(|s| std::cmp::Reverse(s.scope.components().count()));

        Self { gitignores }
    }

    /// Check whether `path` should be hidden from the sidebar, watcher, and
    /// search.
    ///
    /// Returns `true` for:
    /// - `node_modules` or `.git` segments anywhere in the path (safety net)
    /// - paths matched by any collected `.gitignore` rule, with deeper files
    ///   taking precedence over shallower ones
    pub fn is_ignored(&self, path: &Path, is_dir: bool) -> bool {
        if path_has_safety_component(path) {
            return true;
        }
        for scoped in &self.gitignores {
            if !path.starts_with(&scoped.scope) {
                continue;
            }
            match scoped.matcher.matched_path_or_any_parents(path, is_dir) {
                ignore::Match::Ignore(_) => return true,
                ignore::Match::Whitelist(_) => return false,
                ignore::Match::None => {}
            }
        }
        false
    }
}

fn path_has_safety_component(path: &Path) -> bool {
    path.components().any(|c| {
        let name = c.as_os_str();
        name == "node_modules" || name == ".git"
    })
}

/// True if `path` is (or is named) a `.gitignore` file. Watcher uses this to
/// decide whether to rebuild the matcher on a file change.
pub fn is_gitignore_path(path: &Path) -> bool {
    path.file_name().is_some_and(|n| n == ".gitignore")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::symlink;
    use tempfile::TempDir;

    fn touch(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    #[test]
    fn node_modules_is_always_ignored() {
        let dir = TempDir::new().unwrap();
        let ignore = WorkspaceIgnore::load(dir.path());
        assert!(ignore.is_ignored(&dir.path().join("node_modules"), true));
        assert!(ignore.is_ignored(&dir.path().join("node_modules").join("foo.md"), false));
    }

    #[test]
    fn bootstrap_enforces_only_the_safety_net() {
        // The bootstrap matcher must hide `node_modules` / `.git` (so the very
        // first sidebar read isn't polluted by them) but must not hide any
        // custom rules — those take effect once `load` completes and the full
        // matcher replaces the bootstrap one.
        let dir = TempDir::new().unwrap();
        let ignore = WorkspaceIgnore::bootstrap();

        assert!(ignore.is_ignored(&dir.path().join("node_modules"), true));
        assert!(ignore.is_ignored(&dir.path().join(".git").join("HEAD"), false));
        // A path that a custom `.gitignore` would hide is still visible to
        // the bootstrap matcher.
        assert!(!ignore.is_ignored(&dir.path().join("drafts"), true));
        assert!(!ignore.is_ignored(&dir.path().join("readme.md"), false));
    }

    #[test]
    fn git_dir_is_always_ignored() {
        let dir = TempDir::new().unwrap();
        let ignore = WorkspaceIgnore::load(dir.path());
        assert!(ignore.is_ignored(&dir.path().join(".git").join("HEAD"), false));
    }

    #[test]
    fn root_gitignore_is_applied() {
        let dir = TempDir::new().unwrap();
        touch(&dir.path().join(".gitignore"), "dist/\n*.log\n");
        touch(&dir.path().join("readme.md"), "# Readme");

        let ignore = WorkspaceIgnore::load(dir.path());

        assert!(ignore.is_ignored(&dir.path().join("dist"), true));
        assert!(ignore.is_ignored(&dir.path().join("dist").join("bundle.js"), false));
        assert!(ignore.is_ignored(&dir.path().join("error.log"), false));
        assert!(!ignore.is_ignored(&dir.path().join("readme.md"), false));
    }

    #[test]
    fn nested_star_rule_stays_scoped_to_its_directory() {
        // Regression test: a nested `.gitignore` containing just `*` (common
        // in git hook / tooling dirs) must only hide files inside its own
        // directory, not every file in the workspace.
        let dir = TempDir::new().unwrap();
        touch(
            &dir.path().join(".vite-hooks").join("_").join(".gitignore"),
            "*\n",
        );
        touch(&dir.path().join("readme.md"), "# Readme");
        touch(&dir.path().join("docs").join("guide.md"), "# Guide");
        touch(
            &dir.path().join(".vite-hooks").join("_").join("hook.sh"),
            "#!/bin/sh",
        );

        let ignore = WorkspaceIgnore::load(dir.path());

        // Top-level files and directories must stay visible.
        assert!(!ignore.is_ignored(&dir.path().join("readme.md"), false));
        assert!(!ignore.is_ignored(&dir.path().join("docs"), true));
        assert!(!ignore.is_ignored(&dir.path().join("docs").join("guide.md"), false));
        // The nested `*` rule still applies within its own scope.
        assert!(ignore.is_ignored(
            &dir.path().join(".vite-hooks").join("_").join("hook.sh"),
            false
        ));
    }

    #[test]
    fn nested_gitignore_is_applied() {
        let dir = TempDir::new().unwrap();
        touch(&dir.path().join(".gitignore"), "# empty\n");
        touch(&dir.path().join("docs").join(".gitignore"), "drafts/\n");
        touch(
            &dir.path().join("docs").join("drafts").join("wip.md"),
            "# wip",
        );
        touch(&dir.path().join("docs").join("final.md"), "# final");

        let ignore = WorkspaceIgnore::load(dir.path());

        assert!(ignore.is_ignored(&dir.path().join("docs").join("drafts"), true));
        assert!(ignore.is_ignored(
            &dir.path().join("docs").join("drafts").join("wip.md"),
            false
        ));
        assert!(!ignore.is_ignored(&dir.path().join("docs").join("final.md"), false));
    }

    #[cfg(unix)]
    #[test]
    fn gitignore_inside_symlinked_directory_is_applied_to_link_path() {
        let dir = TempDir::new().unwrap();
        let target = TempDir::new().unwrap();
        touch(&target.path().join(".gitignore"), "drafts/\n");
        touch(&target.path().join("drafts").join("wip.md"), "# wip");
        touch(&target.path().join("final.md"), "# final");
        symlink(target.path(), dir.path().join("linked")).unwrap();

        let ignore = WorkspaceIgnore::load(dir.path());

        assert!(ignore.is_ignored(&dir.path().join("linked/drafts"), true));
        assert!(ignore.is_ignored(&dir.path().join("linked/drafts/wip.md"), false));
        assert!(!ignore.is_ignored(&dir.path().join("linked/final.md"), false));
    }

    #[test]
    fn gitignore_file_itself_stays_visible() {
        let dir = TempDir::new().unwrap();
        touch(&dir.path().join(".gitignore"), "dist/\n");

        let ignore = WorkspaceIgnore::load(dir.path());
        assert!(!ignore.is_ignored(&dir.path().join(".gitignore"), false));
    }

    #[test]
    fn unignored_paths_return_false() {
        let dir = TempDir::new().unwrap();
        touch(&dir.path().join("notes").join("hello.md"), "# hi");
        touch(&dir.path().join(".gitignore"), "dist/\n");

        let ignore = WorkspaceIgnore::load(dir.path());
        assert!(!ignore.is_ignored(&dir.path().join("notes"), true));
        assert!(!ignore.is_ignored(&dir.path().join("notes").join("hello.md"), false));
    }

    #[test]
    fn is_gitignore_path_matches_filename() {
        assert!(is_gitignore_path(Path::new("/a/b/.gitignore")));
        assert!(is_gitignore_path(Path::new(".gitignore")));
        assert!(!is_gitignore_path(Path::new("/a/b/gitignore.txt")));
        assert!(!is_gitignore_path(Path::new("/a/b/.gitignore.bak")));
    }
}
