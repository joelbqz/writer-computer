# Obsidian compatibility

Writer Computer opens an Obsidian vault as an ordinary folder ([how](/docs/open-a-folder/)). It reads the same markdown files and leaves the `.obsidian` folder alone, and it picks up changes Obsidian makes, so you can use both apps on one vault. This page lists the Obsidian syntax Writer understands and where it behaves differently.

## Supported

| Syntax                      | In Writer                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `[[Note]]`                  | A link to the note with that name, anywhere in the vault. Click it to open the note.                        |
| `[[folder/Note]]`           | A link by path from the top of the vault, for names more than one note shares.                              |
| `[[Note\|shown text]]`      | A link that shows "shown text".                                                                             |
| `![[image.png]]`            | The image, inline. PNG, JPG, GIF, WebP and SVG, found by file name anywhere in the vault, as Obsidian does. |
| YAML frontmatter            | Shown as editable properties above the note.                                                                |
| `- [ ] task`                | A task list with checkboxes.                                                                                |
| Tables, `~~strikethrough~~` | GitHub-flavored markdown.                                                                                   |
| ` ```mermaid `              | A diagram. See [Mermaid diagrams](/docs/mermaid/).                                                          |
| `$x^2$`, `$$x^2$$`          | Math. See [Math with LaTeX](/docs/math/).                                                                   |

Type `[[` and the start of a name to get suggestions from the notes in the vault.

## Different from Obsidian

- `[[Note]]` only resolves when exactly one note has that name. When several do, link by path: `[[folder/Note]]`. Autocomplete inserts the path for you in that case.
- `[[Note#Heading]]` opens the note at the top; it doesn't jump to the heading. A standard markdown link, `[text](Note.md#heading)`, does.
- Clicking a link to a note that doesn't exist does nothing. Obsidian creates the note.
- Renaming a note doesn't update the links that point to it.
- In `![[image.png|300]]`, the size or text after `|` is ignored.

## Not supported

- Note embeds, `![[Note]]`, and embeds of other files such as PDFs.
- Callouts, `> [!note]`. They show as ordinary blockquotes.
- Tags, `#tag`, are plain text: there is no tag list or tag search.
- Footnotes, `==highlights==`, `%%comments%%` and block references (`^block-id`).
- Obsidian plugins, including Dataview, and Canvas.
