// Match github-slugger so generated anchors line up with GFM-rendered
// markdown. Strips U+2000–U+206F (General Punctuation, including the en/em
// dashes and zero-width separators), U+2E00–U+2E7F (Supplemental
// Punctuation), and the ASCII punctuation set github-slugger lists.
// Hyphens, underscores, whitespace, and unicode letters survive; remaining
// whitespace becomes a single hyphen in the final step.
const GFM_STRIP = /[ -⁯⸀-⹿!"#$%&'()*+,./:;<=>?@[\]\\^`{|}~]/g;

export function slugifyHeading(text: string): string {
  return text.toLowerCase().replace(GFM_STRIP, "").trim().replace(/\s+/g, "-");
}

export interface HeadingSlugger {
  (text: string): string;
}

export function createHeadingSlugger(): HeadingSlugger {
  const used = new Set<string>();
  const counts = new Map<string, number>();
  return (text: string): string => {
    const base = slugifyHeading(text);
    let n = (counts.get(base) ?? 0) + 1;
    let candidate = n === 1 ? base : `${base}-${n}`;
    while (used.has(candidate)) {
      n += 1;
      candidate = `${base}-${n}`;
    }
    counts.set(base, n);
    used.add(candidate);
    return candidate;
  };
}
