# Show Dotfiles Spec

## Summary

Writer hid every file and folder whose name starts with `.` from the sidebar, quick open, wiki-embed lookup and the file watcher. That made `.claude/`, `.agents/`, `.github/` and similar folders unreachable, so agent skills (`.claude/skills/*/SKILL.md`, `.agents/skills/...`) and other notes kept in dot folders couldn't be read in the app. Switch to the model Zed uses: dotfiles are ordinary entries, `.gitignore` decides what's hidden, and a short, editable exclusion list (`files.exclude`) always applies on top.

## Behavior

- Dotfiles and dot folders show like any other entry. The sidebar still lists only markdown files and folders that contain markdown (or empty folder trees), so `.obsidian/`, `.writer/` and `.claude/settings.json` stay out because they hold no markdown, not because of the dot.
- `.gitignore` files are honored in every folder of the workspace, whether or not it is a git repository. The global gitignore and `.git/info/exclude` are not read.
- `files.exclude` (Preferences → Files → Hidden Files, or `files.exclude = …` lines in a config file) is always applied. Default:
  `.git`, `.hg`, `.svn`, `.jj`, `node_modules`, `.DS_Store`, `.trash`, `.claude/worktrees`.
  - `.trash` is Obsidian's deleted-notes folder, full of `.md` files; many vaults aren't git repositories and have no `.gitignore`, so the list is the only thing that keeps it out.
  - `.claude/worktrees` holds Claude Code worktrees, full copies of the repository that are often not gitignored.
- Sidebar, watcher, quick open (the file index) and the `![[image.png]]` lookup all hide exactly the same paths.

## `files.exclude` semantics

Each entry is a name or a path of names separated by `/`. A path inside the workspace is hidden when its names, read from the workspace root, contain the entry's names as a consecutive run:

- `node_modules` hides every file or folder named `node_modules`, at any depth, and everything inside it.
- `.claude/worktrees` hides any `worktrees` folder directly inside a `.claude` folder, at any depth. A `worktrees` folder elsewhere stays visible.
- Matching is exact and case-sensitive. No wildcards. Leading and trailing `/` are ignored, as are `.` and `..` segments; empty entries are skipped.
- Matching is relative to the workspace root, so a workspace that itself lives inside `.trash/` or `~/.notes/` shows its own contents.
- The list replaces the default; it is not merged with it. Removing `.git` or `node_modules` makes Writer walk and watch those folders, which is slow on big repositories. Anything more specific (anchored paths, globs, re-including) belongs in a `.gitignore`.
- A config file with a single `files.exclude = x` line reads as a one-entry list, and `files.exclude =` (no value) is an explicitly empty list. This is general: any setting whose default is a list now parses this way (`files.associations` too), and an empty list is written back as `key =` so it doesn't fall back to the default.

The simplest rule that covers the defaults was chosen over gitignore-style globs: one rule for single names and paths, no new matcher, and `Path::ends_with` checks with no per-entry allocation.

## Design

- **One predicate.** `WorkspaceIgnore` (`src-tauri/src/ignore.rs`) owns the decision. It now carries the workspace root and the compiled `FileExcludes` next to the `.gitignore` matchers, which are keyed by scope: a path looks up each of its ancestors (deepest first, one hash lookup each) instead of testing every `.gitignore` in the workspace, so monorepos with hundreds of them don't slow every walked entry. `is_ignored(path, is_dir)` checks the path and its ancestors; `is_ignored_in_walk` checks only the entry itself, for top-down walks that never descend into a hidden folder; `is_excluded(path)` is the exclusion list alone (no stat), which the watcher uses to drop `.git` churn first. No call site has its own dot or name checks any more (`fs.rs` `visible_fs_entry` and `read_directory_impl`, `search.rs` walks, `watcher.rs` `should_ignore` are gone or go through the matcher).
- **Search uses the same matcher.** `search.rs` walked with the `ignore` crate defaults: `hidden(true)`, and `require_git(true)`, so `.gitignore` was ignored outside git repositories while the sidebar (which builds its matcher with `require_git(false)`) honored it. Both walks (`index_workspace_impl`, `find_file_by_name_impl`) now turn all of the crate's filters off (`standard_filters(false)`) and prune with `WorkspaceIgnore` in `filter_entry`. `find_file_by_name` uses the window's matcher, or loads a full one when the installed matcher is still the bootstrap one (no `.gitignore` rules yet) or belongs to another root, so an embed lookup right after opening a repository never walks or resolves into gitignored build output.
- **The setting.** `files.exclude` is declared once, in `shared/settings.schema.json` (category Files, type list). `WorkspaceState::file_excludes()` reads it from the window's merged settings (workspace → global → default).
- **One rebuild path.** `commands/workspace.rs` `refresh_workspace_filter` builds the matcher from the current `.gitignore` files and `files.exclude`, publishes it, nudges the sidebar to re-read the root, re-walks the file index through the same matcher, and publishes the index (`index:complete`). Workspace open calls it directly, and so does the `index_workspace` IPC (`rebuild_workspace_filter_now`), so there is one index-publish block; `.gitignore` changes (watcher) and `files.exclude` changes (`set_setting` / `reset_setting` through `write_settings`, and `.writer/config` edits through the watcher's `reload_workspace_settings`) call `spawn_workspace_filter_refresh`, which debounces 300 ms. Each request bumps `WorkspaceState::ignore_generation`; the matcher and the index publish only while their generation is still the latest (checked under the slot's write lock), so overlapping rebuilds settle on the newest request. A rebuild that starts walking claims a fresh `cancel_index` flag and flips the previous one, so a superseded walk stops at its next entry instead of running to the end. Once an index exists, the sidebar decides which folders have markdown from `dirs_with_markdown`, so after publishing the new index the rebuild re-reads the root a second time; otherwise a folder that just became visible (say `.trash` removed from the list) would stay hidden. Before this change a `.gitignore` edit rebuilt the matcher but left quick open's index stale.
- **Watcher.** Order per path: the workspace's own `root/.writer/config` reloads settings first (so it keeps working even when `.writer/` is gitignored, which used to break it; a `.writer/config` deeper down is an ordinary file), then Writer's atomic-save temp file (`.~writer-<uuid>`, `fs::is_atomic_write_temp`) is dropped — the old dot rule hid it, and without it every autosave would refresh the folder, recent files and the index — then `is_excluded`, then `.gitignore` → rebuild, then the stat and the full `is_ignored`. The matcher is snapshotted once per debounced batch instead of read-locked per path. A bootstrap matcher (exclusion list only) is installed before the watcher starts and before the first sidebar read, so excluded folders never flash in.

## Tradeoffs

- Search and the watcher now descend into dot folders that aren't excluded or gitignored (`.obsidian/`, `.github/`, …). Opening a folder full of tool state without `.gitignore` files (your home folder: `~/.cargo`, `~/.vscode/extensions`, `~/.npm`) indexes their README files too; add those names to Hidden Files. Other apps' dot-named temp and swap files (`.note.md.swp`, `._note.md`) now reach the frontend as non-markdown file events, as non-dot temp files always did. With `.git` and `node_modules` excluded and `.gitignore` applied this is a small amount of extra walking. Changes inside `.obsidian/` (Obsidian saves `workspace.json` often) now reach the frontend as ordinary non-markdown file events, like images elsewhere in a vault: one sidebar metadata refresh per 300 ms batch at most.
- Full re-index on every `.gitignore` or `files.exclude` change. Debounced, cancellable on workspace switch, off the IPC thread. A watcher update that lands while the re-walk runs can be overwritten by the walk's snapshot, the same as during the initial index on workspace open.
- `WorkspaceIgnore::is_ignored` uses `matched_path_or_any_parents` (a parent walk per scope); the walkers use `is_ignored_in_walk` (one match per scope) because they prune hidden folders.

## Out of scope / follow-ups

- After a matcher rebuild only the root listing is refreshed; expanded subfolders keep their cached listing until they're re-read (collapse/expand, or a change inside them). This was already true for `.gitignore` changes.
- `read_directory` with no workspace open (no matcher) filters nothing; it is only called for a workspace.
- A global `files.exclude` change made in one window applies to other open windows the next time they reload global settings (same as every other global setting).
- Globs or root-anchored entries in `files.exclude`.

## Validation

- Rust: `cargo test`, `cargo clippy --all-targets`, `cargo fmt --check` in `apps/desktop/src-tauri/`. Tests cover: dot folders visible in the matcher, sidebar (`.claude/skills/demo/SKILL.md`), quick-open index and wiki-embed lookup; `.trash/` and `.claude/worktrees/` hidden by default at any depth; a gitignored dot folder hidden; a non-git folder with `.gitignore` giving identical results in the sidebar and the index; a workspace `.writer/config` `files.exclude` replacing the default; single-line and empty list settings parsing and round-tripping; the exclusion list being relative to the workspace root.
- Frontend: `vp check`, `vp test`.
- Manual: a folder with `.claude/skills/demo/SKILL.md`, `.trash/old.md` and a `.gitignore` that ignores a dot folder; check the sidebar, ⌘P and wiki embeds, and that editing the open `SKILL.md` from outside reloads it.
