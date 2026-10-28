# Open a folder or Obsidian vault

Writer Computer works on the folders of markdown files you already have: an Obsidian vault, the docs folder of a git repository, a personal wiki. There is nothing to import. Writer reads your `.md` files where they are and saves them back in place.

## Open a folder

Any of these opens a folder as a workspace:

- Choose **Open Folder…** from the workspace menu at the top of the sidebar.
- Run **Open Workspace** from the command palette (⌘P).
- Drag the folder onto a Writer window.
- Run `writer path/to/folder` in a terminal. See [the writer command](#the-writer-command).

You can keep several workspaces open at once, each in its own window. Right-click Writer's Dock icon to reopen a recent one.

To open an Obsidian vault, open the vault's folder. Writer doesn't need anything from the `.obsidian` folder and never writes to it. See [Obsidian compatibility](/docs/obsidian/) for the syntax it understands.

## Open a single note

Open a `.md` or `.markdown` file with Writer, from Finder's **Open With** menu or with `writer note.md`, and it opens in a compact window with no sidebar or tabs. A menu at the top lists the other notes in the same folder, so you can move between them. If that folder is already open as a workspace, the note opens in the workspace's window instead.

## What Writer does with your files

- **Saves plain markdown in place.** Writer doesn't convert, rename or move your files, and keeps its settings and session in its own app data folder, not in your notes folder.
- **Pasted images go next to the note.** Pasting an image into `note.md` saves it in a `note-assets` folder beside the note and inserts a standard markdown image link, so the image shows up in other apps too. Pasted images can be up to 5 MB.
- **Picks up changes made elsewhere.** Files you create, rename, edit or delete outside Writer, in Obsidian, another editor or with `git pull`, show up in the sidebar, and open notes reload with the new content.
- **Leaves out what you don't edit.** Files ignored by `.gitignore`, hidden folders such as `.git` and `.obsidian`, and `node_modules` are left out of the sidebar and search.

Large folders open quickly: the window shows the top level of the folder and your last open note first, and builds the search index in the background.

## The writer command

Choose **Writer → Install 'writer' Command Line Tool…** to add a `writer` command at `/usr/local/bin/writer`. macOS may ask for an administrator password. Then, in a terminal:

```sh
writer .          # open the current folder
writer ~/notes    # open a folder
writer todo.md    # open one note
```

`writer --help` lists the options. The same menu item uninstalls the command.
