# Keyboard Shortcuts

Canonical shortcut reference for Writer.

## Global

These shortcuts are handled by the global `useKeyboardShortcuts` hook and work regardless of editor focus.

| Shortcut        | Action                        |
| --------------- | ----------------------------- |
| Cmd+P           | File search (command palette) |
| Cmd+O           | Go to file                    |
| Cmd+N           | Create new note               |
| Cmd+T           | New tab                       |
| Cmd+W           | Close current tab             |
| Cmd+\\          | Toggle sidebar                |
| Ctrl+Tab        | Next tab                      |
| Ctrl+Shift+Tab  | Previous tab                  |
| Cmd+1 ... Cmd+9 | Jump to Nth tab               |
| Alt+ArrowLeft   | Navigate back                 |
| Alt+ArrowRight  | Navigate forward              |

## Menu Accelerators

These shortcuts are bound to the native app menu (Tauri menu accelerators) rather than the global JS handler.

| Shortcut | Action                                                |
| -------- | ----------------------------------------------------- |
| Cmd+,    | Open Preferences (Settings tab) in the focused window |

## Editor Formatting

These shortcuts are handled by the `markdownFormatting` CodeMirror extension and only apply when the editor is focused.

| Shortcut                | Action                    |
| ----------------------- | ------------------------- |
| Cmd+B                   | Bold                      |
| Cmd+I                   | Italic                    |
| Cmd+K                   | Insert link               |
| Cmd+E                   | Inline code               |
| Cmd+Shift+X             | Strikethrough             |
| Cmd+Shift+8             | Bullet list               |
| Cmd+Shift+7             | Numbered list             |
| Cmd+Shift+.             | Blockquote                |
| Cmd+Shift+Enter         | Task list                 |
| Cmd+Alt+1 ... Cmd+Alt+6 | Heading 1-6               |
| Cmd+Alt+0               | Paragraph (strip heading) |

## Editor (inherited from CodeMirror)

Standard editing shortcuts provided by CodeMirror's basic setup.

| Shortcut             | Action                         |
| -------------------- | ------------------------------ |
| Cmd+Z                | Undo                           |
| Cmd+Shift+Z          | Redo                           |
| Cmd+A                | Select all                     |
| Cmd+D                | Select next occurrence         |
| Cmd+/                | Toggle line comment            |
| Alt+ArrowUp          | Move line up                   |
| Alt+ArrowDown        | Move line down                 |
| Alt+Shift+ArrowUp    | Copy line up                   |
| Alt+Shift+ArrowDown  | Copy line down                 |
| Cmd+Shift+K          | Delete line                    |
| Cmd+Enter            | Insert line below              |
| Cmd+Shift+Enter      | Insert line above              |
| Tab                  | Indent / accept completion     |
| Shift+Tab            | Dedent                         |
| Cmd+]                | Indent more                    |
| Cmd+[                | Indent less                    |
| Cmd+F                | Find                           |
| Cmd+H                | Find and replace               |
| Cmd+G                | Find next                      |
| Cmd+Shift+G          | Find previous                  |
| Alt+Shift+ArrowLeft  | Extend selection by word left  |
| Alt+Shift+ArrowRight | Extend selection by word right |
