//! Shared path → open-payload resolution used by both the Tauri runtime
//! (drag-drop, single-instance argv, RunEvent::Opened) and the standalone
//! `writer` CLI launcher.
//!
//! The two callers want slightly different error behavior:
//!
//! - Drag-drop silently ignores unsupported paths, because the source event
//!   may contain several paths and the user expects only the first valid one
//!   to open. Use [`resolve_path`].
//! - The CLI needs to surface a clear failure message to the shell when the
//!   path is missing or unsupported. Use [`validate_and_resolve`].
//!
//! Both paths share one canonicalization + classification routine so the two
//! entry surfaces can never drift.

use serde::Serialize;
use std::path::{Path, PathBuf};

/// Payload emitted to the frontend when a folder or file is opened via
/// drag-drop, CLI arguments, or the single-instance plugin.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PendingOpenPayload {
    pub workspace: String,
    pub file: Option<String>,
}

/// Reasons [`validate_and_resolve`] can fail. Each variant maps 1:1 to the
/// CLI's user-facing error message.
#[derive(Debug)]
pub enum OpenTargetError {
    NotFound(PathBuf),
    Unsupported(PathBuf),
    Io(std::io::Error),
}

impl std::fmt::Display for OpenTargetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound(p) => write!(f, "path does not exist: {}", p.display()),
            Self::Unsupported(p) => write!(f, "not a directory or markdown file: {}", p.display()),
            Self::Io(err) => write!(f, "{err}"),
        }
    }
}

impl std::error::Error for OpenTargetError {}

/// Lenient variant used by drag-drop and RunEvent::Opened. Returns `None`
/// for anything that isn't a directory or a markdown file, matching the
/// original `resolve_dropped_path` behavior.
pub fn resolve_path(path: &Path) -> Option<PendingOpenPayload> {
    classify(path).ok()
}

/// Strict variant used by the CLI. Produces a typed error the caller can
/// turn into a stderr message.
pub fn validate_and_resolve(path: &Path) -> Result<PendingOpenPayload, OpenTargetError> {
    if !path.exists() {
        return Err(OpenTargetError::NotFound(path.to_path_buf()));
    }
    classify(path)
}

/// Core classification shared by both entry points.
fn classify(path: &Path) -> Result<PendingOpenPayload, OpenTargetError> {
    let metadata = path.metadata().map_err(OpenTargetError::Io)?;

    if metadata.is_dir() {
        let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        return Ok(PendingOpenPayload {
            workspace: canonical.to_string_lossy().to_string(),
            file: None,
        });
    }

    if metadata.is_file() && is_markdown(path) {
        let parent = path
            .parent()
            .ok_or_else(|| OpenTargetError::Unsupported(path.to_path_buf()))?;
        let canonical_parent = parent
            .canonicalize()
            .unwrap_or_else(|_| parent.to_path_buf());
        let file_path = visible_file_path(path, &canonical_parent);
        return Ok(PendingOpenPayload {
            workspace: canonical_parent.to_string_lossy().to_string(),
            file: Some(file_path.to_string_lossy().to_string()),
        });
    }

    Err(OpenTargetError::Unsupported(path.to_path_buf()))
}

fn visible_file_path(path: &Path, canonical_parent: &Path) -> PathBuf {
    if path
        .symlink_metadata()
        .is_ok_and(|metadata| metadata.file_type().is_symlink())
    {
        if let Some(name) = path.file_name() {
            return canonical_parent.join(name);
        }
    }

    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::symlink;
    use tempfile::tempdir;

    #[test]
    fn directory_resolves_to_workspace_only_payload() {
        let dir = tempdir().unwrap();
        let payload = validate_and_resolve(dir.path()).unwrap();
        assert!(payload.file.is_none());
        assert_eq!(
            payload.workspace,
            dir.path().canonicalize().unwrap().to_string_lossy()
        );
    }

    #[test]
    fn markdown_file_resolves_to_workspace_plus_file() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("note.md");
        fs::write(&file, "hello").unwrap();

        let payload = validate_and_resolve(&file).unwrap();
        assert_eq!(
            payload.workspace,
            dir.path().canonicalize().unwrap().to_string_lossy()
        );
        assert_eq!(
            payload.file.unwrap(),
            file.canonicalize().unwrap().to_string_lossy()
        );
    }

    #[test]
    fn markdown_extension_matches_both_md_and_markdown_case_insensitively() {
        let dir = tempdir().unwrap();
        for name in ["a.md", "b.MD", "c.markdown", "d.MARKDOWN"] {
            let path = dir.path().join(name);
            fs::write(&path, "").unwrap();
            let payload = validate_and_resolve(&path).unwrap();
            assert!(payload.file.is_some(), "{name} should resolve as file");
        }
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_markdown_file_keeps_visible_workspace_path() {
        let dir = tempdir().unwrap();
        let target = tempdir().unwrap();
        let real = target.path().join("real.md");
        let link = dir.path().join("link.md");
        fs::write(&real, "# Real").unwrap();
        symlink(&real, &link).unwrap();

        let payload = validate_and_resolve(&link).unwrap();

        assert_eq!(
            payload.workspace,
            dir.path().canonicalize().unwrap().to_string_lossy()
        );
        assert_eq!(
            payload.file.unwrap(),
            dir.path()
                .canonicalize()
                .unwrap()
                .join("link.md")
                .to_string_lossy()
                .to_string()
        );
    }

    #[test]
    fn non_markdown_file_is_unsupported() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("image.png");
        fs::write(&file, "").unwrap();

        let err = validate_and_resolve(&file).unwrap_err();
        assert!(matches!(err, OpenTargetError::Unsupported(_)));
    }

    #[test]
    fn missing_path_is_not_found() {
        let dir = tempdir().unwrap();
        let missing = dir.path().join("nope.md");

        let err = validate_and_resolve(&missing).unwrap_err();
        assert!(matches!(err, OpenTargetError::NotFound(_)));
    }

    #[test]
    fn lenient_resolver_returns_none_for_unsupported() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("image.png");
        fs::write(&file, "").unwrap();
        assert!(resolve_path(&file).is_none());
    }

    #[test]
    fn lenient_resolver_returns_none_for_missing() {
        let dir = tempdir().unwrap();
        assert!(resolve_path(&dir.path().join("nope")).is_none());
    }
}
