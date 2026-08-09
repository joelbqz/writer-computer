use crate::error::AppError;
use crate::ignore::WorkspaceIgnore;
use crate::state::{AppState, WorkspaceState};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{Emitter, Manager};

#[derive(Debug, Clone, Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_markdown: bool,
    pub modified_at: u64,
    /// Document title extracted from frontmatter `title:` or leading `# ` heading.
    /// `None` for directories or files without a recognizable title.
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub modified_at: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct WriteResult {
    pub path: String,
    pub modified_at: u64,
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

/// Extract a document title from a markdown file by reading its first few KB.
/// Priority: YAML frontmatter `title:` field, then leading `# ` heading.
fn extract_title(path: &Path) -> Option<String> {
    use std::io::Read;

    let mut file = fs::File::open(path).ok()?;
    let mut buf = vec![0u8; 4096];
    let n = file.read(&mut buf).ok()?;
    let text = std::str::from_utf8(&buf[..n]).ok()?;

    // Check for YAML frontmatter (--- delimited)
    if let Some(rest) = text
        .strip_prefix("---\n")
        .or_else(|| text.strip_prefix("---\r\n"))
    {
        // Find the closing ---
        if let Some(end_pos) = rest.find("\n---\n").or_else(|| rest.find("\n---\r\n")) {
            let yaml_block = &rest[..end_pos];
            // Look for title: in the YAML
            for line in yaml_block.lines() {
                let trimmed = line.trim();
                if let Some(value) = trimmed.strip_prefix("title:") {
                    let value = value.trim();
                    // Strip surrounding quotes
                    let title = value
                        .strip_prefix('"')
                        .and_then(|v| v.strip_suffix('"'))
                        .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
                        .unwrap_or(value);
                    if !title.is_empty() {
                        return Some(title.to_string());
                    }
                }
            }
            // No frontmatter title — check for H1 in the body after frontmatter
            let body_start = end_pos + "\n---\n".len();
            return extract_leading_h1(&rest[body_start..]);
        }
    }

    // No frontmatter — check for H1 heading
    extract_leading_h1(text)
}

/// Extract a title from the first `# ` heading, which must be the first
/// non-blank line in the text.
fn extract_leading_h1(text: &str) -> Option<String> {
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(heading) = trimmed.strip_prefix("# ") {
            let title = heading.trim();
            if !title.is_empty() {
                return Some(title.to_string());
            }
        }
        // First non-blank line is not an H1
        return None;
    }
    None
}

pub(crate) fn modified_time(path: &std::path::Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .map(|t| {
            t.duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
        })
        .unwrap_or(0)
}

/// Recursively checks if a directory contains at least one visible .md file.
/// Used as fallback before the index is ready. Skips paths matched by the
/// workspace ignore matcher so ignored directories don't resurrect their
/// parent in the sidebar.
fn dir_contains_markdown_recursive(path: &Path, ignore: Option<&WorkspaceIgnore>) -> bool {
    let Ok(entries) = fs::read_dir(path) else {
        return false;
    };
    for entry in entries.flatten() {
        let ft = entry.file_type();
        let Ok(ft) = ft else { continue };
        let entry_path = entry.path();

        if let Some(ignore) = ignore {
            if ignore.is_ignored(&entry_path, ft.is_dir()) {
                continue;
            }
        }

        if ft.is_file() {
            if entry_path.extension().and_then(|e| e.to_str()) == Some("md") {
                return true;
            }
        } else if ft.is_dir() && dir_contains_markdown_recursive(&entry_path, ignore) {
            return true;
        }
    }
    false
}

/// O(1) check via the pre-built set, with recursive fallback during initial indexing.
fn dir_contains_markdown(path: &Path, state: Option<&WorkspaceState>) -> bool {
    if let Some(state) = state {
        if state.index_ready.load(Ordering::Relaxed) {
            return state.dirs_with_markdown.read().contains(path);
        }
        // Snapshot the `Arc<WorkspaceIgnore>` under a brief read lock and
        // release immediately — the recursive fallback below does file I/O
        // and must not hold the RwLock across syscalls (it would block a
        // concurrent workspace switch's `workspace_ignore.write()`).
        let ignore_arc: Option<Arc<WorkspaceIgnore>> =
            state.workspace_ignore.read().as_ref().map(Arc::clone);
        return dir_contains_markdown_recursive(path, ignore_arc.as_deref());
    }
    dir_contains_markdown_recursive(path, None)
}

fn dir_is_empty(path: &Path) -> Result<bool, AppError> {
    Ok(fs::read_dir(path)?.next().is_none())
}

pub fn read_directory_impl(
    path: &str,
    state: Option<&WorkspaceState>,
) -> Result<Vec<DirEntry>, AppError> {
    let dir_path = PathBuf::from(path);
    if !dir_path.exists() {
        return Err(AppError::NotFound(path.to_string()));
    }

    // Snapshot the `Arc<WorkspaceIgnore>` under a brief read lock and release
    // immediately — we must NOT hold the RwLock across the per-file I/O
    // below. `extract_title` can block for seconds on iCloud placeholders or
    // slow disks; if the guard were still held, a concurrent workspace
    // switch's `workspace_ignore.write()` in `prepare_workspace_state` would
    // be blocked, freezing the switch IPC.
    let ignore_arc: Option<Arc<WorkspaceIgnore>> =
        state.and_then(|s| s.workspace_ignore.read().as_ref().map(Arc::clone));
    let ignore_matcher: Option<&WorkspaceIgnore> = ignore_arc.as_deref();

    let mut dirs = Vec::new();
    let mut files = Vec::new();

    for entry in fs::read_dir(&dir_path)?.flatten() {
        let file_type = entry.file_type()?;
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files/dirs (the workspace `.gitignore` stays available
        // because `read_directory` only surfaces markdown files and
        // directories, never dotfiles — see the sidebar spec).
        if name.starts_with('.') {
            continue;
        }

        if let Some(ignore) = ignore_matcher {
            if ignore.is_ignored(&entry_path, file_type.is_dir()) {
                continue;
            }
        }

        if file_type.is_dir() {
            if dir_contains_markdown(&entry_path, state) || dir_is_empty(&entry_path)? {
                dirs.push(DirEntry {
                    name,
                    path: entry_path.to_string_lossy().to_string(),
                    is_dir: true,
                    is_markdown: false,
                    modified_at: modified_time(&entry_path),
                    title: None,
                });
            }
        } else if file_type.is_file() {
            let is_markdown = entry_path.extension().and_then(|e| e.to_str()) == Some("md");
            if is_markdown {
                let title = extract_title(&entry_path);
                files.push(DirEntry {
                    name,
                    path: entry_path.to_string_lossy().to_string(),
                    is_dir: false,
                    is_markdown: true,
                    modified_at: modified_time(&entry_path),
                    title,
                });
            }
        }
    }

    // Sort dirs-first, then alphabetical within each group
    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    dirs.extend(files);
    Ok(dirs)
}

#[tauri::command]
pub async fn read_directory(
    path: String,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<Vec<DirEntry>, AppError> {
    let state = app.state::<AppState>().get_or_create(webview.label());
    blocking(move || read_directory_impl(&path, Some(&state))).await
}

pub fn read_file_impl(path: &str) -> Result<FileContent, AppError> {
    let file_path = PathBuf::from(path);
    if !file_path.exists() {
        return Err(AppError::NotFound(path.to_string()));
    }
    let content = fs::read_to_string(&file_path)?;
    Ok(FileContent {
        path: path.to_string(),
        content,
        modified_at: modified_time(&file_path),
    })
}

#[tauri::command]
pub async fn read_file(path: String) -> Result<FileContent, AppError> {
    blocking(move || read_file_impl(&path)).await
}

pub fn write_file_impl(path: &str, content: &str) -> Result<WriteResult, AppError> {
    let file_path = PathBuf::from(path);

    // Atomic write: write to temp file, then rename
    let dir = file_path
        .parent()
        .ok_or_else(|| AppError::Io("No parent directory".into()))?;
    let temp_path = dir.join(format!(".~{}", uuid::Uuid::new_v4()));
    fs::write(&temp_path, content)?;
    fs::rename(&temp_path, &file_path)?;

    Ok(WriteResult {
        path: path.to_string(),
        modified_at: modified_time(&file_path),
    })
}

#[tauri::command]
pub async fn write_file(
    path: String,
    content: String,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<WriteResult, AppError> {
    // Record self-write before spawning (fast, just a HashMap insert).
    // The record is per-window so only this window's watcher suppresses
    // the echo — if another window is watching the same workspace it
    // still sees a genuine file-changed event.
    let state = app.state::<AppState>().get_or_create(webview.label());
    let label = webview.label().to_string();
    crate::watcher::record_write(&state, &PathBuf::from(&path));

    let write_path = PathBuf::from(&path);
    let result = blocking(move || write_file_impl(&path, &content)).await?;
    state.update_index_modified_at(&write_path, result.modified_at);
    let _ = app.emit_to(label, "sidebar:metadata-changed", &result.path);
    Ok(result)
}

pub(crate) fn markdown_file_entry(path: &Path) -> Option<DirEntry> {
    if !path.is_file()
        || !path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("md"))
    {
        return None;
    }

    let name = path.file_name()?.to_string_lossy().to_string();
    Some(DirEntry {
        name,
        path: path.to_string_lossy().to_string(),
        is_dir: false,
        is_markdown: true,
        modified_at: modified_time(path),
        title: extract_title(path),
    })
}

pub fn read_recent_files_impl(
    state: &WorkspaceState,
    limit: usize,
    offset: usize,
) -> Vec<DirEntry> {
    state
        .recent_files_slice(offset, limit)
        .into_iter()
        .filter_map(|file| markdown_file_entry(&file.path))
        .collect()
}

#[tauri::command]
pub async fn read_recent_files(
    limit: Option<u32>,
    offset: Option<u32>,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<Vec<DirEntry>, AppError> {
    let state = app.state::<AppState>().get_or_create(webview.label());
    if state.workspace_root.read().is_none() {
        return Err(AppError::NoWorkspace);
    }

    let limit = limit.unwrap_or(8).clamp(1, 100) as usize;
    let offset = offset.unwrap_or(0) as usize;
    blocking(move || Ok(read_recent_files_impl(&state, limit, offset))).await
}

pub fn read_file_entries_impl(paths: Vec<String>, root: &Path) -> Vec<DirEntry> {
    paths
        .into_iter()
        .filter_map(|path| {
            let path = PathBuf::from(path);
            if !path.starts_with(root) {
                return None;
            }
            markdown_file_entry(&path)
        })
        .collect()
}

#[tauri::command]
pub async fn read_file_entries(
    paths: Vec<String>,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<Vec<DirEntry>, AppError> {
    let state = app.state::<AppState>().get_or_create(webview.label());
    let root = state
        .workspace_root
        .read()
        .clone()
        .ok_or(AppError::NoWorkspace)?;
    blocking(move || Ok(read_file_entries_impl(paths, &root))).await
}

pub fn create_file_impl(path: &str) -> Result<FileContent, AppError> {
    let file_path = PathBuf::from(path);
    if file_path.exists() {
        return Err(AppError::AlreadyExists(path.to_string()));
    }
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let default_content = "# ";
    fs::write(&file_path, default_content)?;
    Ok(FileContent {
        path: path.to_string(),
        content: default_content.to_string(),
        modified_at: modified_time(&file_path),
    })
}

#[tauri::command]
pub async fn create_file(path: String) -> Result<FileContent, AppError> {
    blocking(move || create_file_impl(&path)).await
}

pub fn create_directory_impl(path: &str) -> Result<DirEntry, AppError> {
    let dir_path = PathBuf::from(path);
    if dir_path.exists() {
        return Err(AppError::AlreadyExists(path.to_string()));
    }
    fs::create_dir_all(&dir_path)?;
    let name = dir_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(DirEntry {
        name,
        path: path.to_string(),
        is_dir: true,
        is_markdown: false,
        modified_at: modified_time(&dir_path),
        title: None,
    })
}

#[tauri::command]
pub async fn create_directory(path: String) -> Result<DirEntry, AppError> {
    blocking(move || create_directory_impl(&path)).await
}

pub fn rename_entry_impl(old_path: &str, new_path: &str) -> Result<(), AppError> {
    let old = PathBuf::from(old_path);
    if !old.exists() {
        return Err(AppError::NotFound(old_path.to_string()));
    }
    let new = PathBuf::from(new_path);
    if new.exists() {
        return Err(AppError::AlreadyExists(new_path.to_string()));
    }
    fs::rename(old, new)?;
    Ok(())
}

#[tauri::command]
pub async fn rename_entry(old_path: String, new_path: String) -> Result<(), AppError> {
    blocking(move || rename_entry_impl(&old_path, &new_path)).await
}

pub fn delete_entry_impl(path: &str) -> Result<(), AppError> {
    let entry_path = PathBuf::from(path);
    if !entry_path.exists() {
        return Err(AppError::NotFound(path.to_string()));
    }
    trash::delete(&entry_path).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn delete_entry(path: String) -> Result<(), AppError> {
    blocking(move || delete_entry_impl(&path)).await
}

#[tauri::command]
pub async fn file_exists(path: String) -> bool {
    tauri::async_runtime::spawn_blocking(move || PathBuf::from(&path).exists())
        .await
        .unwrap_or(false)
}

pub fn reveal_in_file_manager_impl(path: &str) -> Result<(), AppError> {
    let target = PathBuf::from(path);
    if !target.exists() {
        return Err(AppError::NotFound(path.to_string()));
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&target)
            .spawn()
            .map_err(|e| AppError::Io(e.to_string()))?;
    }

    #[cfg(target_os = "windows")]
    {
        // `explorer /select,<path>` selects the file inside its parent. The
        // comma must be part of the same argument or Windows parses it as a
        // separator.
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", target.display()))
            .spawn()
            .map_err(|e| AppError::Io(e.to_string()))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Linux: just open the parent directory with xdg-open. There is no
        // portable way to select the target file.
        let parent = target.parent().unwrap_or(&target);
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| AppError::Io(e.to_string()))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn reveal_in_file_manager(path: String) -> Result<(), AppError> {
    blocking(move || reveal_in_file_manager_impl(&path)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup_test_dir() -> TempDir {
        let dir = TempDir::new().unwrap();
        // Create some markdown files
        fs::write(dir.path().join("hello.md"), "# Hello").unwrap();
        fs::write(dir.path().join("world.md"), "# World").unwrap();
        // Create a non-markdown file (should be filtered)
        fs::write(dir.path().join("readme.txt"), "text").unwrap();
        // Create a subdirectory with markdown
        fs::create_dir(dir.path().join("notes")).unwrap();
        fs::write(dir.path().join("notes").join("note.md"), "# Note").unwrap();
        // Create a subdirectory without markdown (should be filtered)
        fs::create_dir(dir.path().join("empty")).unwrap();
        fs::write(dir.path().join("empty").join("data.txt"), "data").unwrap();
        // Truly empty directories stay visible so they can be populated.
        fs::create_dir(dir.path().join("truly-empty")).unwrap();
        dir
    }

    #[test]
    fn test_read_directory_sorts_dirs_first() {
        let dir = setup_test_dir();
        let result = read_directory_impl(&dir.path().to_string_lossy(), None).unwrap();

        // Directories come first, then files.
        assert!(result[0].is_dir);
        assert_eq!(result[0].name, "notes");
        assert!(result[0].title.is_none());
        assert!(result[1].is_dir);
        assert_eq!(result[1].name, "truly-empty");
        // Remaining files are sorted alphabetically.
        assert!(!result[2].is_dir);
        assert_eq!(result[2].name, "hello.md");
        assert_eq!(result[2].title.as_deref(), Some("Hello"));
        assert!(!result[3].is_dir);
        assert_eq!(result[3].name, "world.md");
        assert_eq!(result[3].title.as_deref(), Some("World"));
    }

    #[test]
    fn test_read_directory_filters_markdown_only() {
        let dir = setup_test_dir();
        let result = read_directory_impl(&dir.path().to_string_lossy(), None).unwrap();

        // Should have: notes/ dir, truly-empty/ dir, hello.md, world.md (4 total)
        // NOT: readme.txt, empty/ dir (contains only non-Markdown content)
        assert_eq!(result.len(), 4);
        for entry in &result {
            assert!(entry.is_dir || entry.is_markdown);
        }
    }

    #[test]
    fn test_read_directory_uses_index_when_ready() {
        let dir = setup_test_dir();
        let state = WorkspaceState::default();

        // Build index
        let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let (indexed, dirs) = crate::commands::search::index_workspace_impl(dir.path(), cancel);
        *state.file_index.write() = indexed;
        *state.dirs_with_markdown.write() = dirs;
        state.index_ready.store(true, Ordering::Relaxed);

        let result = read_directory_impl(&dir.path().to_string_lossy(), Some(&state)).unwrap();

        assert_eq!(result.len(), 4);
        assert!(result[0].is_dir);
        assert_eq!(result[0].name, "notes");
        assert!(result[1].is_dir);
        assert_eq!(result[1].name, "truly-empty");
    }

    fn indexed_file(root: &Path, name: &str, modified_at: u64) -> crate::state::IndexedFile {
        let path = root.join(name);
        crate::state::IndexedFile {
            path,
            relative_path: name.to_string(),
            name: name.to_string(),
            modified_at,
        }
    }

    #[test]
    fn test_read_recent_files_sorts_by_index_mtime_and_pages() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("old.md"), "# Old").unwrap();
        fs::write(dir.path().join("new.md"), "# New").unwrap();
        fs::write(dir.path().join("middle.md"), "# Middle").unwrap();
        let state = WorkspaceState::default();
        *state.file_index.write() = vec![
            indexed_file(dir.path(), "old.md", 1),
            indexed_file(dir.path(), "new.md", 3),
            indexed_file(dir.path(), "middle.md", 2),
        ];

        let first_page = read_recent_files_impl(&state, 2, 0);
        assert_eq!(
            first_page
                .iter()
                .map(|entry| entry.name.as_str())
                .collect::<Vec<_>>(),
            vec!["new.md", "middle.md"]
        );

        let second_page = read_recent_files_impl(&state, 2, 2);
        assert_eq!(
            second_page
                .iter()
                .map(|entry| entry.name.as_str())
                .collect::<Vec<_>>(),
            vec!["old.md"]
        );
    }

    #[test]
    fn test_read_recent_files_cache_invalidates_on_mtime_update() {
        let dir = TempDir::new().unwrap();
        let old_path = dir.path().join("old.md");
        fs::write(&old_path, "# Old").unwrap();
        fs::write(dir.path().join("new.md"), "# New").unwrap();
        let state = WorkspaceState::default();
        *state.file_index.write() = vec![
            indexed_file(dir.path(), "old.md", 1),
            indexed_file(dir.path(), "new.md", 2),
        ];

        let before = read_recent_files_impl(&state, 1, 0);
        assert_eq!(before[0].name, "new.md");

        state.update_index_modified_at(&old_path, 5);

        let after = read_recent_files_impl(&state, 1, 0);
        assert_eq!(after[0].name, "old.md");
    }

    #[test]
    fn test_read_file_entries_filters_missing_non_markdown_and_outside_root() {
        let dir = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let kept = dir.path().join("kept.md");
        fs::write(&kept, "# Kept").unwrap();
        fs::write(dir.path().join("note.txt"), "not markdown").unwrap();
        fs::write(outside.path().join("outside.md"), "# Outside").unwrap();

        let entries = read_file_entries_impl(
            vec![
                kept.to_string_lossy().to_string(),
                dir.path().join("missing.md").to_string_lossy().to_string(),
                dir.path().join("note.txt").to_string_lossy().to_string(),
                outside
                    .path()
                    .join("outside.md")
                    .to_string_lossy()
                    .to_string(),
            ],
            dir.path(),
        );

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "kept.md");
    }

    #[test]
    fn test_read_file_returns_content() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.md");
        fs::write(&path, "# Test Content").unwrap();

        let result = read_file_impl(&path.to_string_lossy()).unwrap();
        assert_eq!(result.content, "# Test Content");
    }

    #[test]
    fn test_read_file_not_found() {
        let result = read_file_impl("/nonexistent/file.md");
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::NotFound(_)));
    }

    #[test]
    fn test_write_file_atomic() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("output.md");
        fs::write(&path, "old").unwrap();

        let result = write_file_impl(&path.to_string_lossy(), "new content").unwrap();
        assert_eq!(result.path, path.to_string_lossy().to_string());

        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(content, "new content");
    }

    #[test]
    fn test_create_file_already_exists() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("exists.md");
        fs::write(&path, "").unwrap();

        let result = create_file_impl(&path.to_string_lossy());
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::AlreadyExists(_)));
    }

    #[test]
    fn test_delete_entry_moves_to_trash() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("to_delete.md");
        fs::write(&path, "delete me").unwrap();
        assert!(path.exists());

        delete_entry_impl(&path.to_string_lossy()).unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn test_rename_entry() {
        let dir = TempDir::new().unwrap();
        let old_path = dir.path().join("old.md");
        let new_path = dir.path().join("new.md");
        fs::write(&old_path, "content").unwrap();

        rename_entry_impl(&old_path.to_string_lossy(), &new_path.to_string_lossy()).unwrap();

        assert!(!old_path.exists());
        assert!(new_path.exists());
        assert_eq!(fs::read_to_string(&new_path).unwrap(), "content");
    }

    #[test]
    fn test_rename_entry_not_found() {
        let result = rename_entry_impl("/nonexistent/old.md", "/nonexistent/new.md");
        assert!(matches!(result.unwrap_err(), AppError::NotFound(_)));
    }

    #[test]
    fn test_rename_entry_already_exists() {
        let dir = TempDir::new().unwrap();
        let old_path = dir.path().join("old.md");
        let new_path = dir.path().join("new.md");
        fs::write(&old_path, "old").unwrap();
        fs::write(&new_path, "new").unwrap();

        let result = rename_entry_impl(&old_path.to_string_lossy(), &new_path.to_string_lossy());
        assert!(matches!(result.unwrap_err(), AppError::AlreadyExists(_)));
    }

    #[test]
    fn test_error_serializes() {
        let err = AppError::Io("test error".to_string());
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, "\"IO error: test error\"");

        let err = AppError::NotFound("file.md".to_string());
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, "\"Not found: file.md\"");

        let err = AppError::NoWorkspace;
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, "\"No workspace is open\"");
    }

    #[test]
    fn test_extract_title_from_h1() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("doc.md");
        fs::write(&path, "# My Document\n\nSome content").unwrap();
        assert_eq!(extract_title(&path).as_deref(), Some("My Document"));
    }

    #[test]
    fn test_extract_title_from_frontmatter() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("doc.md");
        fs::write(&path, "---\ntitle: Front Title\n---\n\nBody").unwrap();
        assert_eq!(extract_title(&path).as_deref(), Some("Front Title"));
    }

    #[test]
    fn test_extract_title_frontmatter_quoted() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("doc.md");
        fs::write(&path, "---\ntitle: \"Quoted Title\"\n---\n\nBody").unwrap();
        assert_eq!(extract_title(&path).as_deref(), Some("Quoted Title"));
    }

    #[test]
    fn test_extract_title_frontmatter_beats_h1() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("doc.md");
        fs::write(&path, "---\ntitle: FM Title\n---\n\n# Heading").unwrap();
        assert_eq!(extract_title(&path).as_deref(), Some("FM Title"));
    }

    #[test]
    fn test_extract_title_h1_after_empty_frontmatter() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("doc.md");
        fs::write(&path, "---\ndate: 2025-01-01\n---\n\n# Fallback Heading").unwrap();
        assert_eq!(extract_title(&path).as_deref(), Some("Fallback Heading"));
    }

    #[test]
    fn test_extract_title_none_for_empty_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("doc.md");
        fs::write(&path, "").unwrap();
        assert_eq!(extract_title(&path), None);
    }

    #[test]
    fn test_extract_title_none_when_no_heading() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("doc.md");
        fs::write(&path, "Just a paragraph.\nAnother line.").unwrap();
        assert_eq!(extract_title(&path), None);
    }

    #[test]
    fn test_workspace_state_default() {
        let state = WorkspaceState::default();
        assert!(state.workspace_root.read().is_none());
        assert!(state.file_index.read().is_empty());
        assert!(state.dirs_with_markdown.read().is_empty());
        assert!(!state.index_ready.load(Ordering::Relaxed));
        assert!(state.watcher_handle.read().is_none());
    }
}
