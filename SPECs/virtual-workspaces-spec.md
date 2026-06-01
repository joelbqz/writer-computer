---
title: Virtual Workspaces
---

# Virtual Workspaces

## Summary

Add named virtual workspaces managed through the `writer` CLI. A virtual workspace is a saved collection of absolute file and folder references from anywhere on the local filesystem. The workspace owns only the definition; it never copies, moves, renames, or deletes the referenced files.

## Goals

- Create, list, open, add to, remove from, and delete virtual workspaces through `writer workspace ...`.
- Accept comma-separated absolute paths through `--files`.
- Reject non-absolute paths with a clear error.
- Store references as absolute canonical paths when the target exists.
- Allow both file and folder references.
- Preserve a referenced folder's nested structure in the virtual tree.
- Keep workspace `remove` and `delete` purely metadata operations; referenced files and folders stay on disk.
- Show missing direct references as unavailable instead of crashing.
- Keep virtual workspaces read-only inside Writer: no rename, delete, duplicate, create-file, or create-folder actions from the virtual sidebar.

## Non-Goals

- No file rename support inside virtual workspaces.
- No copying or materializing files into a temporary folder.
- No symlink-based workspace mirror.
- No cross-device file watching for every referenced folder in this pass.
- No broad CLI refactor beyond the existing dependency-free parser.

## Command Surface

```bash
writer workspace new <name> --files=<absolute-path-a>,<absolute-path-b>
writer workspace list
writer workspace open <name>
writer workspace add <name> --files=<absolute-path-a>,<absolute-path-b>
writer workspace remove <name> --files=<absolute-path-a>,<absolute-path-b>
writer workspace delete <name>
```

`workspace open` launches Writer with a virtual workspace URI. The desktop backend resolves the URI, reads the saved definition, and presents a read-only folder tree over the referenced files and folders.

## Persistence

Virtual workspace definitions are stored in app data as `virtual_workspaces.json`. Tests and development can override the store location with `WRITER_VIRTUAL_WORKSPACES_FILE`.

Each workspace stores:

- `name`
- `references[]`
  - `path`: absolute path string
  - `kind`: `file` or `folder`

`kind` is captured when the reference is added so a later missing path can still be shown as the expected kind.

## Folder View Rules

- A referenced file appears at the virtual root under its filename.
- A referenced folder appears at the virtual root under its folder name.
- Children of a referenced folder preserve their nested relative paths.
- Hidden paths are omitted from live folder expansion.
- Markdown files are shown; directories are shown so nested structure can be traversed.
- Direct references that later disappear remain visible with `missing: true`.

Root display-name collisions are rejected when creating or adding references. This keeps the virtual tree unambiguous without inventing synthetic display names.

## Safety

Virtual workspace operations mutate only `virtual_workspaces.json`. `remove` deletes references from the definition only. `delete` deletes the workspace definition only. The desktop sidebar disables mutating context-menu actions while a virtual workspace is open, and the command palette suppresses create-file actions for virtual roots.

## Validation

- Rust unit tests for CLI parsing and dispatch.
- Rust unit tests for persistence, add/remove/delete safety, non-absolute rejection, missing direct references, folder expansion, and virtual index generation.
- Existing frontend tests remain applicable for read-only sidebar behavior where practical.
