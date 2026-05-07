---
title: AGENTS
---

Writer is a Tauri v2 desktop markdown editor: React frontend + Rust backend. It targets writers who use local-first plain-text workflows (Obsidian vaults, docs repos, personal wikis).

## This File

This is an **agent router**: concise context loaded every session. It routes the agent to relevant docs based on task intent. Deep guidelines, system rules, and review rubrics live in linked docs — not here.

## Architecture (Brief)

Stack: Tauri v2 (React + Rust)
Frontend: `apps/desktop/src/` — React, Zustand stores, CodeMirror/Prosemark editor
Backend: `apps/desktop/src-tauri/src/` — Rust IPC commands, file watcher, workspace state
Toolchain: Vite+ (`vp`) — see [docs/vite-plus.md](./docs/vite-plus.md)

Rust source structure:

- `lib.rs` — app setup, plugin registration, command registration
- `state.rs` — global app state (workspace root, file index, watcher handle)
- `error.rs` — error types serialized over IPC
- `watcher.rs` — file system watcher with debounce and self-write detection
- `commands/` — Tauri IPC handlers: `fs.rs`, `workspace.rs`, `search.rs`, `images.rs`

## Docs Index

All docs except CLAUDE.md, AGENTS.md, TODOS.md, and CHANGELOG.md live in `./docs/`. Feature specs live in `./SPECs/`.

**Workflow**

- [docs/workflows/agent-loop.md](./docs/workflows/agent-loop.md) — repeatable autonomous task execution loop
- [docs/workflows/agent-review.md](./docs/workflows/agent-review.md) — review personas, findings format, quality checklist, escalation rules
- [docs/workflows/worktrees.md](./docs/workflows/worktrees.md) — creating and managing parallel worktrees

**Guidelines**

- [docs/consolidation.md](./docs/consolidation.md) — if adding the next case touches more than one file, the structure is wrong: single source of truth, side-effect ownership, registry over per-case branches, one write path
- [docs/react-guidelines.md](./docs/react-guidelines.md) — imports, state, side effects, component structure, persistence
- [docs/zustand.md](./docs/zustand.md) — side effect timing, selectors, bail-out patterns
- [docs/editor.md](./docs/editor.md) — CodeMirror layout-model APIs, scroll-handler ownership, block-widget patterns (decoration shape, range-select to enter edit mode, posAtDOM boundary handling, button focus race, scrollSnapshot for heightmap shifts)
- [docs/vite-plus.md](./docs/vite-plus.md) — `vp` CLI usage and common pitfalls
- [docs/keyboard-shortcuts.md](./docs/keyboard-shortcuts.md) — canonical shortcut map

**Infra**

- [docs/releasing.md](./docs/releasing.md) — how to cut a signed, notarized macOS release
- [docs/website-deploy.md](./docs/website-deploy.md) — how to deploy the marketing website to Cloudflare Workers

**Cross-cutting**

- [TODOS.md](./TODOS.md) — task backlog and work-in-progress tracking
- [CHANGELOG.md](./CHANGELOG.md) — user-visible changes log
- [SPECs/](./SPECs/) — human-written feature and bug specs

## Hard Rules

- Check [`TODOS.md`](./TODOS.md) before starting work to see current tasks.
- Move tasks between sections (Up Next → In Progress → Done) as you work.
- For non-trivial work, create a spec in [`SPECs/`](./SPECs/) and link it from the task.
- Update [`CHANGELOG.md`](./CHANGELOG.md) when completing work.
- Load only docs relevant to the current task and scope.
- If a behavior or rule changes in practice, update the owning doc in the same task.
- In autonomous/loop mode, complete exactly one task at a time and commit immediately. Do not batch unless the user explicitly asks.
- When coding or reviewing, follow the Engineering Guardrails below and the guidelines in linked docs.

## Engineering Guardrails

- Prefer the smallest change that is correct, robust, and easy to reason about.
- Avoid fragile logic, hidden coupling, edge-case traps, and assumptions about incidental execution order.
- Keep async flows and shared state race-safe. Use explicit sequencing, cancellation, idempotency, or clear ownership where needed.
- Do not introduce unnecessary performance regressions. Avoid extra renders, allocations, subscriptions, scans, blocking work, or I/O unless clearly justified.
- Fail explicitly. Surface invalid states and unexpected errors clearly instead of silently swallowing them or masking them with fallback behavior.
- Preserve testability. Keep side effects at the boundaries, make dependencies explicit, and structure logic so it can be exercised in isolation when practical.
- Maintain clear boundaries, but prefer minimal designs. Split functions, hooks, or modules when responsibilities meaningfully diverge, not as a reflex.
- If a tradeoff is unavoidable, call it out explicitly and choose the option with the lowest long-term correctness and maintenance risk.
- When a fix doesn't work after one iteration, add a debug log before changing the approach again. Don't iterate on guesses — let the runtime tell you which term in the math is wrong.

## Validation

Frontend:

- `vp check` — format, lint, and TypeScript type checks
- `vp test` — JavaScript/TypeScript tests

Rust (from `apps/desktop/src-tauri/`):

- `cargo test`
- `cargo clippy`
- `cargo fmt --check`

## Session Wrap

Wrap per [agent-loop.md](./docs/workflows/agent-loop.md). One commit per completed task with a clear message. See the existing commit history for style.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, but it invokes Vite through `vp dev` and `vp build`.

## Vite+ Workflow

`vp` is a global binary that handles the full development lifecycle. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

### Start

- create - Create a new project from a template
- migrate - Migrate an existing project to Vite+
- config - Configure hooks and agent integration
- staged - Run linters on staged files
- install (`i`) - Install dependencies
- env - Manage Node.js versions

### Develop

- dev - Run the development server
- check - Run format, lint, and TypeScript type checks
- lint - Lint code
- fmt - Format code
- test - Run tests

### Execute

- run - Run monorepo tasks
- exec - Execute a command from local `node_modules/.bin`
- dlx - Execute a package binary without installing it as a dependency
- cache - Manage the task cache

### Build

- build - Build for production
- pack - Build libraries
- preview - Preview production build

### Manage Dependencies

Vite+ automatically detects and wraps the underlying package manager such as pnpm, npm, or Yarn through the `packageManager` field in `package.json` or package manager-specific lockfiles.

- add - Add packages to dependencies
- remove (`rm`, `un`, `uninstall`) - Remove packages from dependencies
- update (`up`) - Update packages to latest versions
- dedupe - Deduplicate dependencies
- outdated - Check for outdated packages
- list (`ls`) - List installed packages
- why (`explain`) - Show why a package is installed
- info (`view`, `show`) - View package information from the registry
- link (`ln`) / unlink - Manage local package links
- pm - Forward a command to the package manager

### Maintain

- upgrade - Update `vp` itself to the latest version

These commands map to their corresponding tools. For example, `vp dev --port 3000` runs Vite's dev server and works the same as Vite. `vp test` runs JavaScript tests through the bundled Vitest. The version of all tools can be checked using `vp --version`. This is useful when researching documentation, features, and bugs.

## Common Pitfalls

- **Using the package manager directly:** Do not use pnpm, npm, or Yarn directly. Vite+ can handle all package manager operations.
- **Always use Vite commands to run tools:** Don't attempt to run `vp vitest` or `vp oxlint`. They do not exist. Use `vp test` and `vp lint` instead.
- **Running scripts:** Vite+ built-in commands (`vp dev`, `vp build`, `vp test`, etc.) always run the Vite+ built-in tool, not any `package.json` script of the same name. To run a custom script that shares a name with a built-in command, use `vp run <script>`. For example, if you have a custom `dev` script that runs multiple services concurrently, run it with `vp run dev`, not `vp dev` (which always starts Vite's dev server).
- **Do not install Vitest, Oxlint, Oxfmt, or tsdown directly:** Vite+ wraps these tools. They must not be installed directly. You cannot upgrade these tools by installing their latest versions. Always use Vite+ commands.
- **Use Vite+ wrappers for one-off binaries:** Use `vp dlx` instead of package-manager-specific `dlx`/`npx` commands.
- **Import JavaScript modules from `vite-plus`:** Instead of importing from `vite` or `vitest`, all modules should be imported from the project's `vite-plus` dependency. For example, `import { defineConfig } from 'vite-plus';` or `import { expect, test, vi } from 'vite-plus/test';`. You must not install `vitest` to import test utilities.
- **Type-Aware Linting:** There is no need to install `oxlint-tsgolint`, `vp lint --type-aware` works out of the box.

## CI Integration

For GitHub Actions, consider using [`voidzero-dev/setup-vp`](https://github.com/voidzero-dev/setup-vp) to replace separate `actions/setup-node`, package-manager setup, cache, and install steps with a single action.

```yaml
- uses: voidzero-dev/setup-vp@v1
  with:
    cache: true
- run: vp check
- run: vp test
```

## Review Checklist for Agents

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to validate changes.
<!--VITE PLUS END-->
