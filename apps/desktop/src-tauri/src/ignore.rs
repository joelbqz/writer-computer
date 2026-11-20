use crate::config::{default_settings, ConfigValue, Settings};
use ignore::gitignore::Gitignore;
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

/// Settings key for the always-hidden list. See [`FileExcludes`].
pub const FILES_EXCLUDE_KEY: &str = "files.exclude";

/// The `files.exclude` setting compiled for matching.
///
/// Each entry is a path made of one or more names separated by `/`. A path
/// inside the workspace is excluded when its names, read from the workspace
/// root, contain the entry's names as a consecutive run. So `node_modules`
/// hides every folder or file named `node_modules` at any depth, and
/// `.claude/worktrees` hides any `worktrees` folder directly inside a
/// `.claude` folder, at any depth. Matching is exact and case-sensitive; no
/// wildcards. Leading and trailing `/` are ignored. Anything more specific
/// belongs in a `.gitignore`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileExcludes {
    /// Entries as the user wrote them; compared to detect a settings change.
    entries: Vec<String>,
    /// Entries reduced to their name components. Empty entries are dropped.
    patterns: Vec<PathBuf>,
}

impl FileExcludes {
    pub fn new(entries: Vec<String>) -> Self {
        let patterns = entries
            .iter()
            .map(|entry| {
                Path::new(entry.trim())
                    .components()
                    .filter(|c| matches!(c, Component::Normal(_)))
                    .collect::<PathBuf>()
            })
            .filter(|pattern| !pattern.as_os_str().is_empty())
            .collect();
        Self { entries, patterns }
    }

    /// The `files.exclude` value from the merged settings, or the schema
    /// default when no settings layer is loaded.
    pub fn from_settings(settings: Option<&Settings>) -> Self {
        let value = match settings {
            Some(settings) => settings.get(FILES_EXCLUDE_KEY).cloned(),
            None => default_settings().remove(FILES_EXCLUDE_KEY),
        };
        match value {
            Some(ConfigValue::List(entries)) => Self::new(entries),
            // The config parser always reads this key as a list, so this
            // only happens if an IPC write stored another type.
            other => {
                eprintln!("{FILES_EXCLUDE_KEY} must be a list, got {other:?}; using the default");
                Self::from_settings(None)
            }
        }
    }

    /// True if `relative` (a path relative to the workspace root) ends with
    /// one of the patterns. Callers that walk top-down and never descend into
    /// an excluded folder only need this check on each new entry.
    fn excludes_leaf(&self, relative: &Path) -> bool {
        self.patterns
            .iter()
            .any(|pattern| relative.ends_with(pattern))
    }

    /// True if `relative` or any of its ancestors ends with a pattern.
    fn excludes(&self, relative: &Path) -> bool {
        relative
            .ancestors()
            .any(|ancestor| self.excludes_leaf(ancestor))
    }
}

/// The single decision of which workspace paths Writer hides: the sidebar,
/// file watcher, quick open index and wiki-embed lookup all ask this matcher
/// and nothing else. Dotfiles and dot folders are not special; a path is
/// hidden when it is
///
/// - in the `files.exclude` list ([`FileExcludes`]), or
/// - matched by a `.gitignore` inside the workspace. Every `.gitignore` is
///   honored whether or not the workspace is a git repository; the global
///   gitignore and `.git/info/exclude` are not read.
///
/// Each discovered `.gitignore` is kept as an independent `Gitignore` matcher
/// rooted at its own containing directory (its scope). This is critical: a nested file
/// like `.vite-hooks/_/.gitignore` containing just `*` must only hide files
/// inside `.vite-hooks/_/`, not every file in the workspace. (The previous
/// implementation added every file to a single builder rooted at the workspace
/// root, which re-scoped `*` to `**/*` and hid the entire tree.)
///
/// Paths outside `root` are never hidden: the exclusion list and every
/// `.gitignore` scope are relative to the workspace.
///
/// The matcher is rebuilt whenever a `.gitignore` file or the `files.exclude`
/// setting changes. Querying is a pure function of the collected state, so it
/// is safe to share the matcher across threads behind an `Arc`.
pub struct WorkspaceIgnore {
    root: PathBuf,
    excludes: FileExcludes,
    /// Collected gitignores keyed by scope. A path consults the matchers of
    /// its ancestors deepest first, so nested rules take precedence over
    /// shallower ones (matching git's own behavior), at one hash lookup per
    /// ancestor however many `.gitignore` files the workspace has.
    gitignores: HashMap<PathBuf, Gitignore>,
    /// False for the bootstrap matcher, whose `.gitignore` rules aren't
    /// loaded yet.
    gitignores_loaded: bool,
}

impl WorkspaceIgnore {
    /// Bootstrap matcher with no collected `.gitignore` rules — only the
    /// exclusion list applies. Used as a near-instant placeholder while
    /// `load` runs on a background thread so the IPC thread never blocks on
    /// workspace open.
    pub fn bootstrap(root: &Path, excludes: FileExcludes) -> Self {
        Self {
            root: root.to_path_buf(),
            excludes,
            gitignores: HashMap::new(),
            gitignores_loaded: false,
        }
    }

    /// Build a matcher for the workspace at `root`.
    ///
    /// Walks directories (not files) with `git_ignore(true)` so build-artifact
    /// subtrees like `target/`, `dist/` are skipped using their parent's
    /// existing `.gitignore` rules — on a real Rust/Node repo this cuts the
    /// walk from ~50k entries to a few hundred. Excluded paths are skipped
    /// too.
    ///
    /// For each visited directory, we probe for `.gitignore` via a direct
    /// stat rather than relying on the walker to report it. The walker with
    /// `git_ignore(true)` applies nested rules eagerly — a `.gitignore`
    /// containing just `*` would otherwise hide itself from the walker, so
    /// we'd never see it. Probing sidesteps that entirely.
    pub fn load(root: &Path, excludes: FileExcludes) -> Self {
        let walk_root = root.to_path_buf();
        let walk_excludes = excludes.clone();
        let walker = ignore::WalkBuilder::new(root)
            .hidden(false)
            .git_ignore(true)
            .require_git(false)
            .git_global(false)
            .git_exclude(false)
            .parents(false)
            .filter_entry(move |entry| {
                entry
                    .path()
                    .strip_prefix(&walk_root)
                    .map_or(true, |relative| !walk_excludes.excludes_leaf(relative))
            })
            .build();

        let mut gitignores = HashMap::new();
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
            gitignores.insert(dir.to_path_buf(), matcher);
        }

        Self {
            root: root.to_path_buf(),
            excludes,
            gitignores,
            gitignores_loaded: true,
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// False for a [`Self::bootstrap`] matcher. Walks that can't wait for
    /// the background load use this to load their own full matcher.
    pub fn gitignores_loaded(&self) -> bool {
        self.gitignores_loaded
    }

    /// True if `path` is hidden by the exclusion list alone. Needs no stat,
    /// so the watcher uses it to drop `.git` churn before anything else.
    pub fn is_excluded(&self, path: &Path) -> bool {
        path.strip_prefix(&self.root)
            .is_ok_and(|relative| self.excludes.excludes(relative))
    }

    /// Check whether `path` should be hidden from the sidebar, watcher, and
    /// search. Checks `path` and every ancestor up to the workspace root.
    pub fn is_ignored(&self, path: &Path, is_dir: bool) -> bool {
        let Ok(relative) = path.strip_prefix(&self.root) else {
            return false;
        };
        self.excludes.excludes(relative) || self.gitignored(path, is_dir, true)
    }

    /// [`Self::is_ignored`] for a top-down walk that never descends into a
    /// hidden folder: ancestors are known to be visible, so only `path`
    /// itself is checked. Saves a parent walk per entry on large trees.
    pub fn is_ignored_in_walk(&self, path: &Path, is_dir: bool) -> bool {
        let Ok(relative) = path.strip_prefix(&self.root) else {
            return false;
        };
        self.excludes.excludes_leaf(relative) || self.gitignored(path, is_dir, false)
    }

    fn gitignored(&self, path: &Path, is_dir: bool, check_parents: bool) -> bool {
        if self.gitignores.is_empty() {
            return false;
        }
        // A folder's own `.gitignore` never matches the folder itself, so
        // scopes start at the parent. Ancestors come deepest first.
        let scopes = path
            .ancestors()
            .skip(1)
            .take_while(|scope| scope.starts_with(&self.root));
        for scope in scopes {
            let Some(matcher) = self.gitignores.get(scope) else {
                continue;
            };
            let matched = if check_parents {
                matcher.matched_path_or_any_parents(path, is_dir)
            } else {
                matcher.matched(path, is_dir)
            };
            match matched {
                ignore::Match::Ignore(_) => return true,
                ignore::Match::Whitelist(_) => return false,
                ignore::Match::None => {}
            }
        }
        false
    }
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
    use tempfile::TempDir;

    fn defaults() -> FileExcludes {
        FileExcludes::from_settings(None)
    }

    fn touch(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    #[test]
    fn node_modules_is_ignored_by_default() {
        let dir = TempDir::new().unwrap();
        let ignore = WorkspaceIgnore::load(dir.path(), defaults());
        assert!(ignore.is_ignored(&dir.path().join("node_modules"), true));
        assert!(ignore.is_ignored(&dir.path().join("node_modules").join("foo.md"), false));
    }

    #[test]
    fn bootstrap_enforces_only_the_exclusion_list() {
        // The bootstrap matcher must hide excluded paths (so the very first
        // sidebar read isn't polluted by `.git` or `.trash`) but must not hide
        // any `.gitignore` rules — those take effect once `load` completes and
        // the full matcher replaces the bootstrap one.
        let dir = TempDir::new().unwrap();
        touch(&dir.path().join(".gitignore"), "drafts/\n");
        let ignore = WorkspaceIgnore::bootstrap(dir.path(), defaults());
        assert!(!ignore.gitignores_loaded());
        assert!(WorkspaceIgnore::load(dir.path(), defaults()).gitignores_loaded());

        assert!(ignore.is_ignored(&dir.path().join("node_modules"), true));
        assert!(ignore.is_ignored(&dir.path().join(".git").join("HEAD"), false));
        assert!(ignore.is_ignored(&dir.path().join(".trash").join("old.md"), false));
        assert!(!ignore.is_ignored(&dir.path().join("drafts"), true));
        assert!(!ignore.is_ignored(&dir.path().join("readme.md"), false));
    }

    #[test]
    fn git_dir_is_ignored_by_default() {
        let dir = TempDir::new().unwrap();
        let ignore = WorkspaceIgnore::load(dir.path(), defaults());
        assert!(ignore.is_ignored(&dir.path().join(".git").join("HEAD"), false));
    }

    #[test]
    fn root_gitignore_is_applied() {
        let dir = TempDir::new().unwrap();
        touch(&dir.path().join(".gitignore"), "dist/\n*.log\n");
        touch(&dir.path().join("readme.md"), "# Readme");

        let ignore = WorkspaceIgnore::load(dir.path(), defaults());

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

        let ignore = WorkspaceIgnore::load(dir.path(), defaults());

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

        let ignore = WorkspaceIgnore::load(dir.path(), defaults());

        assert!(ignore.is_ignored(&dir.path().join("docs").join("drafts"), true));
        assert!(ignore.is_ignored(
            &dir.path().join("docs").join("drafts").join("wip.md"),
            false
        ));
        assert!(!ignore.is_ignored(&dir.path().join("docs").join("final.md"), false));
    }

    #[test]
    fn deeper_gitignore_whitelist_beats_a_shallower_rule() {
        let dir = TempDir::new().unwrap();
        touch(&dir.path().join(".gitignore"), "*.draft.md\n");
        touch(&dir.path().join("docs/.gitignore"), "!keep.draft.md\n");

        let ignore = WorkspaceIgnore::load(dir.path(), defaults());
        let docs = dir.path().join("docs");
        assert!(!ignore.is_ignored(&docs.join("keep.draft.md"), false));
        assert!(!ignore.is_ignored_in_walk(&docs.join("keep.draft.md"), false));
        assert!(ignore.is_ignored(&docs.join("other.draft.md"), false));
        assert!(ignore.is_ignored(&dir.path().join("top.draft.md"), false));
    }

    #[test]
    fn gitignore_file_itself_stays_visible() {
        let dir = TempDir::new().unwrap();
        touch(&dir.path().join(".gitignore"), "dist/\n");

        let ignore = WorkspaceIgnore::load(dir.path(), defaults());
        assert!(!ignore.is_ignored(&dir.path().join(".gitignore"), false));
    }

    #[test]
    fn unignored_paths_return_false() {
        let dir = TempDir::new().unwrap();
        touch(&dir.path().join("notes").join("hello.md"), "# hi");
        touch(&dir.path().join(".gitignore"), "dist/\n");

        let ignore = WorkspaceIgnore::load(dir.path(), defaults());
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

    #[test]
    fn default_excludes_are_the_documented_list() {
        assert_eq!(
            defaults(),
            FileExcludes::new(
                [
                    ".git",
                    ".hg",
                    ".svn",
                    ".jj",
                    "node_modules",
                    ".DS_Store",
                    ".trash",
                    ".claude/worktrees",
                ]
                .map(String::from)
                .to_vec()
            )
        );
    }

    #[test]
    fn dotfiles_and_dot_folders_are_visible() {
        let dir = TempDir::new().unwrap();
        let ignore = WorkspaceIgnore::load(dir.path(), defaults());
        let skill = dir.path().join(".claude/skills/demo/SKILL.md");
        assert!(!ignore.is_ignored(&dir.path().join(".claude"), true));
        assert!(!ignore.is_ignored(&skill, false));
        assert!(!ignore.is_ignored_in_walk(&skill, false));
        assert!(!ignore.is_ignored(&dir.path().join(".agents/skills/x/SKILL.md"), false));
        assert!(!ignore.is_ignored(&dir.path().join(".github"), true));
        assert!(!ignore.is_ignored(&dir.path().join(".writer/config"), false));
    }

    #[test]
    fn default_excludes_hide_trash_and_claude_worktrees_at_any_depth() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        let ignore = WorkspaceIgnore::load(root, defaults());
        assert!(ignore.is_ignored(&root.join(".trash"), true));
        assert!(ignore.is_ignored(&root.join(".trash/old.md"), false));
        assert!(ignore.is_ignored(&root.join(".DS_Store"), false));
        assert!(ignore.is_ignored(&root.join("notes/.DS_Store"), false));
        assert!(ignore.is_ignored(&root.join(".claude/worktrees"), true));
        assert!(ignore.is_ignored(&root.join(".claude/worktrees/x/README.md"), false));
        assert!(ignore.is_ignored(&root.join("repo/.claude/worktrees/y/a.md"), false));
        assert!(ignore.is_ignored(&root.join(".jj/repo/store"), true));
        // Only the consecutive run counts: a `worktrees` folder elsewhere and
        // a name that merely starts with an entry stay visible.
        assert!(!ignore.is_ignored(&root.join("worktrees/a.md"), false));
        assert!(!ignore.is_ignored(&root.join(".claude/other/worktrees.md"), false));
        assert!(!ignore.is_ignored(&root.join(".trash-notes/a.md"), false));
        // The walk check sees the excluded folder itself.
        assert!(ignore.is_ignored_in_walk(&root.join(".claude/worktrees"), true));
        assert!(!ignore.is_ignored_in_walk(&root.join(".claude"), true));
    }

    #[test]
    fn exclusion_list_is_relative_to_the_workspace_root() {
        // A workspace that itself lives inside an excluded name (or a dotdir)
        // must not hide its own contents.
        let dir = TempDir::new().unwrap();
        let root = dir.path().join(".trash").join("vault");
        fs::create_dir_all(&root).unwrap();
        let ignore = WorkspaceIgnore::load(&root, defaults());
        assert!(!ignore.is_ignored(&root.join("note.md"), false));
        assert!(!ignore.is_excluded(&root.join("note.md")));
        assert!(ignore.is_excluded(&root.join(".git/HEAD")));
        // Paths outside the workspace are never hidden.
        assert!(!ignore.is_ignored(&dir.path().join(".git/HEAD"), false));
    }

    #[test]
    fn gitignored_dot_folder_is_hidden() {
        let dir = TempDir::new().unwrap();
        touch(&dir.path().join(".gitignore"), ".cache/\n");
        let ignore = WorkspaceIgnore::load(dir.path(), defaults());
        assert!(ignore.is_ignored(&dir.path().join(".cache"), true));
        assert!(ignore.is_ignored(&dir.path().join(".cache/notes.md"), false));
        assert!(ignore.is_ignored_in_walk(&dir.path().join(".cache"), true));
        assert!(!ignore.is_ignored(&dir.path().join(".claude"), true));
    }

    #[test]
    fn user_excludes_replace_the_default_list() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        let excludes = FileExcludes::new(vec!["/archive/".into(), " ".into(), "a/b".into()]);
        let ignore = WorkspaceIgnore::load(root, excludes);
        assert!(ignore.is_ignored(&root.join("archive/old.md"), false));
        assert!(ignore.is_ignored(&root.join("x/a/b/c.md"), false));
        assert!(!ignore.is_ignored(&root.join("a/c.md"), false));
        // Defaults no longer apply once the list is overridden.
        assert!(!ignore.is_ignored(&root.join(".trash/old.md"), false));
        assert!(!ignore.is_ignored(&root.join(".claude/worktrees/x.md"), false));
    }

    #[test]
    fn load_skips_gitignores_inside_excluded_folders() {
        // A `.gitignore` inside an excluded folder must not leak rules into
        // the rest of the workspace (and the folder isn't walked at all).
        let dir = TempDir::new().unwrap();
        touch(&dir.path().join(".trash/.gitignore"), "*.md\n");
        touch(&dir.path().join("note.md"), "# note");
        let ignore = WorkspaceIgnore::load(dir.path(), defaults());
        assert!(ignore.gitignores.is_empty());
        assert!(!ignore.is_ignored(&dir.path().join("note.md"), false));
    }

    #[test]
    fn from_settings_reads_a_single_config_line_as_a_list() {
        let config_dir = TempDir::new().unwrap();
        fs::write(config_dir.path().join("config"), "files.exclude = drafts\n").unwrap();
        let settings = Settings::new(config_dir.path().to_path_buf()).unwrap();
        assert_eq!(
            FileExcludes::from_settings(Some(&settings)),
            FileExcludes::new(vec!["drafts".into()])
        );
    }
}
