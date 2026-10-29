# Math with LaTeX

Writer Computer renders LaTeX math in your notes with [KaTeX](https://katex.org). Put inline math between single dollar signs and display math between double ones:

```markdown
The area of a circle is $\pi r^2$.

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$
```

When the caret is outside a formula, you see it rendered. Click it to edit the LaTeX source.

## Dollar signs

Inline math follows the same rules as Pandoc, so prices in ordinary sentences stay text:

- There is no space just inside the dollar signs: `$x$` is math, `$ x $` isn't.
- A closing `$` followed by a digit doesn't close the formula, so "it cost $5 and $10" stays text.
- Write `\$` for a literal dollar sign.

Display math between `$$` can span several lines, as long as there is no blank line inside it.

## What you can write

Anything KaTeX supports; its [list of supported functions](https://katex.org/docs/supported.html) is the reference. A formula KaTeX can't parse is shown as its source in an error color.

Not supported:

- The `\(...\)` and `\[...\]` delimiters. Use `$...$` and `$$...$$`.
- Commands that add links or HTML, such as `\href`, since notes may come from other people.
- KaTeX extensions such as mhchem's `\ce` for chemistry.
