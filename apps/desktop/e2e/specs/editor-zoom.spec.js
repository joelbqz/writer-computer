import { ok, strictEqual } from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const E2E_WORKSPACE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const ZOOM_KEY = "editor.zoom";

async function invoke(cmd, args) {
  const result = await browser.executeAsync(
    (cmdName, cmdArgs, done) => {
      window.__TAURI_INTERNALS__
        .invoke(cmdName, cmdArgs)
        .then((value) => done({ ok: true, value }))
        .catch((error) =>
          done({ ok: false, error: error && error.message ? error.message : String(error) }),
        );
    },
    cmd,
    args,
  );
  if (!result.ok) throw new Error(`${cmd} failed: ${result.error}`);
  return result.value;
}

async function waitForMount() {
  await $('button[aria-label="Hide sidebar"]').waitForExist({ timeout: 15_000 });
}

async function openReadme() {
  const row = await $('[data-tree-path$="/README.md"]');
  await row.waitForExist({ timeout: 10_000 });
  await row.click();
  await $(".cm-content").waitForExist({ timeout: 10_000 });
}

// The global handler listens on `window`; a bubbling keydown on `document`
// reaches it exactly like a real key press would.
async function press(init) {
  await browser.execute((eventInit) => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        metaKey: true,
        ...eventInit,
      }),
    );
  }, init);
  // The store update and the CSS variable write are synchronous; give
  // WebKit a frame to restyle before measuring.
  await browser.pause(150);
}

async function zoomSetting() {
  return invoke("get_setting", { key: ZOOM_KEY });
}

/** Rendered editor font size in px, plus the sidebar's, so a test can show
 *  the note scaled while the chrome did not. */
async function fontSizes() {
  return browser.execute(() => {
    const px = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : null);
    return {
      editor: px(document.querySelector(".cm-content")),
      sidebar: px(document.querySelector("[data-sidebar-surface]")),
      viewport: window.innerWidth,
    };
  });
}

function near(actual, expected, message) {
  ok(Math.abs(actual - expected) <= 0.1, `${message}: expected ≈${expected}, got ${actual}`);
}

describe("editor zoom shortcuts", function () {
  let base;

  before(async function () {
    // The shared e2e data dir may restore some other workspace (or none);
    // the spec needs this repo's README, so open the repo when it is absent.
    await waitForMount();
    const readmeVisible = await $('[data-tree-path$="/README.md"]')
      .waitForExist({ timeout: 3_000 })
      .catch(() => false);
    if (!readmeVisible) {
      await invoke("open_workspace", { path: E2E_WORKSPACE });
      await browser.refresh();
      await waitForMount();
    }
    await invoke("reset_setting", { key: ZOOM_KEY, scope: "global" });
    await invoke("reset_setting", { key: "editor.font-size", scope: "global" });
    await browser.refresh();
    await waitForMount();
    await openReadme();
    base = await fontSizes();
  });

  after(async function () {
    await invoke("reset_setting", { key: ZOOM_KEY, scope: "global" }).catch(() => {});
  });

  it("starts at 100% with the editor at its Font Size setting", async function () {
    strictEqual(await zoomSetting(), 100);
    strictEqual(await invoke("get_setting", { key: "editor.font-size" }), 16);
    near(base.editor, 16, "editor font size");
  });

  it("Cmd+= scales the editor text one stop and leaves the chrome alone", async function () {
    await press({ key: "=", code: "Equal" });
    strictEqual(await zoomSetting(), 110);
    const sizes = await fontSizes();
    near(sizes.editor, 16 * 1.1, "editor font size");
    strictEqual(sizes.sidebar, base.sidebar, "sidebar font size must not change");
    strictEqual(sizes.viewport, base.viewport, "CSS viewport must not change");
  });

  it("Cmd+Shift+= (Cmd++) and Cmd+numpad + also zoom in", async function () {
    await press({ key: "+", code: "Equal", shiftKey: true });
    strictEqual(await zoomSetting(), 125);
    await press({ key: "+", code: "NumpadAdd" });
    strictEqual(await zoomSetting(), 150);
    near((await fontSizes()).editor, 24, "editor font size");
  });

  it("Cmd+- zooms out one stop", async function () {
    await press({ key: "-", code: "Minus" });
    strictEqual(await zoomSetting(), 125);
    await press({ key: "-", code: "NumpadSubtract" });
    strictEqual(await zoomSetting(), 110);
  });

  it("Cmd+0 returns to actual size without touching editor.font-size", async function () {
    await press({ key: "0", code: "Digit0" });
    strictEqual(await zoomSetting(), 100);
    strictEqual(await invoke("get_setting", { key: "editor.font-size" }), 16);
    near((await fontSizes()).editor, 16, "editor font size");
  });

  it("Cmd+Alt+0 is left to the editor (no zoom change)", async function () {
    await press({ key: "=", code: "Equal" });
    strictEqual(await zoomSetting(), 110);
    await press({ key: "0", code: "Digit0", altKey: true });
    strictEqual(await zoomSetting(), 110);
    await press({ key: "0", code: "Digit0" });
    strictEqual(await zoomSetting(), 100);
  });

  it("multiplies a changed Font Size rather than replacing it", async function () {
    await invoke("set_setting", { key: "editor.font-size", value: 20, scope: "global" });
    await browser.refresh();
    await waitForMount();
    await openReadme();
    near((await fontSizes()).editor, 20, "editor font size");
    await press({ key: "=", code: "Equal" });
    await press({ key: "=", code: "Equal" });
    strictEqual(await zoomSetting(), 125);
    near((await fontSizes()).editor, 25, "editor font size");
    await press({ key: "0", code: "Digit0" });
    near((await fontSizes()).editor, 20, "editor font size");
    strictEqual(await invoke("get_setting", { key: "editor.font-size" }), 20);
    await invoke("reset_setting", { key: "editor.font-size", scope: "global" });
  });

  it("persists across a reload", async function () {
    await browser.refresh();
    await waitForMount();
    await openReadme();
    await press({ key: "=", code: "Equal" });
    await press({ key: "=", code: "Equal" });
    strictEqual(await zoomSetting(), 125);
    await browser.refresh();
    await waitForMount();
    await openReadme();
    strictEqual(await zoomSetting(), 125);
    near((await fontSizes()).editor, 20, "editor font size");
    await press({ key: "0", code: "Digit0" });
    strictEqual(await zoomSetting(), 100);
  });

  it("offers Zoom In / Zoom Out / Reset Zoom in the command palette", async function () {
    await press({ key: "p", code: "KeyP" });
    for (const id of ["zoom-in", "zoom-out", "zoom-reset"]) {
      await $(`[cmdk-item][data-value="${id}"]`).waitForExist({ timeout: 5_000 });
    }
    await $('[cmdk-item][data-value="zoom-in"]').click();
    await browser.pause(150);
    strictEqual(await zoomSetting(), 110);
    await press({ key: "0", code: "Digit0" });
    strictEqual(await zoomSetting(), 100);
  });
});
