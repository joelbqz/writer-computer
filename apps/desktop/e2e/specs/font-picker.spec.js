import { ok, strictEqual } from "node:assert/strict";

// Font picker verification: drives the settings panel's "font" controls —
// a select-style button opening a picker popover of installed system fonts
// (backed by the `list_system_fonts` IPC command) and the stack rewrite on
// pick.
//
// Requires a restorable workspace: seed
// `~/Library/Application Support/com.writer-computer.e2e/recent_workspaces.json`
// with a real directory before launching. Without one the app lands on the
// welcome screen (where Settings is unreachable) and this suite self-skips,
// so it stays safe inside the default `pnpm run test:e2e` sweep.
describe("Settings font picker", function () {
  let workspaceRestored = false;

  before(async function () {
    // Workspace chrome (sidebar toggle) proves both mount and restore.
    // (The smoke spec's `.animate-fade-in` wrapper no longer exists in App.tsx.)
    workspaceRestored = await $('button[aria-label="Hide sidebar"]')
      .waitForExist({ timeout: 15_000 })
      .catch(() => false);
  });

  beforeEach(function () {
    if (!workspaceRestored) this.skip();
  });

  /** Dispatch a synthetic Cmd+key so the app's document-level shortcut
   *  handler fires (real key chords through the WebDriver bridge are flaky
   *  on WKWebView). */
  async function pressCmd(key) {
    await browser.execute((k) => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: k, metaKey: true, bubbles: true, cancelable: true }),
      );
    }, key);
  }

  it("opens settings via the command palette", async function () {
    await pressCmd("p");
    const settingsCmd = await $('[cmdk-item][data-value="open-settings"]');
    await settingsCmd.waitForExist({ timeout: 5_000 });
    await settingsCmd.click();

    await $("[data-settings-panel]").waitForExist({ timeout: 5_000 });
  });

  it("lists installed fonts in the picker for the active mode's monospace font", async function () {
    // Pick the theme card matching the active mode so the CSS var assertion
    // below observes the change.
    const mode = await browser.execute(() => document.documentElement.getAttribute("data-theme"));
    const heading = mode === "dark" ? "Dark Theme" : "Light Theme";
    const monoPickerButton = await $(
      `//section[.//h2[contains(., "${heading}")]]` +
        `//div[div/div[text()="Monospace font"]]//button[@aria-label="Choose installed font"]`,
    );
    await monoPickerButton.scrollIntoView({ block: "center" });
    await monoPickerButton.click();

    const popover = await $('[role="dialog"][aria-label="Installed fonts"]');
    await popover.waitForExist({ timeout: 5_000 });

    // Options load async through the list_system_fonts IPC round trip.
    await browser.waitUntil(async () => (await popover.$$('[role="option"]')).length > 0, {
      timeout: 10_000,
      timeoutMsg: "no installed fonts appeared in the picker",
    });
    const count = (await popover.$$('[role="option"]')).length;
    ok(count > 20, `expected a real system font list, got ${count} entries`);
    console.log(`[verify] picker lists ${count} installed font families`);
    if (process.env.VERIFY_SHOT_DIR) {
      await browser.saveScreenshot(`${process.env.VERIFY_SHOT_DIR}/font-picker-open.png`);
    }
  });

  it("filters, and picking a font rewrites the stack and the CSS variable", async function () {
    const search = await $('input[aria-label="Search installed fonts"]');
    await search.addValue("Menlo");

    const menlo = await $('[role="option"]*=Menlo');
    await menlo.waitForExist({ timeout: 5_000 });
    await menlo.click();

    // Popover closes on pick.
    const popover = await $('[role="dialog"][aria-label="Installed fonts"]');
    await browser.waitUntil(async () => !(await popover.isExisting()), { timeout: 5_000 });

    // The row's select button now shows the picked family.
    const mode = await browser.execute(() => document.documentElement.getAttribute("data-theme"));
    const heading = mode === "dark" ? "Dark Theme" : "Light Theme";
    const selectButton = await $(
      `//section[.//h2[contains(., "${heading}")]]` +
        `//div[div/div[text()="Monospace font"]]//button[@aria-label="Choose installed font"]`,
    );
    strictEqual(await selectButton.getText(), "Menlo");

    // The active mode's --mono-font CSS var picked it up (theme.ts applyPrimaries).
    const cssVar = await browser.execute(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--mono-font"),
    );
    ok(cssVar.includes("Menlo"), `--mono-font should contain Menlo: ${cssVar}`);

    // And it persisted through the settings backend, leading with the picked
    // family and keeping the schema-default generic tail.
    const persisted = await browser.executeAsync((key, done) => {
      window.__TAURI_INTERNALS__
        .invoke("get_setting", { key })
        .then((v) => done(JSON.stringify(v)))
        .catch((e) => done(`ERROR: ${e && e.message ? e.message : String(e)}`));
    }, `theme.${mode}.mono-font`);
    ok(
      String(persisted).includes("Menlo,"),
      `persisted stack should lead with Menlo: ${persisted}`,
    );
    ok(
      String(persisted).includes("monospace"),
      `persisted stack should keep the tail: ${persisted}`,
    );
    console.log(`[verify] cssVar="${cssVar.trim()}" persisted=${persisted}`);
    if (process.env.VERIFY_SHOT_DIR) {
      await browser.saveScreenshot(`${process.env.VERIFY_SHOT_DIR}/font-picked.png`);
    }
  });

  it("probe: gibberish search shows an empty state, Escape closes the popover", async function () {
    const anyPicker = await $('button[aria-label="Choose installed font"]');
    await anyPicker.scrollIntoView({ block: "center" });
    await anyPicker.click();

    const search = await $('input[aria-label="Search installed fonts"]');
    await search.waitForExist({ timeout: 5_000 });
    await search.addValue("zzzznotafont");
    const empty = await $("div=No matching fonts.");
    await empty.waitForExist({ timeout: 5_000 });

    await browser.execute(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    const popover = await $('[role="dialog"][aria-label="Installed fonts"]');
    await browser.waitUntil(async () => !(await popover.isExisting()), {
      timeout: 5_000,
      timeoutMsg: "popover did not close on Escape",
    });
  });
});
