use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct PathInfo {
    pub is_symlink: bool,
    pub is_dir: bool,
    pub is_file: bool,
    pub is_markdown: bool,
    pub canonical_path: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SymlinkTarget {
    pub logical_path: PathBuf,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum WatchMode {
    Recursive,
    NonRecursive,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct WatchPath {
    pub path: PathBuf,
    pub mode: WatchMode,
}

#[derive(Debug, Clone, Default)]
pub struct SymlinkMap {
    targets: HashMap<PathBuf, Vec<SymlinkTarget>>,
}

pub fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
}

/// Classify a filesystem path while preserving whether the path itself is a
/// symlink. Live symlinks are classified by their target metadata; broken or
/// recursive symlinks return `Ok(None)` so callers can hide them from the tree.
pub fn classify_path(path: &Path) -> io::Result<Option<PathInfo>> {
    let symlink_metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(err)
            if matches!(
                err.kind(),
                io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
            ) =>
        {
            return Ok(None);
        }
        Err(err) => return Err(err),
    };

    let is_symlink = symlink_metadata.file_type().is_symlink();
    let metadata = if is_symlink {
        match fs::metadata(path) {
            Ok(metadata) => metadata,
            Err(err)
                if matches!(
                    err.kind(),
                    io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
                ) =>
            {
                return Ok(None);
            }
            Err(err) => return Err(err),
        }
    } else {
        symlink_metadata
    };

    let canonical_path = if is_symlink {
        match fs::canonicalize(path) {
            Ok(path) => Some(path),
            Err(err)
                if matches!(
                    err.kind(),
                    io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
                ) =>
            {
                return Ok(None);
            }
            Err(err) => return Err(err),
        }
    } else {
        None
    };

    Ok(Some(PathInfo {
        is_symlink,
        is_dir: metadata.is_dir(),
        is_file: metadata.is_file(),
        is_markdown: is_markdown_path(path),
        canonical_path,
    }))
}

/// Resolve the physical destination to write. Writing through a live symlinked
/// file must preserve the symlink itself, so the atomic replace happens at the
/// resolved target path instead of at the logical link path.
pub fn write_target(path: &Path) -> io::Result<PathBuf> {
    if fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return fs::canonicalize(path);
    }

    let Some(info) = classify_path(path)? else {
        return Ok(path.to_path_buf());
    };
    if info.is_symlink && info.is_file {
        if let Some(canonical) = info.canonical_path {
            return Ok(canonical);
        }
    }
    Ok(path.to_path_buf())
}

impl SymlinkMap {
    pub fn insert(&mut self, logical_path: PathBuf, canonical_path: PathBuf, is_dir: bool) {
        let targets = self.targets.entry(canonical_path).or_default();
        if targets
            .iter()
            .any(|target| target.logical_path == logical_path && target.is_dir == is_dir)
        {
            return;
        }
        targets.push(SymlinkTarget {
            logical_path,
            is_dir,
        });
    }

    pub fn extend(&mut self, other: SymlinkMap) {
        for (canonical, targets) in other.targets {
            for target in targets {
                self.insert(target.logical_path, canonical.clone(), target.is_dir);
            }
        }
    }

    pub fn remove_logical_path(&mut self, logical_path: &Path) {
        for targets in self.targets.values_mut() {
            targets.retain(|target| target.logical_path != logical_path);
        }
        self.targets.retain(|_, targets| !targets.is_empty());
    }

    pub fn remove_logical_subtree(&mut self, logical_root: &Path) {
        for targets in self.targets.values_mut() {
            targets.retain(|target| {
                target.logical_path != logical_root
                    && !target.logical_path.starts_with(logical_root)
            });
        }
        self.targets.retain(|_, targets| !targets.is_empty());
    }

    pub fn normalize_event_path(&self, event_path: &Path, workspace_root: &Path) -> Vec<PathBuf> {
        let mut normalized = Vec::new();
        if event_path.starts_with(workspace_root) {
            normalized.push(event_path.to_path_buf());
        }

        for (canonical, targets) in &self.targets {
            for target in targets {
                let mapped = if target.is_dir {
                    let Ok(suffix) = event_path.strip_prefix(canonical) else {
                        continue;
                    };
                    if suffix.as_os_str().is_empty() {
                        target.logical_path.clone()
                    } else {
                        target.logical_path.join(suffix)
                    }
                } else {
                    if event_path != canonical {
                        continue;
                    }
                    target.logical_path.clone()
                };

                if !normalized.iter().any(|path| path == &mapped) {
                    normalized.push(mapped);
                }
            }
        }

        normalized
    }

    pub fn watch_paths(&self, workspace_root: &Path) -> Vec<WatchPath> {
        let mut paths = Vec::new();
        for (canonical, targets) in &self.targets {
            if canonical.starts_with(workspace_root) {
                continue;
            }
            let needs_recursive = targets.iter().any(|target| target.is_dir);
            if needs_recursive {
                paths.push(WatchPath {
                    path: canonical.clone(),
                    mode: WatchMode::Recursive,
                });
                if let Some(parent) = canonical.parent() {
                    paths.push(WatchPath {
                        path: parent.to_path_buf(),
                        mode: WatchMode::NonRecursive,
                    });
                }
            } else if let Some(parent) = canonical.parent() {
                paths.push(WatchPath {
                    path: parent.to_path_buf(),
                    mode: WatchMode::NonRecursive,
                });
            }
        }
        paths.sort_by(|a, b| {
            a.path
                .cmp(&b.path)
                .then((a.mode as u8).cmp(&(b.mode as u8)))
        });
        paths.dedup();
        paths
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.targets.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_external_dir_events_to_logical_paths() {
        let root = Path::new("/workspace");
        let mut map = SymlinkMap::default();
        map.insert(
            PathBuf::from("/workspace/deps/ext"),
            PathBuf::from("/outside/ext"),
            true,
        );

        assert_eq!(
            map.normalize_event_path(Path::new("/outside/ext/note.md"), root),
            vec![PathBuf::from("/workspace/deps/ext/note.md")]
        );
    }

    #[test]
    fn keeps_internal_target_and_symlink_paths() {
        let root = Path::new("/workspace");
        let mut map = SymlinkMap::default();
        map.insert(
            PathBuf::from("/workspace/links/docs"),
            PathBuf::from("/workspace/docs"),
            true,
        );

        assert_eq!(
            map.normalize_event_path(Path::new("/workspace/docs/note.md"), root),
            vec![
                PathBuf::from("/workspace/docs/note.md"),
                PathBuf::from("/workspace/links/docs/note.md")
            ]
        );
    }

    #[test]
    fn external_dir_watch_paths_include_target_and_parent() {
        let root = Path::new("/workspace");
        let mut map = SymlinkMap::default();
        map.insert(
            PathBuf::from("/workspace/links/docs"),
            PathBuf::from("/outside/docs"),
            true,
        );

        let paths = map.watch_paths(root);

        assert!(paths.contains(&WatchPath {
            path: PathBuf::from("/outside/docs"),
            mode: WatchMode::Recursive,
        }));
        assert!(paths.contains(&WatchPath {
            path: PathBuf::from("/outside"),
            mode: WatchMode::NonRecursive,
        }));
    }
}
