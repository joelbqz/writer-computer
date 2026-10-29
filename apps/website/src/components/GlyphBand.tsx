import { Fragment, type RefObject, useEffect, useRef } from "react";

/**
 * The faint field of markdown syntax across the top of every docs page,
 * behind the header. The settings were tuned by the owner in throwaway
 * previews; the generator below reproduces them exactly (same seeded shuffle,
 * same accent count), so change the numbers together with `.doc-glyphs` in
 * `styles.css`.
 *
 * The lines are built once at module load from constants, so the server
 * render and the client agree. Only the decode effect is random, and it runs
 * in the browser after hydration.
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
/** Characters kept per line: enough to cross a 2560px-wide window at 12px. */
const VISIBLE_CHARS = 310;

/** Decode: how often it tries, how many tokens per try, and their frames. */
const DECODE_EVERY_MS = 180;
const DECODES_PER_TICK = 2;
const FRAME_MS = 55;
const MIN_FRAMES = 8;
const EXTRA_FRAMES = 6;
const SCRAMBLE_CHARS = "#*[]$`-_~|:{}<>!=+^%";

type Token = { text: string; accent: boolean; separator: string };

/** The preview's generator: a linear congruential sequence from `seed`. */
function sequence(seed: number): () => number {
  let x = seed * 9301 + 49297;
  return () => (x = (x * 9301 + 49297) % 233280) / 233280;
}

function buildRows(): Token[][] {
  const next = sequence(SEED);
  const order = TOKENS.map((token) => [next(), token] as const)
    .sort((a, b) => a[0] - b[0])
    .map(([, token]) => token);

  const rows: Token[][] = [];
  let count = 0;
  for (let row = 0; row < ROWS; row++) {
    const tokens: Token[] = [];
    let length = STAGGER * row;
    for (let i = 0; i < TOKENS_PER_ROW; i++) {
      const text = order[(i + row * 3) % order.length];
      count++;
      if (length >= VISIBLE_CHARS) continue;
      const separator = i > 0 ? " " : "";
      tokens.push({ text, accent: count % ACCENT_EVERY === 0, separator });
      length += separator.length + text.length;
    }
    rows.push(tokens);
  }
  return rows;
}

const ROW_TOKENS = buildRows();

/** `text` with every non-space character swapped for a random syntax character. */
function scrambled(text: string): string {
  return text.replace(
    /\S/g,
    () => SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)],
  );
}

/**
 * Now and then a token scrambles through other syntax characters for a few
 * frames and settles back into itself. Tokens keep their length, so nothing
 * moves. Paused while the band is off-screen or the tab is hidden, and off
 * entirely under `prefers-reduced-motion`.
 */
function useDecode(band: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = band.current;
    if (!root) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const tokens = [...root.querySelectorAll<HTMLElement>(".doc-glyph")];
    const originals = new Map(tokens.map((token) => [token, token.textContent ?? ""]));
    const busy = new Set<HTMLElement>();
    const timers = new Set<number>();
    let onScreen = true;

    const settle = (token: HTMLElement) => {
      token.textContent = originals.get(token) ?? "";
      token.classList.remove("is-decoding");
      busy.delete(token);
    };

    const decode = (token: HTMLElement) => {
      busy.add(token);
      token.classList.add("is-decoding");
      let frames = MIN_FRAMES + Math.floor(Math.random() * EXTRA_FRAMES);
      const frame = () => {
        if (--frames <= 0) return settle(token);
        token.textContent = scrambled(originals.get(token) ?? "");
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          frame();
        }, FRAME_MS);
        timers.add(timer);
      };
      frame();
    };

    const tick = window.setInterval(() => {
      if (motion.matches || !onScreen || document.hidden) return;
      for (let i = 0; i < DECODES_PER_TICK; i++) {
        const token = tokens[Math.floor(Math.random() * tokens.length)];
        if (!busy.has(token)) decode(token);
      }
    }, DECODE_EVERY_MS);

    const visibility = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
    });
    visibility.observe(root);

    return () => {
      window.clearInterval(tick);
      for (const timer of timers) window.clearTimeout(timer);
      visibility.disconnect();
      for (const token of busy) settle(token);
    };
  }, [band]);
}

export function GlyphBand() {
  const band = useRef<HTMLDivElement>(null);
  useDecode(band);

  return (
    <div ref={band} className="doc-glyphs" aria-hidden="true">
      {ROW_TOKENS.map((tokens, row) => (
        <span key={row} className="doc-glyphs-row">
          {" ".repeat(STAGGER * row)}
          {tokens.map((token, index) => (
            <Fragment key={index}>
              {token.separator}
              <span className={token.accent ? "doc-glyph doc-glyph-accent" : "doc-glyph"}>
                {token.text}
              </span>
            </Fragment>
          ))}
        </span>
      ))}
    </div>
  );
}
