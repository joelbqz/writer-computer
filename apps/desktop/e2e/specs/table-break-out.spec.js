import { ok } from "node:assert/strict";

// Wide rendered tables breaking out of the editor measure (Phase B, see
// SPECs/table-break-out-measure-spec.md). A table that fits the measure must
// render exactly as before; a wider one grows past the measure with equal
// overhang on both sides, up to the pane minus `--writer-editor-breakout-gutter`;
// past that it scrolls inside `.cm-table-inner` rather than pushing the document
// sideways. Unfolding it puts ordinary source lines back inside the measure.
//
// Requires a restorable workspace; self-skips on the welcome screen so it stays
// safe inside the default `pnpm run test:e2e` sweep.
describe("table break-out", function () {
  const FILE_STEM = "table-break-out-e2e";
  const DOC = [
    "# Table break-out check",
    "",
    "| Key | Value |",
    "| --- | --- |",
    "| host | localhost |",
    "| port | 5432 |",
    "",
    "| Column | Storage | Nullable | Indexed | Migration | Owner | Notes | Retention |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    "| created_at | timestamptz | no | btree | 0004_initial | platform | Set by the " +
      "database default, never by the application. | forever |",
    "| deleted_at | timestamptz | yes | partial | 0031_soft_delete | platform | Soft " +
      "deletes are filtered by every read path through the shared view. | forever |",
    "",
  ].join("\n");

  // The gutter `--writer-editor-breakout-gutter` keeps free on each side.
  const GUTTER = 64;

  let workspaceRestored = false;
  let filePath = null;
  let originalSize = null;

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

  // The driver's Set Window Rect takes physical pixels; the geometry below is
  // all CSS pixels.
  async function setWindowWidth(width) {
    const dpr = await browser.execute(() => window.devicePixelRatio || 1);
    await browser.setWindowSize(Math.round(width * dpr), Math.round(900 * dpr));
    await browser.pause(600);
  }

  async function measure() {
    return browser.execute(() => {
      const content = document.querySelector(".cm-content");
      const scroller = document.querySelector(".cm-scroller");
      const pane = document.querySelector("[data-pane] div.overflow-y-auto");
      const style = getComputedStyle(content);
      const rect = content.getBoundingClientRect();
      const measureLeft = rect.left + parseFloat(style.paddingLeft);
      const measureRight = rect.right - parseFloat(style.paddingRight);
      const paneRect = pane.getBoundingClientRect();

      return {
        measureLeft,
        measureRight,
        measureWidth: measureRight - measureLeft,
        paneLeft: paneRect.left,
        paneRight: paneRect.right,
        paneScrollsHorizontally: pane.scrollWidth - pane.clientWidth > 1,
        scrollerScrollsHorizontally: scroller.scrollWidth - scroller.clientWidth > 1,
        tables: [...document.querySelectorAll(".cm-table-widget")].map((widget) => {
          const inner = widget.querySelector(".cm-table-inner");
          const innerRect = inner.getBoundingClientRect();
          return {
            headers: [...widget.querySelectorAll("thead th")]
              .map((th) => th.textContent.trim())
              .join("|"),
            tableWidth: widget.querySelector("table").getBoundingClientRect().width,
            innerLeft: innerRect.left,
            innerRight: innerRect.right,
            innerWidth: innerRect.width,
            overhangLeft: measureLeft - innerRect.left,
            overhangRight: innerRect.right - measureRight,
            scrolls: inner.scrollWidth - inner.clientWidth > 1,
          };
        }),
      };
    });
  }

  before(async function () {
    workspaceRestored = await $('button[aria-label="Hide sidebar"]')
      .waitForExist({ timeout: 20_000 })
      .catch(() => false);
    if (!workspaceRestored) return;

    originalSize = await browser.getWindowSize();

    const recents = await invoke("get_recent_workspaces", {});
    const root = recents.ok && Array.isArray(recents.value) ? recents.value[0] : null;
    ok(root, "no workspace root to seed the break-out document into");

    filePath = `${root}/${FILE_STEM}.md`;
    const wrote = await invoke("write_file", { path: filePath, content: DOC });
    ok(wrote.ok, `failed to seed ${filePath}: ${wrote.error}`);

    // Reload rather than waiting on the workspace watcher: startup rebuilds the
    // file index from disk, so the seeded document is in the sidebar
    // deterministically.
    await browser.execute(() => window.location.reload());
    await $('button[aria-label="Hide sidebar"]').waitForExist({ timeout: 20_000 });
  });

  beforeEach(function () {
    if (!workspaceRestored) this.skip();
  });

  after(async function () {
    if (originalSize) await browser.setWindowSize(originalSize.width, originalSize.height);
    if (filePath) await invoke("delete_entry", { path: filePath });
  });

  it("opens the seeded document from the sidebar", async function () {
    const row = await $(`span*=Table break-out check`);
    await row.waitForExist({ timeout: 20_000 });
    await row.click();

    // Guard against measuring some other restored document.
    await browser.waitUntil(
      async () => (await $(".cm-content").getText()).includes("Table break-out check"),
      { timeout: 15_000, timeoutMsg: "the seeded document never became the active one" },
    );
    await browser.waitUntil(async () => (await $$(".cm-table-widget table")).length >= 2, {
      timeout: 15_000,
      timeoutMsg: "table widgets never rendered",
    });
  });

  it("leaves a table that fits inside the measure alone", async function () {
    await setWindowWidth(1600);
    const { tables, measureWidth } = await measure();
    const fitting = tables.find((t) => t.headers === "Key|Value");
    ok(fitting, "the narrow table did not render");
    ok(
      fitting.tableWidth < measureWidth,
      `expected the narrow table (${fitting.tableWidth}) inside the measure (${measureWidth})`,
    );
    ok(
      Math.abs(fitting.overhangLeft) <= 1 && Math.abs(fitting.overhangRight) <= 1,
      `a table that fits must not overhang, got L${fitting.overhangLeft}/R${fitting.overhangRight}`,
    );
    ok(!fitting.scrolls, "a table that fits must not become a scroll container");
  });

  it("centres a wider table on the measure, inside the pane gutter", async function () {
    await setWindowWidth(1600);
    const m = await measure();
    const wide = m.tables.find((t) => t.headers.startsWith("Column|Storage"));
    ok(wide, "the wide table did not render");
    ok(
      wide.innerWidth > m.measureWidth,
      `expected the wide table (${wide.innerWidth}) to break out of the measure (${m.measureWidth})`,
    );
    ok(
      Math.abs(wide.overhangLeft - wide.overhangRight) <= 1,
      `overhang must be even, got L${wide.overhangLeft}/R${wide.overhangRight}`,
    );
    ok(
      wide.innerLeft >= m.paneLeft + GUTTER - 1 && wide.innerRight <= m.paneRight - GUTTER + 1,
      `break-out must keep the ${GUTTER}px pane gutter, got ` +
        `${wide.innerLeft}..${wide.innerRight} in pane ${m.paneLeft}..${m.paneRight}`,
    );
    ok(!m.paneScrollsHorizontally, "the document pane must never scroll horizontally");
  });

  it("scrolls inside the table instead of the document when the pane is narrow", async function () {
    await setWindowWidth(900);
    const m = await measure();
    const wide = m.tables.find((t) => t.headers.startsWith("Column|Storage"));
    ok(wide, "the wide table did not render");
    ok(wide.scrolls, "a table too wide for the pane must scroll inside its own box");
    ok(
      wide.innerWidth <= m.measureWidth + 1,
      `with no break-out room the box must stay at the measure, got ${wide.innerWidth} vs ${m.measureWidth}`,
    );
    ok(!m.paneScrollsHorizontally, "the document pane must never scroll horizontally");
    ok(!m.scrollerScrollsHorizontally, "the editor scroller must never scroll horizontally");
  });

  it("keeps the unfolded source lines inside the measure", async function () {
    await setWindowWidth(1600);
    // `selectAllDecorationsOnSelectExtension` range-selects the widget on
    // mousedown, which flips the fold to code-block-styled source lines. Driver
    // clicks are flaky on WKWebView, so dispatch the event the handler listens
    // for — this also exercises `posAtDOM` on a widget that overhangs the line.
    await browser.execute(() => {
      const widget = [...document.querySelectorAll(".cm-table-widget")].find((w) =>
        [...w.querySelectorAll("thead th")]
          .map((th) => th.textContent.trim())[0]
          ?.startsWith("Column"),
      );
      widget?.scrollIntoView({ block: "center" });
      const cell = widget?.querySelector("td");
      if (!cell) return;
      const r = cell.getBoundingClientRect();
      for (const type of ["mousedown", "mouseup", "click"]) {
        cell.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: r.left + 5,
            clientY: r.top + 5,
          }),
        );
      }
    });

    await browser.waitUntil(async () => (await $$(".cm-table-source-line")).length > 0, {
      timeout: 10_000,
      timeoutMsg: "the touched table never unfolded into source lines",
    });

    const lines = await browser.execute(() => {
      const content = document.querySelector(".cm-content");
      const style = getComputedStyle(content);
      const rect = content.getBoundingClientRect();
      const measureLeft = rect.left + parseFloat(style.paddingLeft);
      const measureRight = rect.right - parseFloat(style.paddingRight);
      const rects = [...document.querySelectorAll(".cm-table-source-line")].map((l) =>
        l.getBoundingClientRect(),
      );
      return {
        measureLeft,
        measureRight,
        left: Math.min(...rects.map((r) => r.left)),
        right: Math.max(...rects.map((r) => r.right)),
      };
    });

    ok(
      lines.left >= lines.measureLeft - 1 && lines.right <= lines.measureRight + 1,
      `source lines must stay inside the measure, got ${lines.left}..${lines.right} ` +
        `vs ${lines.measureLeft}..${lines.measureRight}`,
    );

    if (process.env.VERIFY_SHOT_DIR) {
      await browser.saveScreenshot(`${process.env.VERIFY_SHOT_DIR}/table-break-out.png`);
    }
  });
});
