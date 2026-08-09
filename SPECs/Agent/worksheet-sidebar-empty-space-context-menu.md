# Sidebar empty-space context menu worksheet

## References

- TODO: `Sidebar empty-space context menu` in `TODOS.md`
- Spec: `SPECs/statusbar-sidebar-visibility-spec.md`
- User request: empty-space right-click creates files/folders at the workspace root and toggles Recents.

## Reviewed

- `AGENTS.md`, `docs/workflows/agent-loop.md`, `docs/workflows/agent-review.md`
- `docs/consolidation.md`, `docs/react-guidelines.md`
- `apps/desktop/src/components/sidebar/file-browser.tsx`
- `apps/desktop/src/components/sidebar/sidebar-surface-context-menu.ts`
- `apps/desktop/src/components/sidebar/{folder-context-menu,use-file-tree-context-menus}.ts{,x}`
- `apps/desktop/src/components/command-palette/index.tsx`
- `apps/desktop/src/{hooks/use-command-palette.ts,stores/ui-store.ts}`
- Existing surface/folder context-menu and UI-store tests

## Starting state

- Worktree was clean on branch `esquel-glacier`; the branch already contains the Search/Recents visibility menu merged in PR #107.
- `vp install` completed with the lockfile unchanged.
- Baseline `vp test`, `cargo test`, `cargo clippy`, and `cargo fmt --check` passed. Rust reported existing warnings only.
- Baseline `vp check` failed because `apps/desktop/e2e/specs/visibility-settings.spec.js` needs formatting; this is pre-existing on the clean branch and will be formatted in this task so final validation can pass.

## Plan

1. Extend the surface-menu spec with New File, New Folder, and a separator before the existing visibility check items. Keep one ordered menu-spec builder and teach the native renderer to construct normal items, separators, and check items from it.
2. Route New File through the existing command-palette naming flow. Add a parallel `create-folder` intent so New Folder gets the same focused naming experience. Consolidate both intents behind a typed entry-creation hook/module that validates one visible basename, derives the path beneath its parent directory, owns IPC/refresh/file-opening order, and suppresses stale-workspace UI effects.
3. Keep the naming flow open with its input and an inline error when creation fails. Use intent-specific File/Folder copy. Make truly empty, non-ignored directories visible in the backend directory listing so a newly created folder does not disappear; continue filtering directories that contain only non-Markdown content.
4. Extend unit coverage for menu order/dispatch, the mixed native renderer, intent state, root-name validation, and injected file/folder creation sequences. Add Rust coverage for empty-directory visibility. Update user-facing docs/changelog and tracking.
5. Run targeted tests while implementing, then `vp check`, `vp test`, and the Rust validation suite. Runtime-check the web UI where the native-menu boundary permits it; manually verify native-menu target propagation in the built app.

## Risks and edge cases

- File names retain the existing `.md` normalization; folder names must not gain an extension.
- Folder creation is workspace-only and should not appear in standalone compact windows.
- Failed creation must not silently disappear or discard the entered name.
- Existing file/folder row menus must continue to stop propagation and retain their specialized actions.

## Plan review

- UX, React, and QA reviewers all identified two blocking gaps in the first plan: raw input could escape/nest below the root, and empty folders are filtered from Everything. The revised plan enforces basename-only input and makes truly empty directories visible without exposing directories that contain only non-Markdown content.
- React/QA requested one consolidated, injectable create pipeline rather than parallel side effects inside `CommandPalette`; the revised plan moves creation ownership to a focused hook/module and tests success/failure sequencing.
- QA requested native-renderer coverage in addition to the pure menu spec and an explicit propagation checklist; both are now part of verification.
- UX requested intent-specific copy and retry behavior; failures will remain in the naming flow with the input intact.

## Implementation and results

- The native sidebar-surface menu now renders New File, New Folder, a separator, then the existing Search and Recents check items from one discriminated spec.
- The root actions immediately create the next available `Untitled.md` or `Untitled Folder`, refresh Everything, and start inline rename. `sidebar-entry-creation.ts` shares unique-name and creation behavior with folder-row menus and suppresses root follow-up effects after a workspace switch.
- The existing command-palette New File flow uses `entry-creation.ts` for basename validation, Markdown extension normalization, and workspace/standalone create sequencing. Once creation succeeds, refresh/open failures close the naming flow and surface separately so retry cannot collide with the already-created entry. `refreshDirectory` also drops responses that complete after a workspace switch.
- `read_directory_impl` now includes truly empty directories while retaining the filter for directories containing only non-Markdown content, so a new folder is immediately visible.
- Targeted TypeScript tests cover menu order/dispatch/native construction, root unique-name creation and refresh/rename sequencing, safe command-palette path planning, async file creation and failure paths, UI-store intents, and stale refresh responses. Rust tests cover empty-directory listing with and without the ready index.
- Runtime: a release-style E2E build verified both native root actions create on disk and enter inline rename. The macOS popup requires physical mouse injection and proved nondeterministic under WebDriver, so the flaky harness is not part of the committed suite; deterministic tests cover the shared coordinator and native-menu construction boundary.
- Runtime also exposed pre-existing Radix dialog title/description warnings. Recorded as a separate backlog item rather than expanding this task.
- Final validation: `vp check` (one pre-existing `wdio.conf.js` warning), `vp test` (39 files / 555 tests), `cargo test` (123 tests), `cargo clippy` (pre-existing warnings only), and `cargo fmt --check` all passed.

## Implementation review

- Standards review found three P2 ownership/error issues and two P3 modeling/name concerns. The follow-up funnels workspace and compact creation through `useCreateEntry`, keys create-error state by intent without a component effect, propagates empty-directory read failures, derives paths from parent+name, and uses general entry/parent terminology.
- Spec review found one P2 false-retry path when creation succeeded but refresh failed. The pipeline now rejects only creation failures; refresh/open failures are returned as follow-up failures, the palette closes, files still attempt to open, and the user gets a separate warning instead of an AlreadyExists retry trap.
- A second standards pass found that a slow create request could update a newly reopened palette. Palette sessions now invalidate stale completions, with deferred success and failure tests covering both cases.
- Final correction review found no remaining P0-P2 issues after root and nested creation were moved to the shared immediate-create coordinator, workspace identity checks gained an epoch, and nested reveal became an idempotent guarded store action.

## PR feedback correction

- PR feedback showed that routing the root actions through a second command-palette naming step did not feel like creation. The final interaction now matches folder-row context menus: choosing New File or New Folder immediately creates the next available `Untitled.md` or `Untitled Folder`, refreshes Everything, and starts inline rename.
- `sidebar-entry-creation.ts` is the shared unique-name/create/reveal/rename boundary for root and folder-row actions. `use-root-sidebar-entry-creation.ts` owns root IPC and error presentation; both root and nested follow-up work check the active workspace identity before touching the tree. Nested creation uses an idempotent `ensureDirectoryExpanded` store action, whose root/epoch guard prevents a delayed directory read from expanding or overwriting a newer workspace.
- A release-style E2E build created both root entry kinds and entered inline rename through the native popup. The native popup is not exposed reliably to WebDriver, so the committed deterministic regression tests cover the shared creation coordinator, unique-name sequencing, refresh/rename order, and workspace-switch suppression; the flaky OS-coordinate harness was removed.
- Final review additionally caught trailing-root path joins and unsafe inline rename input. Separator-aware joins now keep `/Untitled.md` canonical, and inline rename shares the same basename-only validation as command-palette creation so traversal, separators, and hidden names remain in the rename flow instead of escaping the workspace or disappearing.
