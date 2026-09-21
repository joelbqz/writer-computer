import { ok } from "node:assert/strict";

// Code block horizontal scrolling: seeds a markdown file with a fenced code
// block whose one line is far wider than the editor column, opens it, and
// asserts the line does not wrap, a horizontal wheel gesture scrolls every
// line of the block together (as a negative `text-indent`), and moving the
// caret to the end of the long line reveals it
// (see SPECs/code-block-horizontal-scroll-spec.md).
//
// Requires a restorable workspace: seed
// `~/Library/Application Support/com.writer-computer.e2e/recent_workspaces.json`
// with a real directory before launching. Without one this suite self-skips.
describe("Code block horizontal scrolling", function () {
  const FILE_STEM = "code-block-scroll-e2e";
  const LONG_LINE = `const wide = ${Array.from({ length: 40 }, (_, i) => `"item-${i}"`).join(", ")};`;
  const DOC = [
    "# Code scroll check",
    "",
    "```ts",
    "const short = 1;",
    LONG_LINE,
    "```",
    "",
    "after",
    "",
  ].join("\n");

  let workspaceRestored = false;
  let filePath = null;

  async function invoke(cmd, args) {
    return browser.executeAsync(
      (c, a, done) => {
        window.__TAURI_INTERNALS__
          .invoke(c, a)
          .then((v) => done({ ok: true, value: v }))
          .catch((e) => done({ ok: false, error: e && e.message ? e.message : String(e) }));
      },
      cmd,
      args,
    );
  }

  /** Per-line geometry of the rendered code block, in DOM order. */
  async function codeLines() {
    return browser.execute(() =>
      Array.from(document.querySelectorAll(".cm-fenced-code-line")).map((el) => {
        const rect = el.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(el);
        return {
          text: el.textContent,
          height: rect.height,
          width: rect.width,
          contentWidth: range.getBoundingClientRect().width,
          whiteSpace: getComputedStyle(el).whiteSpace,
          textIndent: el.style.textIndent,
        };
      }),
    );
  }

  before(async function () {
    workspaceRestored = await $('[data-sidebar-surface][data-workspace-open="true"]')
      .waitForExist({ timeout: 15_000 })
      .catch(() => false);
    if (!workspaceRestored) return;

    const recents = await invoke("get_recent_workspaces", {});
    const root = recents.ok && Array.isArray(recents.value) ? recents.value[0] : null;
    ok(root, "no workspace root to seed the document into");

    filePath = `${root}/${FILE_STEM}.md`;
    const wrote = await invoke("write_file", { path: filePath, content: DOC });
    ok(wrote.ok, `failed to seed ${filePath}: ${wrote.error}`);
  });

  beforeEach(function () {
    if (!workspaceRestored) this.skip();
  });

  after(async function () {
    if (filePath) await invoke("delete_entry", { path: filePath });
  });

  it("opens the seeded document from the sidebar", async function () {
    const row = await $(`span*=Code scroll check`);
    await row.waitForExist({ timeout: 15_000 });
    await row.click();

    await browser.waitUntil(async () => (await $$(".cm-fenced-code-line")).length === 4, {
      timeout: 10_000,
      timeoutMsg: "code block never rendered",
    });
  });

  it("renders the long line on one line instead of wrapping", async function () {
    const lines = await codeLines();
    const short = lines[1];
    const long = lines[2];
    ok(short.whiteSpace === "pre", `expected white-space: pre, got ${short.whiteSpace}`);
    ok(
      long.contentWidth > long.width,
      `long line (${long.contentWidth}px) should overflow its box (${long.width}px)`,
    );
    ok(
      Math.abs(long.height - short.height) < 1,
      `long line height ${long.height} should match short line height ${short.height}`,
    );
    ok(
      lines.every((line) => line.textIndent === ""),
      "no line should be scrolled yet",
    );

    if (process.env.VERIFY_SHOT_DIR) {
      await browser.saveScreenshot(`${process.env.VERIFY_SHOT_DIR}/code-block-unscrolled.png`);
    }
  });

  it("scrolls every line of the block together on a horizontal wheel gesture", async function () {
    await browser.execute(() => {
      const target = document.querySelectorAll(".cm-fenced-code-line")[1];
      target.dispatchEvent(
        new WheelEvent("wheel", { deltaX: 150, deltaY: 0, bubbles: true, cancelable: true }),
      );
    });

    await browser.waitUntil(
      async () => (await codeLines()).every((line) => line.textIndent === "-150px"),
      { timeout: 5_000, timeoutMsg: "wheel gesture did not scroll the block" },
    );

    if (process.env.VERIFY_SHOT_DIR) {
      await browser.saveScreenshot(`${process.env.VERIFY_SHOT_DIR}/code-block-scrolled.png`);
    }
  });

  it("clamps at the widest line and scrolls back to zero", async function () {
    await browser.execute(() => {
      const target = document.querySelectorAll(".cm-fenced-code-line")[2];
      target.dispatchEvent(
        new WheelEvent("wheel", { deltaX: 100_000, deltaY: 0, bubbles: true, cancelable: true }),
      );
    });
    await browser.waitUntil(
      async () => {
        const lines = await codeLines();
        const long = lines[2];
        const offset = -parseFloat(long.textIndent || "0");
        // Content end lands at the box's right padding edge (12px) when clamped.
        return offset > 150 && Math.abs(long.contentWidth - offset - (long.width - 24)) < 2;
      },
      { timeout: 5_000, timeoutMsg: "block did not clamp at its widest line" },
    );

    await browser.execute(() => {
      const target = document.querySelectorAll(".cm-fenced-code-line")[2];
      target.dispatchEvent(
        new WheelEvent("wheel", { deltaX: -100_000, deltaY: 0, bubbles: true, cancelable: true }),
      );
    });
    await browser.waitUntil(
      async () => (await codeLines()).every((line) => line.textIndent === ""),
      { timeout: 5_000, timeoutMsg: "block did not scroll back to zero" },
    );
  });

  it("reveals the caret when it moves to the end of the long line", async function () {
    const caret = await browser.execute(() => {
      const view = document.querySelector(".cm-content").cmView.view;
      const lineEl = document.querySelectorAll(".cm-fenced-code-line")[2];
      const line = view.state.doc.lineAt(view.posAtDOM(lineEl));
      view.dispatch({ selection: { anchor: line.to } });
      view.focus();
      return line.to;
    });

    await browser.waitUntil(
      async () => {
        const result = await browser.execute((pos) => {
          const view = document.querySelector(".cm-content").cmView.view;
          const coords = view.coordsAtPos(pos);
          const lineEl = document.querySelectorAll(".cm-fenced-code-line")[2];
          const rect = lineEl.getBoundingClientRect();
          return {
            indent: lineEl.style.textIndent,
            inside: coords !== null && coords.left >= rect.left && coords.right <= rect.right,
          };
        }, caret);
        return result.indent !== "" && result.inside;
      },
      { timeout: 5_000, timeoutMsg: "caret at the end of the long line was not revealed" },
    );

    const lines = await codeLines();
    ok(
      lines.every((line) => line.textIndent === lines[2].textIndent),
      "all lines of the block should share the revealed offset",
    );

    if (process.env.VERIFY_SHOT_DIR) {
      await browser.saveScreenshot(`${process.env.VERIFY_SHOT_DIR}/code-block-caret-revealed.png`);
    }
  });
});
