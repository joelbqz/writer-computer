import { ok, strictEqual } from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const E2E_WORKSPACE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const VISIBILITY_KEYS = [
  "statusbar.show-words",
  "statusbar.show-characters",
  "statusbar.show-paragraphs",
  "appearance.sidebar-show-search",
  "appearance.sidebar-show-recents",
];

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

async function setSetting(key, value) {
  await invoke("set_setting", { key, value, scope: "global" });
}

async function resetVisibilitySettings() {
  for (const key of VISIBILITY_KEYS) {
    await invoke("reset_setting", { key, scope: "global" });
  }
}

async function waitForMount() {
  await $('button[aria-label="Hide sidebar"]').waitForExist({ timeout: 15_000 });
}

async function openReadme() {
  const row = await $('[data-tree-path$="/README.md"]');
  await row.waitForExist({ timeout: 10_000 });
  await row.click();
  await $("[data-document-footer]").waitForExist({ timeout: 10_000 });
}

async function footerMetricLabels() {
  return browser.execute(() => {
    const footer = document.querySelector("[data-document-footer]");
    if (!footer) return null;
    return Array.from(footer.querySelectorAll("span"))
      .map((span) => span.textContent ?? "")
      .filter((text) => /^[a-z]+$/.test(text));
  });
}

describe("status bar and sidebar visibility settings", function () {
  before(async function () {
    const workspaceRestored = await $('button[aria-label="Hide sidebar"]')
      .waitForExist({ timeout: 3_000 })
      .catch(() => false);
    if (!workspaceRestored) {
      await invoke("open_workspace", { path: E2E_WORKSPACE });
    }
    await waitForMount();
    await resetVisibilitySettings();
    await browser.refresh();
    await waitForMount();
  });

  after(async function () {
    await resetVisibilitySettings().catch(() => {});
  });

  it("shows all three footer metrics by default", async function () {
    await openReadme();
    const labels = await footerMetricLabels();
    strictEqual(JSON.stringify(labels), JSON.stringify(["words", "characters", "paragraphs"]));
  });

  it("hides a single metric when its setting is off", async function () {
    await setSetting("statusbar.show-characters", false);
    await browser.refresh();
    await waitForMount();
    await openReadme();
    const labels = await footerMetricLabels();
    strictEqual(JSON.stringify(labels), JSON.stringify(["words", "paragraphs"]));
  });

  it("removes the footer entirely when every metric is off", async function () {
    await setSetting("statusbar.show-words", false);
    await setSetting("statusbar.show-paragraphs", false);
    await browser.refresh();
    await waitForMount();
    // The document restores without a footer, so wait on the editor instead.
    const row = await $('[data-tree-path$="/README.md"]');
    await row.waitForExist({ timeout: 10_000 });
    await row.click();
    await browser.pause(1_000);
    strictEqual(await $("[data-document-footer]").isExisting(), false);
  });

  it("shows the sidebar Search button by default and hides it when off", async function () {
    ok(await $("[data-sidebar-search-button]").isExisting());
    await setSetting("appearance.sidebar-show-search", false);
    await browser.refresh();
    await waitForMount();
    strictEqual(await $("[data-sidebar-search-button]").isExisting(), false);
  });

  it("renders all five toggles in Preferences", async function () {
    await browser.execute(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "p", metaKey: true, bubbles: true, cancelable: true }),
      );
    });
    const settingsCommand = await $('[cmdk-item][data-value="open-settings"]');
    await settingsCommand.waitForExist({ timeout: 5_000 });
    await settingsCommand.click();
    await $("[data-settings-panel]").waitForExist({ timeout: 5_000 });

    const rows = await browser.execute(() => {
      const labels = Array.from(document.querySelectorAll("[data-settings-panel] section")).flatMap(
        (section) => {
          const heading = section.querySelector("h2")?.textContent ?? "";
          return Array.from(section.querySelectorAll("div.text-\\[13px\\].font-medium")).map(
            (label) => `${heading}: ${label.textContent}`,
          );
        },
      );
      return labels;
    });
    for (const expected of [
      "Appearance: Sidebar Search Button",
      "Appearance: Sidebar Recents",
      "Status Bar: Words",
      "Status Bar: Characters",
      "Status Bar: Paragraphs",
    ]) {
      ok(rows.includes(expected), `missing settings row "${expected}" in ${JSON.stringify(rows)}`);
    }
  });

  it("hides the Recents section when off", async function () {
    // Opening README earlier recorded it, so Recents should be populated.
    const recents = await $('section[aria-label="Recents"]');
    const hadRecents = await recents
      .waitForExist({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    await setSetting("appearance.sidebar-show-recents", false);
    await browser.refresh();
    await waitForMount();
    await browser.pause(1_000);
    strictEqual(await $('section[aria-label="Recents"]').isExisting(), false);
    // Only meaningful if the section was there to begin with.
    ok(hadRecents, "Recents section never appeared while enabled");
  });
});
