import type { CSSProperties } from "react";

/**
 * The faint field of markdown syntax across the top of every docs page,
 * behind the header. The
 * settings were tuned by the owner in a throwaway preview; the generator below
 * reproduces that preview exactly (same seeded shuffle, same accent count), so
 * change the numbers together with `.doc-glyphs` in `styles.css`.
 *
 * Built once at module load from constants, so the server render and the
 * client agree and nothing is random at runtime.
 */

const TOKENS = [
  "#",
  "**",
  "[[ ]]",
  "$$",
  "```",
  "- [ ]",
  ">",
  "---",
  "1.",
  "_",
  "~~",
  "##",
  "`",
  "![[ ]]",
  "|",
  "::",
  "{}",
  "<>",
];
const SEED = 19;
const ROWS = 10;
/** Each line starts this many characters further right than the one above. */
const STAGGER = 3;
/** Every Nth token, counted across all lines, is in the accent color. */
const ACCENT_EVERY = 3;
/** Tokens generated per line before trimming; part of the accent count. */
const TOKENS_PER_ROW = TOKENS.length * 12;
/**
 * Characters kept per line: enough to cross a 2560px-wide window at 12px
 * plus one period, which the drift animation shifts each line by.
 */
const VISIBLE_CHARS = 420;

/**
 * After its first token a line repeats every `TOKENS.length` tokens, a run of
 * `PERIOD_CHARS` characters, accents included as long as the token count is
 * a multiple of `ACCENT_EVERY`. The drift moves each line by exactly one
 * period, so the loop is seamless.
 */
const PERIOD_CHARS = TOKENS.reduce((chars, token) => chars + token.length + 1, 0);
if (TOKENS.length % ACCENT_EVERY !== 0) {
  throw new Error(
    "GlyphBand: TOKENS.length must be a multiple of ACCENT_EVERY for a seamless loop",
  );
}

type Run = { text: string; accent: boolean };

/** The preview's generator: a linear congruential sequence from `seed`. */
function sequence(seed: number): () => number {
  let x = seed * 9301 + 49297;
  return () => (x = (x * 9301 + 49297) % 233280) / 233280;
}

function buildRows(): Run[][] {
  const next = sequence(SEED);
  const order = TOKENS.map((token) => [next(), token] as const)
    .sort((a, b) => a[0] - b[0])
    .map(([, token]) => token);

  const rows: Run[][] = [];
  let count = 0;
  for (let row = 0; row < ROWS; row++) {
    const runs: Run[] = [{ text: " ".repeat(STAGGER * row), accent: false }];
    const plain = (text: string) => {
      const last = runs[runs.length - 1];
      if (last.accent) runs.push({ text, accent: false });
      else last.text += text;
    };
    let length = STAGGER * row;
    for (let i = 0; i < TOKENS_PER_ROW; i++) {
      const token = order[(i + row * 3) % order.length];
      count++;
      if (length >= VISIBLE_CHARS) continue;
      const separator = i > 0 ? " " : "";
      if (count % ACCENT_EVERY === 0) {
        plain(separator);
        runs.push({ text: token, accent: true });
      } else {
        plain(separator + token);
      }
      length += separator.length + token.length;
    }
    rows.push(runs);
  }
  return rows;
}

const ROW_RUNS = buildRows();

export function GlyphBand() {
  return (
    <div
      className="doc-glyphs"
      aria-hidden="true"
      style={{ "--period": PERIOD_CHARS } as CSSProperties}
    >
      {ROW_RUNS.map((runs, row) => (
        <span key={row} className="doc-glyphs-row" style={{ "--row": row } as CSSProperties}>
          {runs.map((run, index) => (run.accent ? <span key={index}>{run.text}</span> : run.text))}
        </span>
      ))}
    </div>
  );
}
