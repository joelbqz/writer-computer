# Keyboard shortcuts

<!-- The canonical shortcut map. It is also published as is at writer.computer/docs/keyboard-shortcuts/, so keep the prose readable for users and put implementation notes in HTML comments like this one, which the site leaves out. The first line must stay "# Keyboard shortcuts" (see apps/website/src/docs/pages.ts). -->

Every keyboard shortcut in Writer Computer. On macOS, Cmd is ⌘, Alt is ⌥ (Option) and Ctrl is ⌃.

## Global

These work anywhere in the window, whether or not you are typing in a note.

<!-- Handled by the global `useKeyboardShortcuts` hook. -->

| Shortcut        | Action                                                                 |
| --------------- | ---------------------------------------------------------------------- |
| Cmd+P           | File search (command palette)                                          |
| Cmd+O           | Go to file                                                             |
| Cmd+N           | Create new note                                                        |
| Cmd+T           | New tab                                                                |
| Cmd+W           | Close current tab; hides the window when only an empty new tab is left |
| Cmd+\\          | Toggle sidebar                                                         |
| Ctrl+Tab        | Next tab                                                               |
| Ctrl+Shift+Tab  | Previous tab                                                           |
| Cmd+1 ... Cmd+9 | Jump to Nth tab                                                        |
| Cmd+= / Cmd++   | Zoom editor text in (numpad + works too)                               |
| Cmd+-           | Zoom editor text out (Cmd+Shift+- and numpad − work too)               |
| Cmd+0           | Actual size (zoom back to 100%)                                        |
| Alt+ArrowLeft   | Navigate back                                                          |
| Alt+ArrowRight  | Navigate forward                                                       |

Zoom scales the note text only, in preset stops (50–300%); the sidebar, tab
strip, and status bar keep their size. The current zoom is also in
Preferences → Editor → Zoom, is kept between launches, and applies on top of
the editor font size, which it never changes.

<!-- The zoom is the global `editor.zoom` setting, multiplied on top of `editor.font-size`. -->

In the compact window a single note opens in, which has no sidebar or tabs,
Cmd+\\, Cmd+T, Ctrl+Tab, Ctrl+Shift+Tab, and Cmd+1 ... Cmd+9 do nothing. Cmd+P, Cmd+O, Cmd+N, zoom, and history navigation still
work.

## App menu

<!-- Bound to the native app menu (Tauri menu accelerators) rather than the global JS handler. -->

| Shortcut | Action                                                |
| -------- | ----------------------------------------------------- |
| Cmd+,    | Open Preferences (Settings tab) in the focused window |

## Formatting

These apply while you are typing in a note.

<!-- Handled by the `markdownFormatting` CodeMirror extension. -->

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

## Editing

These also apply while you are typing in a note.

<!-- Inherited from CodeMirror's basic setup. -->

| Shortcut             | Action                         |
| -------------------- | ------------------------------ |
| Cmd+Z                | Undo                           |
| Cmd+Shift+Z          | Redo                           |
| Cmd+A                | Select all                     |
| Cmd+D                | Select next occurrence         |
| Alt+ArrowUp          | Move line up                   |
| Alt+ArrowDown        | Move line down                 |
| Alt+Shift+ArrowUp    | Copy line up                   |
| Alt+Shift+ArrowDown  | Copy line down                 |
| Cmd+Shift+K          | Delete line                    |
| Cmd+Enter            | Insert line below              |
| Tab                  | Indent / accept completion     |
| Shift+Tab            | Dedent                         |
| Cmd+]                | Indent more                    |
| Cmd+[                | Indent less                    |
| Cmd+F                | Find                           |
| Cmd+H                | Find and replace               |
| Cmd+G                | Find next                      |
| Cmd+Shift+G          | Find previous                  |
| Escape               | Close find                     |
| Alt+Shift+ArrowLeft  | Extend selection by word left  |
| Alt+Shift+ArrowRight | Extend selection by word right |
