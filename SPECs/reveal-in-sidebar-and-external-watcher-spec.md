# Reveal-in-Sidebar and Residual External-Watcher Misses

## Summary

Three related issues, all anchored on the seam between the editor's notion of "active file" and the sidebar tree:

1. **External file changes still drop occasionally.** The previous watcher spec ([`external-file-watcher-spec.md`](./external-file-watcher-spec.md)) landed three fixes (dotdir-root filter, canonical root, per-save self-write TTL window). Reports say the sidebar / open-editor reload still misses changes in some cases. We need a concrete diagnosis before patching further — the symptom is intermittent and prior guesses have layered on without confirming the next failure mode.
2. **"Reveal in sidebar" tab-context-menu action is a no-op.** [`apps/desktop/src/components/editor-area/editor-tabs.tsx:138`](../apps/desktop/src/components/editor-area/editor-tabs.tsx) — `onRevealInSidebar` calls `setActiveTab(tab.id)`. That only updates the active tab; it does not expand ancestors, scroll the row into view, or force the sidebar open if it's collapsed. The highlight in `FileTreeNode` driven by `useIsActive` only paints when the row is already in the rendered, expanded slice of the tree.
3. **No auto-reveal on file open.** Opening a file via wikilink Cmd-click, Cmd+P, drag-drop, recents, or the welcome screen updates `activeFilePath` in `editor-store` but never expands the sidebar's ancestor folders or scrolls the row into view. The user has to manually click through folders to locate the file they just opened.

(2) and (3) share the same primitive — a single owner that takes a file path and makes its row visible in the tree. (1) is unrelated in mechanism but lives in the same sidebar-state surface, and the reveal work depends on `directoryCache` / `expandedDirs` being correct, so it's natural to bundle the diagnosis here.

## Goals

- A single function `revealPathInSidebar(path, opts)` is the only place that expands ancestors + scrolls the tree row into view. The tab context menu calls it; an auto-reveal hook subscribed to `activeFilePath` calls it; future entry points (e.g. "Go to definition" in MCP) call it.
- Opening a file via any entry point lands the user with that file's row visible (parents expanded, scrolled into view) in the sidebar — without changing the call sites.
- The tab context menu's "Reveal in sidebar" works and shows the sidebar if it was collapsed.
- The external watcher's remaining failure modes are characterized with reproducible recipes and addressed at the root cause; we stop layering guesses.

## Non-Goals

- Selecting (highlighting in sidebar but not opening) on right-click of a tab — out of scope; the menu item opens **and** scrolls.
- Auto-reveal on session restore is allowed but not required. Restore already sets `activeFilePath` synchronously, so the auto-reveal hook will fire once and either succeed or no-op depending on the tree's mount state. Either outcome is acceptable — we do not gate the hook on a "user-initiated" flag.
- Polling fallback for filesystems where FSEvents/inotify don't deliver (network mounts, FUSE, iCloud sync deltas). Carried over from the prior spec.
- A new sidebar tree implementation (virtualized list, alternate flatten algorithm, etc.). Existing flat-list render is fine; this spec only changes how we drive ancestor expansion and scroll.

## Problem 1: External file changes still miss

### What we know is already fixed

From [`external-file-watcher-spec.md`](./external-file-watcher-spec.md) and `CHANGELOG.md` (2026-05-03, 2026-05-07):

- `should_ignore` is workspace-root-aware; dotdir workspaces (`~/.notes/`) fire events.
- `prepare_workspace_state` canonicalizes the root; `/var → /private/var` aliasing no longer desyncs the cache key.
- `is_self_write` is a TTL window, not consume-on-first-match — fan-out of `Create + Modify(Metadata) + Modify(Data)` from one save is all suppressed.
- `Modify(Name(_))` (Finder "Move to Trash", `mv`) is treated as a membership change; the index uses `path.exists()` as ground truth.
- `Create(Folder)` / `Modify(Name)` for a renamed-in folder walks descendants into the index.
- Non-`.md` files and folder deletes still fire a parent `fs:directory-changed`.
- `build_restore_bundle` and the frontend's `openWorkspace` both use the canonical root from `WorkspaceInfo.root`.

The end-to-end path exists and works for the cases above. The question is what's left.

### Candidate residual failure modes

These are the plausible remaining causes, ranked by the evidence available from a code read. **Most need a quick logging pass to confirm before they earn a fix.**

#### A. Self-write TTL is too short for delayed-sync filesystems (most likely)

`SELF_WRITE_TTL = 2s` ([`watcher.rs:11`](../apps/desktop/src-tauri/src/watcher.rs)). On iCloud Drive, Dropbox, or SMB-mounted workspaces, the OS-level sync runs _after_ the local write completes — FSEvents may fire 5–30 seconds later when sync replication reports the change. By then the TTL has expired, the event is no longer flagged as a self-write, and the editor reloads from disk, potentially clobbering keystrokes the user has typed since the save.

**Inverse symptom of the original bug, same root cause:** the 2s window was too short _outwards_ (events from one save still landing after consume-on-first) — and is also too short _inwards_ (delayed-sync filesystems echo our own write back well past 2s).

A fix that doesn't depend on guessing the right TTL: **content-hash matching, not timestamp.** When `record_write` is called, store the bytes-just-written hash alongside the path. On an incoming event, read the file, hash it, and suppress if it matches a recorded hash within a (much wider) window — and remove the entry on first match. Externally-written content with a different hash falls through.

This swaps "timestamp coincidence" for "content equality" and removes the TTL guess. Cost: one extra fs read per watch event during the self-write window (cheap; only checked when the path matches a recent write). Risk: two saves of identical content in a row would be conflated — acceptable, that's idempotent.

#### B. ~~Notify's macOS FSEvents backend coalesces events into batches that exceed our debounce~~ — **ruled out**

Initial read suggested the `if pending.is_empty() || last_emit.elapsed() < DEBOUNCE_MS` gate at `watcher.rs:248` could double the debounce window to ~600 ms. Closer trace shows it doesn't: `recv_timeout` returns immediately when an event arrives and waits up to `DEBOUNCE_MS` otherwise; after a `continue`, the next `recv_timeout` waits _up to_ the remaining debounce window. Worst-case latency from a single event to flush is ~`DEBOUNCE_MS` (300 ms), which is the intended debounce behavior. Leaving this here so a future reader doesn't re-investigate.

#### C. The `fs:directory-changed` `expandedDirs` filter drops legitimate refreshes

[`use-file-watcher.ts:51`](../apps/desktop/src/hooks/use-file-watcher.ts):

```ts
if (expandedDirs.has(path) || path === root) {
  void refreshDirectory(path);
} else {
  invalidatePath(path);
}
```

A `fs:directory-changed` event for an _unexpanded_ directory just invalidates the cache. That's correct **if** the user later expands and re-reads — but it means a tree slice you've never expanded won't update its `dirs_with_markdown` indicator (the "this folder contains markdown" dot rendered in the sidebar) in response to an external create until the user expands. For users who keep most folders collapsed, an external `git pull` that adds a `.md` inside a never-expanded directory doesn't visibly do anything.

Probably **not the primary missing-event report** — but worth confirming. The `dirs_with_markdown` set is maintained on the Rust side ([`watcher.rs:118`](../apps/desktop/src-tauri/src/watcher.rs)) and read via the directory listing IPC, so the next directory read picks it up. The frontend just needs a way to surface it without expanding.

Out of scope for the fix but the SPEC flags it.

#### D. Listener gets torn down on workspace switch within the same window

`useFileWatcher()` is invoked at the `App` root, mounted exactly once per webview window. Subscription deps are `[]`. The Rust-side watcher is rebuilt per workspace open (`prepare_workspace_state` calls `start_watcher` for the canonical root). Events fire with the new window label; the existing JS listener stays subscribed via the Tauri event bus.

This is fine and probably not a cause of missed events. **Confirming this rules out a whole class of suspicions** — record the negative result so future investigations skip it.

#### E. Atomic-replace by external editors

vim's `:w` does `write tempfile → rename(tempfile, target)`. FSEvents emits `Create(File)` for the temp, `Modify(Name(_))` for the rename. For the _target_ path:

- `Modify(Name)` → `event_kind_str` returns `"modified"` → `fs:file-changed` fires → frontend reloads. ✓
- Membership-change branch kicks in: `is_md && path_exists` → `add_to_index`. ✓

This should work after the prior spec landed. Confirm with a manual vim-save repro before assuming otherwise.

#### F. Symlinked workspace roots, post-canonicalization

If the user opens `~/notes` and that's a symlink to `~/Documents/notes`, after canonicalization the workspace root is the resolved path. `directoryCache` keys are stored canonical. Watcher events arrive canonical. The frontend's `root` matches. ✓ — but the session file from a previous launch may still store the un-canonical root. `prepare_workspace_state` should canonicalize before lookup; the prior spec already mentions this. Confirm in code that recents-list rehydration also normalizes.

### Proposed investigation plan

Before writing any fix:

1. **Add debug logging** behind a feature flag or `tracing::debug!` calls at four points in `watcher.rs`:
   - Event arrival into the channel.
   - Filter decisions (`should_ignore`, `is_workspace_ignored`, `is_self_write` — which one suppressed).
   - Emit to frontend.
   - `recent_writes` retention size, last-write timestamps.

   Wire to a dev-only console mirror on the frontend (`use-file-watcher.ts` logs every received event). Cost: one log per event during a repro, no production cost.

2. **Manual repro matrix** (do all on macOS dev build):
   - vim `:w` to an open file → does the editor reload reflect the disk content?
   - `echo > foo.md` from terminal to a new file → does the sidebar show it?
   - Drop a folder of `.md` files in via Finder → do they all appear?
   - `mv old.md new.md` via terminal → does the rename appear in the sidebar?
   - Cmd+S a Writer-open file, then within 100 ms type 5 characters → are all 5 retained?
   - Cmd+S, wait 3 s, edit externally to the same file → does the external content replace the editor buffer? (regression check for the TTL widening if we widen it)
   - Cmd+S an iCloud-Drive workspace file, observe whether a delayed echo event arrives outside the 2 s window. (If you can't reach an iCloud workspace easily, simulate via a sleep-injected mock save.)

3. **Then** pick the fix(es) supported by what the logs showed. The primary expected outcomes:
   - (A) is real → switch to content-hash self-write detection.
   - Others either confirm clean or fall out of scope.

This spec deliberately does not pre-commit to a fix until logs are read. It documents the candidates and the repro recipes so the next round is bounded.

## Problem 2: Tab context menu "Reveal in sidebar" is broken

### Current code

[`editor-tabs.tsx:138`](../apps/desktop/src/components/editor-area/editor-tabs.tsx):

```ts
onRevealInSidebar: () => {
  // Setting the active file highlights it in the sidebar tree
  setActiveTab(tab.id);
},
```

The comment is aspirational — `setActiveTab` only updates `activeTabId` / `activeFilePath`. The sidebar tree row's highlight depends on `useIsActive(entry.path)` ([`file-tree-node.tsx:50`](../apps/desktop/src/components/sidebar/file-tree-node.tsx)), which paints when the row is rendered. But the row is rendered **only if its ancestors are expanded** ([`flatten-tree.ts:17`](../apps/desktop/src/components/sidebar/flatten-tree.ts)): `if (entry.is_dir && expandedDirs.has(entry.path)) { recurse(...) }`. If a parent is collapsed, the row isn't in the DOM, the highlight is invisible, and the scroll target doesn't exist.

Furthermore, if `isSidebarVisible === false` ([`use-sidebar.ts`](../apps/desktop/src/hooks/use-sidebar.ts)), the entire `<Sidebar>` is collapsed and the user sees nothing change.

### Fix (architecture-level)

Introduce a single coordinator that does the three jobs the action needs:

1. Resolve the chain of ancestor directories from the workspace root to the file's parent.
2. For each ancestor not in `expandedDirs`, call `toggleDirectory(dir)` and await it — this populates `directoryCache[dir]` if missing and adds `dir` to `expandedDirs`.
3. After expansion, find the row via `[data-tree-path]` attribute on `FileTreeNode` and call `scrollIntoView({ behavior: "auto", block: "nearest" })`.
4. Optionally force the sidebar open (`appearance.sidebar-visible = true`) — opt-in via a flag, **on** for the tab-context-menu use, **off** for auto-reveal.

API shape:

```ts
// apps/desktop/src/lib/reveal-in-sidebar.ts
export async function revealPathInSidebar(
  path: string,
  opts: { showSidebar?: boolean } = {},
): Promise<void>;
```

Implementation lives in `lib/`, not as a hook, because it has no React state of its own — it reads from `workspace-store` / `settings-store`, calls store actions, and queries the DOM. It is invoked imperatively from event handlers (tab context menu) and from a React subscription hook (problem 3).

### Edge cases

- **Path outside the workspace root.** `path.startsWith(root + "/")` check up front; if false, no-op. (Cmd-click on an absolute wikilink outside the workspace is plausible.)
- **Workspace not loaded yet.** No-op if `root === null`. The auto-reveal hook for problem 3 will re-fire when `root` lands and `activeFilePath` is still set.
- **Ancestor directory is filtered by gitignore / `should_ignore`.** Not exposed in the tree, so the leaf can't be reached. `toggleDirectory` would silently succeed but the child wouldn't appear. Tolerable; the user opened a file outside the visible tree on purpose. Document the behavior, don't try to bypass the filter.
- **Path's case differs from disk** (case-insensitive FS). The directory cache uses exact-string keys. Out of scope; the editor store already uses the path as-passed and would mismatch the watcher too.
- **DOM row not present after expansion.** `directoryCache` write triggers a re-render but the row appears one paint later. Await one `requestAnimationFrame` (or `flushSync`-free equivalent) after the last `toggleDirectory` resolves, then query. If still missing (large list, virtualization later), fall back to a short polling loop bounded by ~5 frames.
- **Sidebar visible but the row's container is scrolled out.** `scrollIntoView({ block: "nearest" })` handles both directions; already tested for tab strip in `use-scroll-active-tab-into-view.ts`.

### File-tree-node data attribute

`FileTreeNode` gains a `data-tree-path={entry.path}` attribute on the `<button>`. Mirrors `data-tab-id` on tabs. No other change to the component.

## Problem 3: Auto-reveal on file open

### The seam

Every file-open entry point (sidebar click, Cmd-click wikilink, command palette, drag-drop, welcome, recents, session restore) eventually mutates `useEditorStore.activeFilePath`. There is exactly one place where we can hook: a subscription on that field.

Confirmed entry points that converge here:

- `editor-store.openFile` → sets `activeFilePath` ([`editor-store.ts:351`](../apps/desktop/src/stores/editor-store.ts))
- `editor-store.openFileInNewTab` → sets `activeFilePath` (line 374)
- `editor-store.replaceTabWithFile` → sets `activeFilePath` (line 461)
- `editor-store.navigateToFile` → sets `activeFilePath` (line 596)
- `editor-store.navigateBack`/`navigateForward` → sets `activeFilePath` (lines 648, 668)
- `editor-store.setActiveFile` → sets `activeFilePath` (line 552)
- `editor-store.setActiveTab` → derives `activeFilePath` (line 558)
- `editor-store.restoreSession` → sets via the same derivation

Touching this one seam reveals on every path without per-call-site changes. No need to sprinkle `revealPathInSidebar(...)` at each `openFile` call.

### Hook shape

Per CLAUDE.md / [`feedback_no_useeffect_in_components.md`](../../../../.claude/projects/-Users-joel-j-projects-writer-computer/memory/feedback_no_useeffect_in_components.md): no `useEffect` in components — abstract into a hook.

```ts
// apps/desktop/src/hooks/use-auto-reveal-active-file.ts
export function useAutoRevealActiveFile() {
  // Subscribes to editor-store.activeFilePath; on change to a non-null path
  // that differs from the previous tick, calls revealPathInSidebar(path).
  // Implementation can use either useEffect with selector subscription, or
  // useStore.subscribe in a useEffect to avoid render-time work.
}
```

Mounted once at `App` root next to `useFileWatcher()`.

### Edge cases

- **Same-path repeats** (refresh button, no-op tab switch): hook compares previous-vs-next path, no reveal on equal.
- **Path nulled** (closed last tab, launcher active): no-op.
- **Path changes during session restore** before sidebar mounts: `revealPathInSidebar` checks `root` and reads `directoryCache` lazily; if no root yet, no-op. The subscription fires again whenever `activeFilePath` re-changes — but on restore that's once. If the restored file's row isn't present at first paint (because we haven't expanded anything), the auto-reveal expands ancestors as part of its normal job. Acceptable.
- **Rapid re-navigation** (back/forward held): each transition fires the hook. The async expand awaits `toggleDirectory` per ancestor; subsequent calls overlap. Add a single cancellation token (latest call wins) so we don't scroll to a stale path. Mirrors the `pendingNavigation` pattern already used in `editor-store`.
- **`openFileInNewTab` from sidebar context menu**: this also reveals. Fine — the file is already visible by definition since the user right-clicked it.
- **Wikilink Cmd-click on an open-but-collapsed sibling**: hook expands ancestors and scrolls. ✓
- **Auto-reveal vs. user manually collapsing a parent immediately after open**: the user's collapse wins because the hook only fires on `activeFilePath` change, not on `expandedDirs` change.

### Should auto-reveal force-open the sidebar?

**No.** If the user collapsed the sidebar, they collapsed it on purpose. Auto-reveal only adjusts state inside the sidebar; it doesn't pop the chrome open. Only the explicit "Reveal in sidebar" action does that.

## Cross-cutting design notes

### Single source of truth

`revealPathInSidebar` is the only entry point that mutates `expandedDirs` for the purpose of revealing a file. Sidebar click handlers and the "expand ancestor on new file" path in `folder-context-menu` continue to manage their own `toggleDirectory` calls for their own reasons; we don't unify those — they have distinct semantics (toggle, not reveal).

### Side-effect ownership

Per [`docs/consolidation.md`](../docs/consolidation.md): one write path. The reveal coordinator owns the expansion/scroll side effects. Auto-reveal subscribes via a hook; the menu action calls the function directly. Both paths converge on the same `lib/reveal-in-sidebar.ts`.

### No registry of per-entry-point shims

We deliberately do **not** add a `useRevealOnSidebarClick`, `useRevealOnWikiLink`, `useRevealOnCommandPalette`, etc. The seam is `activeFilePath`; one subscription covers all of them. Adding per-entry-point shims would be the "consolidation.md" anti-pattern.

### File-naming

Per CLAUDE.md memory ([`feedback_kebab_case_filenames.md`](../../../../.claude/projects/-Users-joel-j-projects-writer-computer/memory/feedback_kebab_case_filenames.md)):

- `apps/desktop/src/lib/reveal-in-sidebar.ts`
- `apps/desktop/src/hooks/use-auto-reveal-active-file.ts`

## Acceptance criteria

### Reveal in sidebar (Problem 2)

- [ ] Right-click on a tab whose file lives several folders deep in a workspace where those folders are collapsed → "Reveal in sidebar" expands the ancestor chain, scrolls the file row into view, and shows the row's active-state highlight.
- [ ] Right-click on a tab while the sidebar is collapsed → "Reveal in sidebar" force-opens the sidebar (sets `appearance.sidebar-visible = true`), then performs the reveal.
- [ ] Right-click on a tab whose file is _outside_ the workspace root → menu item is either omitted or no-ops gracefully (no console error).

### Auto-reveal on file open (Problem 3)

- [ ] Cmd-click a wikilink to a file in a collapsed deep folder → file opens **and** sidebar tree expands to it.
- [ ] Open a file from Cmd+P → sidebar tree expands and scrolls to it.
- [ ] Drag-drop a file in the workspace onto the window → opens and reveals.
- [ ] Open a recent file from the welcome screen → reveals.
- [ ] Open a file via the launcher tab's "Open file" button → reveals.
- [ ] Back/forward navigation between files reveals each.
- [ ] Auto-reveal does **not** force-open a collapsed sidebar.
- [ ] Session restore on app start: if a file tab is active, the row is visible in the sidebar without the user having to expand anything.
- [ ] Repeated activations of the same path do not re-scroll.

### External file watcher (Problem 1)

- [ ] Debug logs added behind `tracing::debug!` macros at the four watcher decision points listed above.
- [ ] All seven manual repros from the investigation plan run on a dev build, results recorded (in the SPEC, or in a follow-up doc the SPEC links to).
- [ ] If hypothesis A (TTL too short for delayed-sync FS) confirms: replace timestamp matching with content-hash matching in `is_self_write` / `record_write`. New `cargo test` coverage: a self-write with a 30-second-delayed echo is still suppressed (content matches); an external write 100 ms after a save with **different** content falls through (content differs).
- [ ] No regression in the existing test suite: `should_ignore_*`, `self_write_*`, `add_subtree_*`, `remove_subtree_*` (`watcher.rs:451+`) continue to pass.

### Cross-cutting

- [ ] No `useEffect` in any component touched by this change — all logic in `useAutoRevealActiveFile` and `revealPathInSidebar`.
- [ ] All new files kebab-case.
- [ ] `vp check` and `vp test` pass.
- [ ] `cargo test`, `cargo clippy`, `cargo fmt --check` pass under `apps/desktop/src-tauri/`.

## Validation

- Frontend: `vp check`, `vp test`.
- Rust: `cd apps/desktop/src-tauri && cargo test && cargo clippy && cargo fmt --check`.
- Manual: each acceptance criterion run on a macOS dev build via `vp run dev`.

## References

- [`SPECs/external-file-watcher-spec.md`](./external-file-watcher-spec.md) — prior watcher work this builds on.
- [`docs/consolidation.md`](../docs/consolidation.md) — single source of truth, side-effect ownership.
- [`docs/zustand.md`](../docs/zustand.md) — selector + subscription patterns for the auto-reveal hook.
- [`apps/desktop/src/hooks/use-scroll-active-tab-into-view.ts`](../apps/desktop/src/hooks/use-scroll-active-tab-into-view.ts) — pattern to mirror for the scroll step (data attribute + `scrollIntoView({ block: "nearest" })`).
