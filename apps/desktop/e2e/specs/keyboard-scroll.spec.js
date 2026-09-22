import { ok } from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Holding Down/Up in a long note: the outer editor scroller must keep
// following the caret to the end of the document and back. The ProseMark
// mount used to be `h-full`, so CodeMirror's ancestor scroll walk clipped
// the caret rect to that viewport-high box and the real scroller stopped
// advancing after about one screen (issue #125). Also checks a short note
// still gets a viewport-high mount, so clicks below its text land in the
// editor.
//
// Requires a restorable workspace; self-skips otherwise. Set
// KEYBOARD_SCROLL_SHOT=/abs/dir to save screenshots and a JSON trace there,
// and KEYBOARD_SCROLL_STEP_MS to slow the key repeat down for a recording.
describe("Keyboard scrolling through a long note", function () {
  const FILE_STEM = "keyboard-scroll-e2e";
  const STEP_MS = Number(process.env.KEYBOARD_SCROLL_STEP_MS ?? 20);
  const sections = [];
  for (let s = 1; s <= 8; s++) {
    sections.push(`## Section ${s}`, "");
    for (let i = 1; i <= 8; i++) sections.push(`Line ${s}.${i}: scroll check paragraph.`);
    sections.push("", `- item ${s}a`, `- item ${s}b`, "");
  }
  const DOC = ["# Keyboard scroll check", "", ...sections].join("\n");
  const SHORT_DOC = "# Short\n\nOne line.\n";

  let workspaceRestored = false;
  let filePath = null;
  const trace = [];

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

  async function shot(name) {
    if (!process.env.KEYBOARD_SCROLL_SHOT) return;
    mkdirSync(process.env.KEYBOARD_SCROLL_SHOT, { recursive: true });
    await browser.saveScreenshot(resolve(process.env.KEYBOARD_SCROLL_SHOT, `${name}.png`));
  }

  /** Press Down or Up as a held key until the caret reaches the document
   *  boundary, failing as soon as the caret leaves the scroller's viewport. */
  async function holdArrow(direction, stepMs) {
    return browser.executeAsync(
      (dir, ms, done) => {
        const content = document.querySelector(".cm-content");
        const view = content.cmTile.root.view;
        let scroller = view.dom.parentElement;
        while (scroller && !["auto", "scroll"].includes(getComputedStyle(scroller).overflowY)) {
          scroller = scroller.parentElement;
        }
        if (!scroller) return done({ failure: "no outer scroller" });
        const down = dir === "down";
        const key = down ? "ArrowDown" : "ArrowUp";
        // A line, not a position: the heading guard keeps the caret after
        // the hidden `# ` on the first line.
        const boundary = down ? view.state.doc.lines : 1;
        const original = view.state.doc.toString();
        const startScroll = scroller.scrollTop;
        let maxScroll = startScroll;
        let step = 0;
        const tick = () => {
          content.dispatchEvent(
            new KeyboardEvent("keydown", {
              key,
              code: key,
              repeat: step > 0,
              bubbles: true,
              cancelable: true,
            }),
          );
          // Measure once CodeMirror's scroll-into-view has run.
          setTimeout(() => {
            const head = view.state.selection.main.head;
            const caret = view.coordsAtPos(head);
            const bounds = scroller.getBoundingClientRect();
            maxScroll = Math.max(maxScroll, scroller.scrollTop);
            const state = {
              step,
              head,
              line: view.state.doc.lineAt(head).number,
              scrollTop: scroller.scrollTop,
              caretTop: caret && caret.top,
              viewportTop: bounds.top,
              viewportBottom: bounds.bottom,
            };
            if (!caret || caret.bottom > bounds.bottom + 2 || caret.top < bounds.top - 2) {
              return done({ failure: "caret left the visible viewport", ...state });
            }
            if (state.line === boundary) {
              return done({
                ...state,
                startScroll,
                maxScroll,
                viewportHeight: scroller.clientHeight,
                unchanged: view.state.doc.toString() === original,
              });
            }
            if (++step > 400) return done({ failure: "never reached the boundary", ...state });
            tick();
          }, ms);
        };
        tick();
      },
      direction,
      stepMs,
    );
  }

  async function setCaret(where) {
    await browser.execute((w) => {
      const view = document.querySelector(".cm-content").cmTile.root.view;
      const anchor = w === "start" ? 0 : view.state.doc.length;
      view.focus();
      view.dispatch({ selection: { anchor }, scrollIntoView: true });
    }, where);
    await browser.pause(300);
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
    // The watcher treats the app's own write as a self-write and never
    // surfaces it in the tree; reload so startup lists the workspace again.
    await browser.refresh();
    await $('[data-sidebar-surface][data-workspace-open="true"]').waitForExist({ timeout: 15_000 });
  });

  beforeEach(function () {
    if (!workspaceRestored) this.skip();
  });

  after(async function () {
    if (process.env.KEYBOARD_SCROLL_SHOT) {
      mkdirSync(process.env.KEYBOARD_SCROLL_SHOT, { recursive: true });
      writeFileSync(
        resolve(process.env.KEYBOARD_SCROLL_SHOT, "trace.json"),
        JSON.stringify(trace, null, 2),
      );
    }
    if (filePath) await invoke("delete_entry", { path: filePath });
  });

  it("opens the seeded document from the sidebar", async function () {
    let row = await $("span*=Keyboard scroll check");
    let found = await row.waitForExist({ timeout: 15_000 }).catch(() => false);
    if (!found) {
      row = await $(`span*=${FILE_STEM}`);
      found = await row.waitForExist({ timeout: 2_000 }).catch(() => false);
    }
    if (!found) await shot("0-no-row");
    ok(found, "seeded document never appeared in the sidebar");
    await row.click();
    await browser.waitUntil(async () => (await $$(".cm-content")).length > 0, {
      timeout: 10_000,
      timeoutMsg: "editor never mounted",
    });
    await browser.pause(500);
  });

  it("holding Down follows the caret to the end of the note", async function () {
    await setCaret("start");
    await shot("1-down-start");
    const result = await holdArrow("down", STEP_MS);
    trace.push({ step: "down", ...result });
    await shot("2-down-end");
    ok(!result.failure, JSON.stringify(result));
    ok(result.unchanged, "arrow navigation edited the document");
    ok(
      result.maxScroll > result.viewportHeight,
      `never scrolled a full viewport: ${JSON.stringify(result)}`,
    );
  });

  it("holding Up follows the caret back to the start", async function () {
    await setCaret("end");
    const result = await holdArrow("up", STEP_MS);
    trace.push({ step: "up", ...result });
    await shot("3-up-end");
    ok(!result.failure, JSON.stringify(result));
    ok(result.unchanged, "arrow navigation edited the document");
    ok(result.scrollTop < result.startScroll, `Up did not scroll back: ${JSON.stringify(result)}`);
  });

  it("a short note still fills the viewport with editing area", async function () {
    await browser.execute((d) => {
      const view = document.querySelector(".cm-content").cmTile.root.view;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: d } });
    }, SHORT_DOC);
    await browser.pause(300);
    const sizes = await browser.execute(() => {
      const view = document.querySelector(".cm-content").cmTile.root.view;
      const mount = view.dom.parentElement;
      let scroller = mount.parentElement;
      while (scroller && !["auto", "scroll"].includes(getComputedStyle(scroller).overflowY)) {
        scroller = scroller.parentElement;
      }
      return { mount: mount.getBoundingClientRect().height, viewport: scroller.clientHeight };
    });
    trace.push({ step: "short", ...sizes });
    await shot("4-short-note");
    ok(
      sizes.mount >= sizes.viewport - 1,
      `mount shorter than the viewport: ${JSON.stringify(sizes)}`,
    );
  });
});
