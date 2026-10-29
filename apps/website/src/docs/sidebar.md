# The sidebar

The sidebar shows the workspace folder you opened ([how](/docs/open-a-folder/)) in three sections: **Pinned**, **Recents** and **Everything**. Press ⌘\ or run **Toggle Sidebar** from the command palette to hide or show it, and drag its right edge to make it wider or narrower.

<!-- Labels and behavior are from apps/desktop/src/components/sidebar/ and shared/settings.schema.json. -->

## Pinned, Recents and Everything

- **Pinned** holds the notes you pin: right-click a note and choose **Pin** (or **Unpin**). New pins go to the top, and pins are kept per workspace. The section only appears once something is pinned.
- **Recents** lists the notes changed most recently, newest first, leaving out pinned ones. It appears once a workspace has 10 or more notes.
- **Everything** is the whole folder as a tree, with folders and markdown files only. Hidden folders and anything your `.gitignore` excludes are left out.

Click a section's title to collapse or expand it. **Show More** under Pinned or Recents lists more notes.

To hide Recents or the **Search** button at the top of the sidebar, right-click the sidebar and untick **Recents** or **Search**. The same switches are in Preferences under **Appearance**. The Search button opens the command palette (⌘P).

## Titles or filenames

By default the sidebar shows each note's title: the `title:` in its frontmatter, or else a `# ` heading on its first line, or else its filename. While you edit a note, its title in the sidebar updates as you type.

To show filenames instead, set **Appearance → Sidebar File Label** to `filename` in Preferences.

## Sorting

Right-click an empty part of the sidebar, or a section's title, and choose **Sort by**:

- Name (A to Z), the default, or Name (Z to A)
- Modified time (new to old) or (old to new)
- Created time (new to old) or (old to new)

Names sort the way people read them, so "Note 2" comes before "Note 10". **Folders first**, at the bottom of the same menu and on by default, keeps folders above notes, sorted by name. Your choice is saved.

## Moving notes and folders

Drag a note or folder in **Everything** onto a folder to move it inside, onto a note to move it next to that note, or onto empty space to move it to the top of the workspace. Shift-click selects a range and ⌘-click adds a single item, so you can move several at once. Open tabs and pins follow what you move.

If something with the same name is already there, Writer tells you and leaves both where they were.

Dragging a folder from Finder onto Writer opens it as a workspace; it doesn't copy it into the current one.

## Creating, renaming and deleting

- **New File** and **New Folder** are in the right-click menu of a folder (they go inside it) and of empty sidebar space (they go at the top of the workspace). A new note is called "Untitled.md", then "Untitled 2.md", and its name is ready to edit straight away. Press Enter to keep the name, or Esc to cancel.
- **Rename...** edits the name in place in Everything, or in a small dialog from Pinned and Recents. A note's `.md` extension stays as it is.
- **Duplicate** makes "Note copy.md" and opens it.
- **Delete** moves the item to the macOS Trash, so you can put it back from there. Writer asks first only when a note has unsaved changes, or when you delete several items at once.

## The right-click menus

| On            | Items                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| A note        | Open, Open in new tab, Pin or Unpin, Duplicate, Copy relative path, Copy absolute path, Reveal in Finder, Rename..., Delete |
| A folder      | New File, New Folder, Copy relative path, Copy absolute path, Open in Terminal, Reveal in Finder, Rename..., Delete         |
| Empty space   | New File, New Folder, Open in Terminal, Open in Finder, Sort by, Search, Recents                                            |
| Several items | Copy relative paths, Copy absolute paths, Delete items                                                                      |

## Open in Terminal

**Open in Terminal** opens the folder you right-clicked, or the workspace folder, in Terminal. To use another app, such as iTerm or Ghostty, type its name in Preferences under **Workspace → Default Terminal**. Leave it blank for Terminal.

## Switching workspaces

The button at the bottom of the sidebar shows the current folder's name. Click it to switch to a recent workspace, choose **Open Folder…**, or **Close Workspace**. Writer remembers your last 10 workspaces; **Max Recent Workspaces** in Preferences changes how many.
