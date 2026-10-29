# Tables, tasks and code

Writer Computer shows markdown the way it reads: tables as tables, tasks as checkboxes, code highlighted, frontmatter as a form. Move the cursor into any of them and you edit the markdown itself, so the file stays plain text.

<!-- Behavior is from apps/desktop/src/components/editor-area/ and src/lib/prosemark-core/. -->

## Tables

A GitHub-style table renders as a table when the cursor is elsewhere:

```markdown
| Plan  | Price | Notes           |
| :---- | ----: | --------------- |
| Free  |    $0 | **Everything**  |
| Later |     ? | see [[Roadmap]] |
```

- Cells show their formatting: bold, italic, strikethrough, `code`, links and `[[wikilinks]]`, which you can click. Images in a cell show their alt text.
- `:---`, `:---:` and `---:` align a column left, center or right.
- Columns size to their content, and a long column wraps instead of squeezing the others.
- Click the table, or arrow into it from the line above or below, to edit its markdown, shown in the code font so the columns line up.
- To start one, right-click and choose **Insert → Table** for a three-column table with the cursor in the first cell.

## Task lists

`- [ ]` and `- [x]` show as checkboxes. Click one to tick or untick it; the change is saved to the file like any other edit. Press Enter at the end of a task to start a new, unticked one.

⌘⇧Enter turns the current line, or every selected line, into a task, and turns tasks back into plain lines.

## Code

Fenced code blocks are highlighted by language: name the language after the opening fence, such as ` ```python ` or ` ```rust `. The fences are hidden until the cursor is in the block. Long lines don't wrap: a wide block scrolls sideways on its own, with a thin scrollbar along its bottom, and follows the cursor as you type.

Inline code, written between backticks, is shown in the code font; ⌘E wraps the selection in backticks. Choose the code font in Preferences under **Typography → Code font** ([Customize the look](/docs/customize-the-look/)).

A ` ```mermaid ` block draws a diagram instead ([Mermaid diagrams](/docs/mermaid/)).

## Frontmatter

YAML frontmatter between `---` lines at the top of a note shows as a list of properties above the text, one row per key:

- Click a key or value to edit it. `true`, `false`, numbers and `null` are saved as those types, and lists or nested values show as YAML.
- **Add property** adds a row, as does Enter in the last value.
- The × on a row, or Backspace in an empty row, removes it. Removing the last row removes the frontmatter.
- Type `---` on the first line of a note without frontmatter to start it.
- Paste a whole note that has frontmatter into a note without any, and the frontmatter goes into the properties, with the rest as text.

## Everything else

- **Quotes:** `>` lines show as a quote, with nesting. Enter on an empty quote line steps out one level. ⌘⇧. makes a quote.
- **Dividers:** `---` on its own line shows as a thin rule. **Insert → Horizontal rule** in the right-click menu adds one.
- **HTML:** blocks such as `<details>` and `<summary>`, `<kbd>`, `<mark>` or `<sub>` render, cleaned of anything unsafe. Scripts and styles stay as source.
- **Images:** `![alt](image.png)` shows the image, relative to the note or from the web. Pasting an image saves it next to the note ([how](/docs/open-a-folder/)).
- **Emoji:** shortcodes such as `:sparkles:` show as the emoji.
- **Dashes:** `--` shows as an en dash and `---` inside a line as an em dash. The file keeps what you typed.
- **Math:** `$...$` and `$$...$$` ([Math with LaTeX](/docs/math/)).

Footnotes aren't supported yet.
