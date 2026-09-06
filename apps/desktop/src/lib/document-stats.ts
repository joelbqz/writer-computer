export interface DocumentStats {
  words: number;
  characters: number;
  paragraphs: number;
}

const SURROGATE_PAIR_RE = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;

function countMatches(text: string, re: RegExp): number {
  let count = 0;
  re.lastIndex = 0;
  while (re.exec(text) !== null) count++;
  return count;
}

// Code points, not UTF-16 units, so an emoji counts as one character. Counting
// surrogate pairs and subtracting avoids `Array.from(text)`, which allocated one
// string per character on every keystroke.
function countCodePoints(text: string): number {
  return text.length - countMatches(text, SURROGATE_PAIR_RE);
}

// Block prefixes are stripped per line. `[ \t]` rather than `\s`: a `\s` at the
// line start swallowed the blank line before a list or heading, which merged
// paragraphs and under-counted them.
function normalizeDocumentContent(content: string) {
  return content
    .replace(/^[ \t]{0,3}(?:#{1,6}|[-*+]|\d+[.)]|>)[ \t]+/gm, "")
    .replace(/`+/g, "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .trim();
}

export function getDocumentStats(content: string): DocumentStats {
  const normalized = normalizeDocumentContent(content);
  if (normalized === "") return { words: 0, characters: 0, paragraphs: 0 };

  const words = countMatches(normalized, /\S+/g);
  const characters = countCodePoints(normalized.replace(/\s+/g, " "));
  let paragraphs = 0;
  for (const paragraph of normalized.split(/\n\s*\n/)) {
    if (/\S/.test(paragraph)) paragraphs++;
  }

  return { words, characters, paragraphs };
}
