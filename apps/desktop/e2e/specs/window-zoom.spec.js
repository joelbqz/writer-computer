import { ok, strictEqual } from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const E2E_WORKSPACE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const ZOOM_KEY = "window.zoom";

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
  // Optimistic store update + IPC to the webview are synchronous from the
  // handler's point of view, but give WebKit a frame to re-layout.
  await browser.pause(150);
}

async function zoomSetting() {
  return invoke("get_setting", { key: ZOOM_KEY });
}

async function cssViewportWidth() {
  return browser.execute(() => window.innerWidth);
}

describe("window zoom shortcuts", function () {
  let baseWidth;

  before(async function () {
    const workspaceRestored = await $('[data-sidebar-surface][data-workspace-open="true"]')
      .waitForExist({ timeout: 3_000 })
      .catch(() => false);
    if (!workspaceRestored) {
      await invoke("open_workspace", { path: E2E_WORKSPACE });
      await browser.refresh();
    }
    await waitForMount();
    await invoke("reset_setting", { key: ZOOM_KEY, scope: "global" });
    await browser.refresh();
    await waitForMount();
    baseWidth = await cssViewportWidth();
  });

  after(async function () {
    await invoke("reset_setting", { key: ZOOM_KEY, scope: "global" }).catch(() => {});
  });

  it("starts at 100% with editor.font-size untouched", async function () {
    strictEqual(await zoomSetting(), 100);
    strictEqual(await invoke("get_setting", { key: "editor.font-size" }), 16);
  });

  it("Cmd+= zooms in one stop and shrinks the CSS viewport", async function () {
    await press({ key: "=", code: "Equal" });
    strictEqual(await zoomSetting(), 110);
    const width = await cssViewportWidth();
    ok(width < baseWidth, `expected viewport narrower than ${baseWidth}, got ${width}`);
    ok(Math.abs(width - baseWidth / 1.1) <= 2, `expected ≈${baseWidth / 1.1}, got ${width}`);
  });

  it("Cmd+Shift+= (Cmd++) and Cmd+numpad + also zoom in", async function () {
    await press({ key: "+", code: "Equal", shiftKey: true });
    strictEqual(await zoomSetting(), 125);
    await press({ key: "+", code: "NumpadAdd" });
    strictEqual(await zoomSetting(), 150);
  });

  it("Cmd+- zooms out one stop", async function () {
    await press({ key: "-", code: "Minus" });
    strictEqual(await zoomSetting(), 125);
    await press({ key: "-", code: "NumpadSubtract" });
    strictEqual(await zoomSetting(), 110);
  });

  it("Cmd+0 returns to actual size", async function () {
    await press({ key: "0", code: "Digit0" });
    strictEqual(await zoomSetting(), 100);
    const width = await cssViewportWidth();
    ok(Math.abs(width - baseWidth) <= 2, `expected ≈${baseWidth}, got ${width}`);
  });

  it("Cmd+Alt+0 is left to the editor (no zoom change)", async function () {
    await press({ key: "=", code: "Equal" });
    strictEqual(await zoomSetting(), 110);
    await press({ key: "0", code: "Digit0", altKey: true });
    strictEqual(await zoomSetting(), 110);
    await press({ key: "0", code: "Digit0" });
    strictEqual(await zoomSetting(), 100);
  });

  it("persists across a reload", async function () {
    await press({ key: "=", code: "Equal" });
    await press({ key: "=", code: "Equal" });
    strictEqual(await zoomSetting(), 125);
    await browser.refresh();
    await waitForMount();
    strictEqual(await zoomSetting(), 125);
    const width = await cssViewportWidth();
    ok(Math.abs(width - baseWidth / 1.25) <= 2, `expected ≈${baseWidth / 1.25}, got ${width}`);
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
    strictEqual(await invoke("get_setting", { key: "editor.font-size" }), 16);
  });
});
