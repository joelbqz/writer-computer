use crate::error::AppError;
use crate::ignore::WorkspaceIgnore;
use crate::state::{self, AppState, IndexedFile, WorkspaceState};
use ignore::WalkBuilder;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Manager;

#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub path: String,
    pub filename: String,
    pub relative_path: String,
    pub score: u32,
    pub match_indices: Vec<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct IndexStats {
    pub file_count: usize,
    pub duration_ms: u64,
}

/// Rebuild the hidden-path matcher and the file index for the calling
/// window's workspace, through the same generation-gated path as every other
/// rebuild.
#[tauri::command]
pub fn index_workspace(
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<IndexStats, AppError> {
    let state = app.state::<AppState>().get_or_create(webview.label());
    if state.workspace_snapshot().is_none() {
        return Err(AppError::NoWorkspace);
    }
    let start = std::time::Instant::now();
    let file_count =
        crate::commands::workspace::rebuild_workspace_filter_now(&app, webview.label(), &state)
            .unwrap_or(0);
    Ok(IndexStats {
        file_count,
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

#[tauri::command]
pub fn fuzzy_search(
    query: String,
    limit: Option<u32>,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<Vec<SearchResult>, AppError> {
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let state = app.state::<AppState>().get_or_create(webview.label());
    let limit = limit.unwrap_or(50) as usize;
    let index = state.file_index.read();
    fuzzy_search_from(&query, &index, limit)
}

fn fuzzy_search_from(
    query: &str,
    index: &[IndexedFile],
    limit: usize,
) -> Result<Vec<SearchResult>, AppError> {
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let normalized_query = query.to_lowercase();
    let mut needles = Vec::from([normalized_query.clone()]);
    let hyphen_query = normalized_query.replace(' ', "-");
    if !needles.contains(&hyphen_query) {
        needles.push(hyphen_query);
    }
    let space_query = normalized_query.replace('-', " ");
    if !needles.contains(&space_query) {
        needles.push(space_query);
    }

    let mut results: Vec<SearchResult> = index
        .iter()
        .filter_map(|file| {
            let haystack = file.relative_path.to_lowercase();
            let (byte_start, needle) = needles
                .iter()
                .filter_map(|needle| haystack.find(needle).map(|start| (start, needle)))
                .min_by_key(|(start, _)| *start)?;

            let char_start = haystack[..byte_start].chars().count();
            let char_len = needle.chars().count();

            let filename_start_bytes = file.relative_path.rfind('/').map(|i| i + 1).unwrap_or(0);
            let in_filename = byte_start >= filename_start_bytes;

            // Higher score ranks first. Matches inside the filename beat matches
            // in a parent directory; earlier matches beat later ones; shorter
            // paths tiebreak.
            let mut score: u32 = 0;
            if in_filename {
                score += 1_000_000;
            }
            score += 10_000u32.saturating_sub(byte_start as u32);
            score +=
                1_000u32.saturating_sub((file.relative_path.chars().count() as u32).min(1_000));

            let match_indices: Vec<u32> = (char_start..char_start + char_len)
                .map(|i| i as u32)
                .collect();

            Some(SearchResult {
                path: file.path.to_string_lossy().to_string(),
                filename: file.name.clone(),
                relative_path: file.relative_path.clone(),
                score,
                match_indices,
            })
        })
        .collect();

    results.sort_by(|a, b| b.score.cmp(&a.score));
    results.truncate(limit);
    Ok(results)
}

/// The window's hidden-path matcher when it belongs to `root` and its
/// `.gitignore` rules are loaded. Otherwise (no workspace, another root, or
/// the background load hasn't finished) a full matcher is loaded for this
/// walk, so a lookup right after opening a repository never descends into
/// gitignored build output.
fn workspace_ignore_for(state: &WorkspaceState, root: &Path) -> Arc<WorkspaceIgnore> {
    state
        .workspace_ignore
        .read()
        .as_ref()
        .filter(|ignore| ignore.root() == root && ignore.gitignores_loaded())
        .map(Arc::clone)
        .unwrap_or_else(|| Arc::new(WorkspaceIgnore::load(root, state.file_excludes())))
}

/// Parallel walk of `root` that visits only what `ignore` leaves visible.
///
/// The `ignore` crate's own filters (hidden files, `.gitignore`, global
/// gitignore, `.ignore`) are all off: `WorkspaceIgnore` is the one decision,
/// so the index, the sidebar and the watcher can't disagree (the crate's
/// defaults skip every dotfile and only honor `.gitignore` inside a git
/// repository). Hidden folders are pruned, never descended into.
fn walk_visible(root: &Path, ignore: &Arc<WorkspaceIgnore>) -> ignore::WalkParallel {
    let threads = std::thread::available_parallelism()
        .map(|n| n.get().min(8))
        .unwrap_or(4);
    let ignore = Arc::clone(ignore);
    WalkBuilder::new(root)
        .standard_filters(false)
        .filter_entry(move |entry| {
            let is_dir = entry.file_type().is_some_and(|ft| ft.is_dir());
            !ignore.is_ignored_in_walk(entry.path(), is_dir)
        })
        .threads(threads)
        .build_parallel()
}

/// Parallel file indexing using the `ignore` crate's walker.
/// Returns the indexed files and a set of directories containing markdown.
///
/// `root` is the workspace root or, for the watcher, a folder inside it that
/// just appeared; `ignore` is always the workspace's matcher.
///
/// The `cancel` flag lets a concurrent workspace switch stop this walk early:
/// each walker thread checks the flag at every directory entry and returns
/// `WalkState::Quit` as soon as it's flipped. The returned results may be
/// partial in that case; callers should compare `cancel.load` or the workspace
/// epoch against expectations before acting on them.
pub fn index_workspace_impl(
    root: &Path,
    ignore: &Arc<WorkspaceIgnore>,
    cancel: Arc<AtomicBool>,
) -> (Vec<IndexedFile>, HashSet<PathBuf>) {
    let root = root.to_path_buf();
    let results: Arc<Mutex<Vec<IndexedFile>>> = Arc::new(Mutex::new(Vec::new()));

    let results_ref = Arc::clone(&results);
    let root_ref = root.clone();

    walk_visible(&root, ignore).run(move || {
        let results = Arc::clone(&results_ref);
        let root = root_ref.clone();
        let cancel = Arc::clone(&cancel);
        Box::new(move |entry| {
            if cancel.load(Ordering::Relaxed) {
                return ignore::WalkState::Quit;
            }
            let entry = match entry {
                Ok(e) => e,
                Err(_) => return ignore::WalkState::Continue,
            };
            if entry.file_type().is_some_and(|ft| ft.is_file())
                && entry.path().extension().and_then(|e| e.to_str()) == Some("md")
            {
                let rel = entry
                    .path()
                    .strip_prefix(&root)
                    .unwrap_or(entry.path())
                    .to_string_lossy()
                    .to_string();
                results.lock().push(IndexedFile {
                    path: entry.path().to_path_buf(),
                    relative_path: rel,
                    name: entry.file_name().to_string_lossy().to_string(),
                    modified_at: crate::commands::fs::modified_time(entry.path()),
                });
            }
            ignore::WalkState::Continue
        })
    });

    let indexed = Arc::try_unwrap(results).unwrap().into_inner();
    let dirs = state::rebuild_dirs_from_index(&indexed, &root);
    (indexed, dirs)
}

/// Test-only convenience: run an uncancellable index.
#[cfg(test)]
fn index_workspace_test(root: &Path) -> (Vec<IndexedFile>, HashSet<PathBuf>) {
    let ignore = Arc::new(WorkspaceIgnore::load(
        root,
        crate::ignore::FileExcludes::from_settings(None),
    ));
    index_workspace_impl(root, &ignore, Arc::new(AtomicBool::new(false)))
}

pub fn fuzzy_search_impl(query: &str, index: &[IndexedFile], limit: usize) -> Vec<SearchResult> {
    fuzzy_search_from(query, index, limit).unwrap_or_default()
}

/// Find a file under `root` by case-insensitive basename. Used by Obsidian
/// wiki image embeds (`![[image.png]]`), which reference attachments by bare
/// filename regardless of where they live in the vault. The workspace file
/// index only covers markdown, so this walks on demand (through the
/// workspace's hidden-path matcher, parallel) instead of maintaining a second
/// media index plus watcher plumbing; callers cache positive results.
///
/// Deterministic on duplicates: the match with the fewest path components
/// wins, ties broken lexicographically — "shortest path" like Obsidian.
pub fn find_file_by_name_impl(
    root: &Path,
    file_name: &str,
    ignore: &Arc<WorkspaceIgnore>,
) -> Option<PathBuf> {
    let matches: Arc<Mutex<Vec<PathBuf>>> = Arc::new(Mutex::new(Vec::new()));
    let target = file_name.to_lowercase();

    let matches_ref = Arc::clone(&matches);
    walk_visible(root, ignore).run(move || {
        let matches = Arc::clone(&matches_ref);
        let target = target.clone();
        Box::new(move |entry| {
            let Ok(entry) = entry else {
                return ignore::WalkState::Continue;
            };
            if entry.file_type().is_some_and(|ft| ft.is_file())
                && entry.file_name().to_string_lossy().to_lowercase() == target
            {
                matches.lock().push(entry.path().to_path_buf());
            }
            ignore::WalkState::Continue
        })
    });

    let mut matches = Arc::try_unwrap(matches).unwrap().into_inner();
    matches.sort_by(|a, b| {
        let depth_a = a.components().count();
        let depth_b = b.components().count();
        depth_a.cmp(&depth_b).then_with(|| a.cmp(b))
    });
    matches.into_iter().next()
}

#[tauri::command]
pub async fn find_file_by_name(
    root: String,
    file_name: String,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<Option<String>, AppError> {
    let state = app.state::<AppState>().get_or_create(webview.label());
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&root);
        let ignore = workspace_ignore_for(&state, root);
        Ok(find_file_by_name_impl(root, &file_name, &ignore)
            .map(|path| path.to_string_lossy().to_string()))
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn setup_workspace() -> TempDir {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("readme.md"), "# Readme").unwrap();
        fs::write(dir.path().join("notes.md"), "# Notes").unwrap();
        fs::write(dir.path().join("data.txt"), "not indexed").unwrap();
        fs::create_dir(dir.path().join("docs")).unwrap();
        fs::write(dir.path().join("docs").join("guide.md"), "# Guide").unwrap();
        // Excluded by default (`files.exclude`)
        fs::create_dir(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".git").join("config.md"), "git").unwrap();
        dir
    }

    #[test]
    fn test_index_workspace_counts_md_files() {
        let dir = setup_workspace();
        let (index, _dirs) = index_workspace_test(dir.path());
        assert_eq!(index.len(), 3); // readme.md, notes.md, docs/guide.md
    }

    #[test]
    fn test_index_workspace_skips_excluded_folders() {
        let dir = setup_workspace();
        let (index, _dirs) = index_workspace_test(dir.path());
        // Should not include .git/config.md
        assert!(!index.iter().any(|f| f.relative_path.contains(".git")));
    }

    fn write(path: &Path, content: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    fn indexed_paths(root: &Path) -> Vec<String> {
        let (index, _dirs) = index_workspace_test(root);
        let mut paths: Vec<String> = index.into_iter().map(|f| f.relative_path).collect();
        paths.sort();
        paths
    }

    #[test]
    fn test_index_workspace_includes_dot_folders_but_not_excluded_ones() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(&root.join(".claude/skills/demo/SKILL.md"), "# Skill");
        write(&root.join(".agents/skills/x/SKILL.md"), "# Skill");
        write(&root.join(".trash/old.md"), "# Old");
        write(&root.join(".claude/worktrees/feature/README.md"), "# Copy");
        write(&root.join("node_modules/pkg/README.md"), "# Pkg");
        write(&root.join("note.md"), "# Note");

        assert_eq!(
            indexed_paths(root),
            vec![
                ".agents/skills/x/SKILL.md",
                ".claude/skills/demo/SKILL.md",
                "note.md"
            ]
        );
    }

    #[test]
    fn test_index_workspace_honors_gitignore_outside_a_git_repo() {
        // Regression: the walker used the `ignore` crate defaults, which only
        // read `.gitignore` inside a git repository, while the sidebar reads
        // it everywhere. Both go through `WorkspaceIgnore` now.
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(&root.join(".gitignore"), ".cache/\ndrafts/\n");
        write(&root.join(".cache/notes.md"), "# Cached");
        write(&root.join("drafts/wip.md"), "# WIP");
        write(&root.join("note.md"), "# Note");

        assert_eq!(indexed_paths(root), vec!["note.md"]);
    }

    #[test]
    fn test_index_workspace_builds_dirs_with_markdown() {
        let dir = setup_workspace();
        let root = dir.path().to_path_buf();
        let (_index, dirs) = index_workspace_test(dir.path());
        // The root and docs/ should be in the set
        assert!(dirs.contains(&root));
        assert!(dirs.contains(&root.join("docs")));
        // .git should not be in the set
        assert!(!dirs.contains(&root.join(".git")));
    }

    #[test]
    fn test_cancel_flag_short_circuits_walk() {
        // Pre-cancelled walker should return before visiting any file.
        let dir = setup_workspace();
        let cancel = Arc::new(AtomicBool::new(true));
        let ignore = Arc::new(WorkspaceIgnore::bootstrap(
            dir.path(),
            crate::ignore::FileExcludes::from_settings(None),
        ));
        let (index, dirs) = index_workspace_impl(dir.path(), &ignore, cancel);
        assert!(index.is_empty());
        assert!(dirs.is_empty());
    }

    #[test]
    fn test_live_cancel_token_survives_after_swap() {
        // Mirror the workspace-switch contract: when the outgoing cancel flag
        // is flipped, any walker still holding a clone of the old Arc sees
        // the cancellation even after a fresh Arc replaces the state slot.
        let live = Arc::new(AtomicBool::new(false));
        let walker_view = Arc::clone(&live);
        live.store(true, Ordering::Relaxed);
        let _fresh = Arc::new(AtomicBool::new(false));
        assert!(walker_view.load(Ordering::Relaxed));
    }

    #[test]
    fn test_fuzzy_search_ranks_by_relevance() {
        let dir = setup_workspace();
        let (index, _dirs) = index_workspace_test(dir.path());
        let results = fuzzy_search_impl("readme", &index, 50);
        assert!(!results.is_empty());
        assert_eq!(results[0].filename, "readme.md");
    }

    #[test]
    fn test_fuzzy_search_matches_space_separated_names() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("No prior experience.md"), "# Note").unwrap();
        let (index, _dirs) = index_workspace_test(dir.path());

        let results = fuzzy_search_impl("No prior experience", &index, 50);

        assert!(!results.is_empty());
        assert_eq!(results[0].filename, "No prior experience.md");
    }

    #[test]
    fn test_fuzzy_search_returns_match_indices() {
        let dir = setup_workspace();
        let (index, _dirs) = index_workspace_test(dir.path());
        let results = fuzzy_search_impl("guide", &index, 50);
        assert!(!results.is_empty());
        assert!(!results[0].match_indices.is_empty());
    }

    #[test]
    fn test_fuzzy_search_empty_query() {
        let dir = setup_workspace();
        let (index, _dirs) = index_workspace_test(dir.path());
        let results = fuzzy_search_impl("", &index, 50);
        assert!(results.is_empty());
    }

    #[test]
    fn test_fuzzy_search_respects_limit() {
        let dir = setup_workspace();
        let (index, _dirs) = index_workspace_test(dir.path());
        let results = fuzzy_search_impl("md", &index, 1);
        assert!(results.len() <= 1);
    }

    fn find_test(root: &Path, file_name: &str) -> Option<PathBuf> {
        let ignore = Arc::new(WorkspaceIgnore::load(
            root,
            crate::ignore::FileExcludes::from_settings(None),
        ));
        find_file_by_name_impl(root, file_name, &ignore)
    }

    #[test]
    fn test_find_file_by_name_case_insensitive() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("assets")).unwrap();
        fs::write(dir.path().join("assets").join("Diagram.PNG"), [0u8]).unwrap();

        let found = find_test(dir.path(), "diagram.png").unwrap();
        assert_eq!(found, dir.path().join("assets").join("Diagram.PNG"));
    }

    #[test]
    fn test_find_file_by_name_prefers_shortest_path() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("a").join("b")).unwrap();
        fs::write(dir.path().join("a").join("b").join("pic.png"), [0u8]).unwrap();
        fs::write(dir.path().join("pic.png"), [0u8]).unwrap();

        let found = find_test(dir.path(), "pic.png").unwrap();
        assert_eq!(found, dir.path().join("pic.png"));
    }

    #[test]
    fn test_find_file_by_name_missing_and_hidden() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".git").join("hidden.png"), [0u8]).unwrap();
        write(&dir.path().join(".gitignore"), "build/\n");
        fs::create_dir(dir.path().join("build")).unwrap();
        fs::write(dir.path().join("build").join("ignored.png"), [0u8]).unwrap();

        assert!(find_test(dir.path(), "nope.png").is_none());
        assert!(find_test(dir.path(), "hidden.png").is_none());
        assert!(find_test(dir.path(), "ignored.png").is_none());
    }

    #[test]
    fn test_find_file_by_name_looks_inside_dot_folders() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join(".attachments")).unwrap();
        fs::write(dir.path().join(".attachments").join("pic.png"), [0u8]).unwrap();

        assert_eq!(
            find_test(dir.path(), "pic.png"),
            Some(dir.path().join(".attachments").join("pic.png"))
        );
    }
}
