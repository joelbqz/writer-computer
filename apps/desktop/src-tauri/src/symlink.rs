use ignore::WalkBuilder;
use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Visible workspace symlink paired with the canonical path it points at.
///
/// `link_path` stays in the namespace the user sees in the sidebar/search
/// index. `target_path` is canonical so OS watcher events can be mapped back
/// even when a backend reports the resolved target path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SymlinkAlias {
    pub link_path: PathBuf,
    pub target_path: PathBuf,
    pub is_dir: bool,
}

/// Return metadata for `path`, following symlinks to classify the visible
/// entry by its target. Broken symlinks return the underlying IO error and are
/// treated by callers like any other unreadable path.
pub fn followed_metadata(path: &Path) -> io::Result<fs::Metadata> {
    fs::metadata(path)
}

/// Resolve the path an atomic write should replace.
///
/// For ordinary files, preserve the current behavior: write to the requested
/// path, even if it does not exist yet. For symlinks, write to the canonical
/// target so saving a note does not replace the symlink itself with a regular
/// file.
pub fn write_target_path(path: &Path) -> io::Result<PathBuf> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => path.canonicalize(),
        Ok(_) => Ok(path.to_path_buf()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(path.to_path_buf()),
        Err(err) => Err(err),
    }
}

pub fn alias_for_path(path: &Path) -> Option<SymlinkAlias> {
    let link_metadata = fs::symlink_metadata(path).ok()?;
    if !link_metadata.file_type().is_symlink() {
        return None;
    }

    let target_metadata = followed_metadata(path).ok()?;
    let is_dir = target_metadata.is_dir();
    let target_path = path.canonicalize().ok()?;

    // Directory links that point at one of their own ancestors create an alias
    // for the whole workspace (for example `loop -> .`). The index walk's
    // loop detection skips those; the watcher alias map should skip them too
    // or every root event would be mirrored under the loop path. Compare in
    // canonical space so macOS `/var` -> `/private/var` aliases don't hide the
    // ancestor relationship.
    let canonical_link_path = path
        .parent()
        .and_then(|parent| parent.canonicalize().ok())
        .and_then(|parent| path.file_name().map(|name| parent.join(name)))
        .unwrap_or_else(|| path.to_path_buf());
    if is_dir && canonical_link_path.starts_with(&target_path) {
        return None;
    }

    Some(SymlinkAlias {
        link_path: path.to_path_buf(),
        target_path,
        is_dir,
    })
}

/// Collect symlinks visible under `root` without traversing into symlinked
/// directories. The primary indexer separately follows links for content; this
/// pass only needs the alias boundary so watcher events can be translated back
/// to visible workspace paths.
pub fn collect_symlink_aliases(root: &Path) -> Vec<SymlinkAlias> {
    let mut aliases = Vec::new();
    let mut seen_links = HashSet::new();

    for result in WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .follow_links(false)
        .build()
    {
        let Ok(entry) = result else { continue };
        let path = entry.path();
        if !seen_links.insert(path.to_path_buf()) {
            continue;
        }
        if let Some(alias) = alias_for_path(path) {
            aliases.push(alias);
        }
    }

    // Longest targets first makes translation deterministic when aliases are
    // nested or overlap. We still return every matching logical path.
    aliases.sort_by_key(|alias| std::cmp::Reverse(alias.target_path.components().count()));
    aliases
}

/// Map an OS watcher event path into the logical workspace paths Writer uses.
///
/// The raw path is kept only when it is already inside the workspace root.
/// Events from supplementary watches on symlink targets are translated back to
/// each matching symlink path. Results are deduped while preserving order.
pub fn logical_paths_for_event(
    event_path: &Path,
    workspace_root: &Path,
    aliases: &[SymlinkAlias],
) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let mut seen = HashSet::new();

    if event_path.starts_with(workspace_root) {
        push_unique(&mut paths, &mut seen, event_path.to_path_buf());
    }

    for alias in aliases {
        let Ok(relative) = event_path.strip_prefix(&alias.target_path) else {
            continue;
        };
        let logical = if relative.as_os_str().is_empty() {
            alias.link_path.clone()
        } else {
            alias.link_path.join(relative)
        };
        push_unique(&mut paths, &mut seen, logical);
    }

    paths
}

fn push_unique(paths: &mut Vec<PathBuf>, seen: &mut HashSet<PathBuf>, path: PathBuf) {
    if seen.insert(path.clone()) {
        paths.push(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    use std::os::unix::fs::symlink;

    #[cfg(unix)]
    #[test]
    fn collect_symlink_aliases_records_file_and_dir_targets() {
        let root = tempfile::TempDir::new().unwrap();
        let target = tempfile::TempDir::new().unwrap();
        fs::write(target.path().join("note.md"), "# Note").unwrap();
        fs::create_dir_all(target.path().join("folder")).unwrap();

        symlink(target.path().join("note.md"), root.path().join("link.md")).unwrap();
        symlink(
            target.path().join("folder"),
            root.path().join("linked-folder"),
        )
        .unwrap();

        let aliases = collect_symlink_aliases(root.path());

        assert!(aliases.iter().any(|alias| {
            alias.link_path == root.path().join("link.md")
                && alias.target_path == target.path().join("note.md").canonicalize().unwrap()
                && !alias.is_dir
        }));
        assert!(aliases.iter().any(|alias| {
            alias.link_path == root.path().join("linked-folder")
                && alias.target_path == target.path().join("folder").canonicalize().unwrap()
                && alias.is_dir
        }));
    }

    #[test]
    fn logical_paths_include_root_path_and_symlink_alias() {
        let root = PathBuf::from("/workspace");
        let aliases = vec![SymlinkAlias {
            link_path: root.join("linked"),
            target_path: root.join("real"),
            is_dir: true,
        }];

        let paths = logical_paths_for_event(&root.join("real/note.md"), &root, &aliases);

        assert_eq!(
            paths,
            vec![root.join("real/note.md"), root.join("linked/note.md")]
        );
    }

    #[test]
    fn logical_paths_translate_external_target_to_visible_link_path() {
        let root = PathBuf::from("/workspace");
        let target = PathBuf::from("/external/notes");
        let aliases = vec![SymlinkAlias {
            link_path: root.join("linked"),
            target_path: target.clone(),
            is_dir: true,
        }];

        let paths = logical_paths_for_event(&target.join("nested/note.md"), &root, &aliases);

        assert_eq!(paths, vec![root.join("linked/nested/note.md")]);
    }

    #[cfg(unix)]
    #[test]
    fn write_target_path_resolves_symlink_without_resolving_regular_files() {
        let root = tempfile::TempDir::new().unwrap();
        let target = tempfile::TempDir::new().unwrap();
        let real = target.path().join("note.md");
        let link = root.path().join("link.md");
        fs::write(&real, "# Note").unwrap();
        symlink(&real, &link).unwrap();

        assert_eq!(
            write_target_path(&link).unwrap(),
            real.canonicalize().unwrap()
        );
        assert_eq!(write_target_path(&real).unwrap(), real);
    }

    #[cfg(unix)]
    #[test]
    fn collect_symlink_aliases_skips_directory_links_to_ancestors() {
        let root = tempfile::TempDir::new().unwrap();
        symlink(root.path(), root.path().join("loop")).unwrap();

        let aliases = collect_symlink_aliases(root.path());

        assert!(aliases.is_empty());
    }
}
