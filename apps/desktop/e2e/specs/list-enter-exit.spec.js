import { ok } from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Ending a list with Enter in the real app: seeds a note with a list, puts
// the caret at the end of a middle item, presses Enter twice (new empty item,
// then exit) and types. The typed text must be its own paragraph, separated
// from the list by a blank line, not a lazy continuation of the last item
// (see SPECs/nested-list-editing-audit-spec.md, "Second pass").
//
// Requires a restorable workspace; self-skips otherwise. Set
// LIST_ENTER_SHOT=/abs/dir to save screenshots and a JSON trace there.
describe("Ending a list with Enter", function () {
  const FILE_STEM = "list-enter-e2e";
  const DOC = [
    "# List enter check",
    "",
    "- jev limitations (quoted from docs): set the key in the gateway.",
    "  Your Gateway team must allow the provider.",
    "- im creating a sub item!!",
    "- jev API (from the core package): an async generator yielding events.",
    "  Candidate shape: id, description, root.",
    "- shadcn charts: https://ui.shadcn.com/docs/components/chart",
    "",
    "Plain paragraph after the list.",
    "",
  ].join("\n");

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

  // Lines 5..9 of the document (the item, whatever follows it, the next item).
  async function docWindow() {
    return browser.execute(() => {
      const view = document.querySelector(".cm-content").cmTile.root.view;
      const lines = view.state.doc.toString().split("\n");
      return { head: view.state.selection.main.head, lines: lines.slice(4, 9) };
    });
  }

  async function keydown(key, extra = {}) {
    await browser.execute(
      (k, x) => {
        const content = document.querySelector(".cm-content");
        content.focus();
        content.dispatchEvent(
          new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...x }),
        );
      },
      key,
      extra,
    );
  }

  async function shot(name) {
    if (!process.env.LIST_ENTER_SHOT) return;
    mkdirSync(process.env.LIST_ENTER_SHOT, { recursive: true });
    await browser.saveScreenshot(resolve(process.env.LIST_ENTER_SHOT, `${name}.png`));
  }

  before(async function () {
    workspaceRestored = await $('[data-sidebar-surface][data-workspace-open="true"]')
      .waitForExist({ timeout: 15_000 })
      .catch(() => false);
    if (!workspaceRestored) return;

    const recents = await invoke("get_recent_workspaces", {});
    const root = recents.ok && Array.isArray(recents.value) ? recents.value[0] : null;
    ok(root, "no workspace root to seed the list document into");

    filePath = `${root}/${FILE_STEM}.md`;
    const wrote = await invoke("write_file", { path: filePath, content: DOC });
    ok(wrote.ok, `failed to seed ${filePath}: ${wrote.error}`);
  });

  beforeEach(function () {
    if (!workspaceRestored) this.skip();
  });

  after(async function () {
    if (process.env.LIST_ENTER_SHOT) {
      const { writeFileSync } = await import("node:fs");
      mkdirSync(process.env.LIST_ENTER_SHOT, { recursive: true });
      writeFileSync(
        resolve(process.env.LIST_ENTER_SHOT, "trace.json"),
        JSON.stringify(trace, null, 2),
      );
    }
    if (filePath) await invoke("delete_entry", { path: filePath });
  });

  it("opens the seeded document from the sidebar", async function () {
    let row = await $("span*=List enter check");
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

  it("Enter, Enter, type: the text is a paragraph, not part of the last item", async function () {
    await browser.execute(() => {
      const view = document.querySelector(".cm-content").cmTile.root.view;
      const doc = view.state.doc.toString();
      const pos = doc.indexOf("sub item!!") + "sub item!!".length;
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      view.focus();
    });
    trace.push({ step: "caret", ...(await docWindow()) });

    await keydown("Enter");
    await browser.pause(300);
    trace.push({ step: "enter 1", ...(await docWindow()) });
    await shot("1-after-first-enter");

    await keydown("Enter");
    await browser.pause(300);
    trace.push({ step: "enter 2", ...(await docWindow()) });
    await shot("2-after-second-enter");

    // Type the way a keyboard does: through the contenteditable, so
    // CodeMirror's input path (not a dispatch) inserts the text.
    await browser.execute(() => {
      document.querySelector(".cm-content").focus();
      document.execCommand("insertText", false, "What");
    });
    await browser.pause(400);
    const after = await docWindow();
    trace.push({ step: "typed", ...after });
    await shot("3-after-typing");

    // Is the line holding "What" rendered as a list continuation (padded)?
    const rendered = await browser.execute(() => {
      const lines = [...document.querySelectorAll(".cm-line")];
      const line = lines.find((l) => l.textContent.startsWith("What"));
      return line
        ? {
            style: line.getAttribute("style"),
            cls: line.className,
            x: line.getBoundingClientRect().left,
            textX: line.firstElementChild
              ? line.firstElementChild.getBoundingClientRect().left
              : null,
          }
        : null;
    });
    trace.push({ step: "rendered", rendered });

    assertParagraph(after, rendered);
  });

  function assertParagraph(after, rendered) {
    const i = after.lines.indexOf("What");
    ok(i > 0, `typed line not found in ${JSON.stringify(after.lines)}`);
    ok(after.lines[i - 1] === "", `no blank line before the text: ${JSON.stringify(after.lines)}`);
    ok(
      !/padding-inline-start/.test((rendered && rendered.style) || ""),
      `text rendered as a list continuation: ${JSON.stringify(rendered)}`,
    );
  }

  async function renderedWhat() {
    return browser.execute(() => {
      const lines = [...document.querySelectorAll(".cm-line")];
      const line = lines.find((l) => l.textContent.startsWith("What"));
      return line ? { style: line.getAttribute("style"), cls: line.className } : null;
    });
  }

  async function resetDoc(doc) {
    await browser.execute((d) => {
      const view = document.querySelector(".cm-content").cmTile.root.view;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: d } });
    }, doc);
    await browser.pause(300);
  }

  async function caretAfterSubItem() {
    await browser.execute(() => {
      const view = document.querySelector(".cm-content").cmTile.root.view;
      const doc = view.state.doc.toString();
      const pos = doc.indexOf("sub item!!") + "sub item!!".length;
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      view.focus();
    });
  }

  async function typeWhat() {
    await browser.execute(() => {
      document.querySelector(".cm-content").focus();
      document.execCommand("insertText", false, "What");
    });
    await browser.pause(400);
  }

  it("Enter, Backspace, type: same result when the bullet is removed with Backspace", async function () {
    await resetDoc(DOC);
    await caretAfterSubItem();
    await keydown("Enter");
    await browser.pause(200);
    await keydown("Backspace");
    await browser.pause(200);
    trace.push({ step: "backspace", ...(await docWindow()) });
    await typeWhat();
    const after = await docWindow();
    const rendered = await renderedWhat();
    trace.push({ step: "backspace typed", ...after, rendered });
    await shot("4-backspace-typed");
    assertParagraph(after, rendered);
  });

  it("holds on a long note, with Enter, Enter and the text typed without pause", async function () {
    const items = [];
    for (let i = 0; i < 3000; i++) {
      items.push(
        `- item ${i} with a \`code span\`, a link https://example.com/${i} and enough text to wrap onto a second line in the editor column`,
      );
    }
    const long = [
      "# Long note",
      "",
      ...items,
      "- im creating a sub item!!",
      "- jev API (from the core package): an async generator yielding events.",
      "",
    ].join("\n");
    await resetDoc(long);
    await caretAfterSubItem();
    await browser.pause(100);
    // No pauses: the three keystrokes land as fast as a person types them.
    await browser.execute(() => {
      const content = document.querySelector(".cm-content");
      content.focus();
      const enter = () =>
        content.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        );
      enter();
      enter();
      document.execCommand("insertText", false, "What");
    });
    await browser.pause(400);
    const after = await browser.execute(() => {
      const view = document.querySelector(".cm-content").cmTile.root.view;
      const lines = view.state.doc.toString().split("\n");
      return { head: view.state.selection.main.head, lines: lines.slice(-6) };
    });
    const rendered = await renderedWhat();
    trace.push({ step: "long note typed", ...after, rendered });
    await shot("5-long-note-typed");
    assertParagraph(after, rendered);
  });
});
