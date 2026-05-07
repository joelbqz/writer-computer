# Agent Review Protocol

## When To Run Review

Run review when:

- User or agent explicitly asks for review.
- Finishing feature or bugfix work before handoff.
- Significant refactor or state-flow change lands.

**Skip formal review** for trivial fixes (typos, one-line changes, obvious single-file corrections) where the risk of regression is negligible. Note the skip reason in the commit message.

## Context Isolation

Each review persona **must run in a separate sub-agent with fresh context**. Do not run review inside the agent that performed investigation or wrote the implementation.

Why this matters: the implementing agent has already rationalized its design decisions and internalized its assumptions. A reviewer sharing that context will echo those assumptions instead of challenging them. The whole point of peer review is an unpolluted perspective — different vantage points catch blind spots, spec drift, and unconsidered alternatives that the author cannot see.

Concretely:

- Spawn one sub-agent per activated persona.
- Give each sub-agent: this file (agent-review.md), the TODO, human spec (if any), agent worksheet, and the diff.
- The sub-agent should load its own persona's owned docs (listed below), plus `git log --oneline -20` and the `git diff` for the target change set.
- Do **not** pass the implementing agent's full investigation trail, chat history, or reasoning.

## Review Personas

Activate only the personas relevant to the changed surface area. Each persona owns specific docs and should load them as context for every review. Reviewers should also flag improvements to their own docs (clarity, conciseness, correctness, missing info) as part of their findings.

- **React/Frontend Expert**: React idioms, component lifecycle, rendering performance, hook correctness, memo boundaries, effect cleanup.
  Owned docs: `docs/react-guidelines.md`.

- **Zustand/State Expert**: store design, selector patterns, bail-out optimizations, side-effect timing relative to `set()`, Map/Set reference semantics, cross-store subscriptions.
  Owned docs: `docs/zustand.md`.

- **Editor Expert**: CodeMirror/Prosemark extension patterns, `reloadVersion` and instance-key semantics, widget decorations, scroll container detection, paste handling, context menu integration with native Tauri menus.
  Owned docs: `docs/editor.md`, relevant `SPECs/` for the change.

- **Rust/Tauri Expert**: Tauri IPC command design, async command patterns, `AppState` management, file system watcher correctness, lock contention, error serialization over IPC, `cargo clippy` compliance.
  Owned docs: `CLAUDE.md` (Architecture section), Rust source in `apps/desktop/src-tauri/src/`.

- **Startup/Workspace Expert**: multi-stage initialization flow, session save/restore, workspace switching race conditions, navigation versioning, pending-open queue ordering.
  Owned docs: `docs/workspace-lifecycle.md` (when created), relevant store files.

- **UX Expert**: clarity and usability of sidebar, editor chrome, command palette, context menus, keyboard shortcuts, and interaction flows.
  Owned docs: relevant `SPECs/` for the change.

- **Systems Architect**: ownership boundaries, coupling between frontend and Rust, wrong-layer placement, state bloat, async sequencing correctness.
  Owned docs: `CLAUDE.md` (Engineering Guardrails, Architecture sections).

- **QA Engineer**: coverage quality, regression risk, test adequacy and test selection. Validates that tests are legitimate (no hardcoded expected values, no skipped assertions).
  Owned docs: test files in `apps/desktop/src/`.

Each persona should also load any spec or doc directly relevant to the files being changed, even if not listed above.

**Persona activation guidance:**

- Touching UI components or interaction flows → include UX.
- Touching Zustand stores → include Zustand/State.
- Touching CodeMirror extensions or editor panes → include Editor.
- Touching Rust commands or `src-tauri/` → include Rust/Tauri.
- Touching startup flow or workspace switching → include Startup/Workspace.
- Touching state ownership or cross-layer boundaries → include Systems Architect.
- Any change with regression risk → include QA.

## Findings Format

Review output is findings-first and ordered by severity.

For each finding include:

- Severity (`P0` critical, `P1` high, `P2` medium, `P3` low)
- File and line reference
- Impact/risk
- Root cause (not just symptom)
- Recommended fix direction

If there are no findings, explicitly say so and list residual risks/testing gaps.

## Quality Checklist

- Derived state over new state variables where possible.
- Spec compliance: all design constraints must be met as specified, not approximated, without very good reason. If not following spec exactly, explain why in the commit message.
- Correct ownership: components display state, stores own state, Rust owns filesystem.
- File growth under control: extract when complexity grows, but don't prematurely abstract.
- Relevant docs updated when behavior or rules changed.
- Reviewers should recommend updates to their own persona's docs whenever they notice gaps, stale info, unclear language, or missing coverage.
- Commit cadence verified: in loop mode, one commit per completed task (unless user explicitly requested batching).
- For user-visible work, [`CHANGELOG.md`](../../CHANGELOG.md) updated in the same task/commit.
- `vp check` passes (format, lint, TypeScript).
- `cargo clippy` and `cargo fmt --check` clean for changed Rust files.
- No unused variables or dead-code declarations remain in changed files.
- Tests run are appropriate for risk and scope; gaps are called out.
- Async flows are race-safe: explicit sequencing, cancellation, or ownership where needed.
- Map/Set references are cloned (not mutated in place) before passing to `set()`.
- Side effects are hoisted outside `set()` callbacks.
- Effect cleanup handles all subscriptions (especially Tauri `listen()` which returns `Promise<unsubscribe>`).

## Output Template

1. **Findings** (ordered high to low severity)
2. **Open Questions / Assumptions**
3. **Residual Risk / Testing Gaps**
4. **Overall Assessment** (one short verdict)

Keep summaries brief. The primary deliverable is actionable findings.

## Escalation Rules

Block handoff when:

- A `P0` or unresolved `P1` finding remains.
- A likely regression risk is untested in a high-impact path.
- Ownership or state architecture regresses materially.

Warn (non-blocking) when:

- Only `P2/P3` issues remain with clear follow-up path.
- Risks are minor and explicitly documented.
