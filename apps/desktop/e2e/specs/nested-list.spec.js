import { ok, equal } from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Nested list rendering verification: seeds a markdown file with a
// hard-wrapped bullet (continuation lines indented under the marker) and
// nested items, opens it from the sidebar, and asserts the continuation
// lines are padded to the body column with their source indent collapsed
// (see SPECs/nested-list-editing-audit-spec.md, section 6).
//
// Requires a restorable workspace, like latex-math.spec.js; self-skips
// otherwise. Set NESTED_LIST_SHOT=/abs/dir to also save a screenshot there.
describe("Nested list rendering", function () {
  const FILE_STEM = "nested-list-e2e";
  const DOC = [
    "# List wrap check",
    "",
    "- json-render docs: https://json-render.dev/docs , quick start https://json-render.dev/docs/quick-start ,",
    "  data binding https://json-render.dev/docs/data-binding , streaming https://json-render.dev/docs/streaming ,",
    "  jev https://json-render.dev/docs/jev , shadcn integration package `@json-render/shadcn`",
    "- Packages: `@json-render/core`, `@json-render/react`",
    "  - nested item that also wraps onto",
    "    a second source line",
    "  - [ ] a task that wraps onto",
    "    a second source line too",
    "1. ordered item that wraps onto",
    "   a second source line",
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
    if (filePath) await invoke("delete_entry", { path: filePath });
  });

  it("opens the seeded document from the sidebar", async function () {
    // Title or filename stem, depending on the sidebar-file-label setting.
    let row = await $("span*=List wrap check");
    let found = await row.waitForExist({ timeout: 15_000 }).catch(() => false);
    if (!found) {
      row = await $(`span*=${FILE_STEM}`);
      found = await row.waitForExist({ timeout: 2_000 }).catch(() => false);
    }
    if (!found && process.env.NESTED_LIST_SHOT) {
      mkdirSync(process.env.NESTED_LIST_SHOT, { recursive: true });
      await browser.saveScreenshot(resolve(process.env.NESTED_LIST_SHOT, "nested-list-no-row.png"));
    }
    ok(found, "seeded document never appeared in the sidebar");
    await row.click();
    await browser.waitUntil(async () => (await $$(".cm-content")).length > 0, {
      timeout: 10_000,
      timeoutMsg: "editor never mounted",
    });
  });

  it("pads continuation lines to the body column and hides their indent", async function () {
    // Wait for the list decorations to land on the continuation lines.
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () =>
            Array.from(document.querySelectorAll(".cm-line")).filter((l) =>
              /padding-inline-start/.test(l.getAttribute("style") || ""),
            ).length,
        )) >= 8,
      { timeout: 10_000, timeoutMsg: "list line decorations never rendered" },
    );

    const lines = await browser.execute(() =>
      Array.from(document.querySelectorAll(".cm-line")).map((l) => ({
        text: l.textContent,
        style: l.getAttribute("style") || "",
        firstTextLeft: (() => {
          const walker = document.createTreeWalker(l, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = walker.nextNode())) {
            if (n.textContent.trim() === "") continue;
            const parent = n.parentElement;
            if (parent && parent.closest(".cm-list-prefix, .cm-list-indent-visual")) continue;
            const range = document.createRange();
            range.setStart(n, 0);
            range.setEnd(n, 1);
            const r = range.getClientRects()[0];
            return r ? Math.round(r.left) : null;
          }
          return null;
        })(),
      })),
    );

    if (process.env.NESTED_LIST_SHOT) {
      mkdirSync(process.env.NESTED_LIST_SHOT, { recursive: true });
      await browser.saveScreenshot(resolve(process.env.NESTED_LIST_SHOT, "nested-list.png"));
    }

    const byText = (needle) => lines.find((l) => l.text.includes(needle));
    const marker = byText("json-render docs");
    const cont1 = byText("data binding");
    const cont2 = byText("jev https");
    const nestedMarker = byText("nested item that also wraps");
    ok(marker && cont1 && cont2, "expected the wrapped bullet's three lines");

    ok(/padding-inline-start: 3ch/.test(cont1.style), `continuation 1 style: ${cont1.style}`);
    ok(/padding-inline-start: 3ch/.test(cont2.style), `continuation 2 style: ${cont2.style}`);
    // The source indent is collapsed, not rendered as text.
    ok(
      !cont1.text.startsWith("  "),
      `continuation text still starts with spaces: ${JSON.stringify(cont1.text)}`,
    );
    // Body text starts at the same x on the marker line and its continuations.
    equal(cont1.firstTextLeft, marker.firstTextLeft, "continuation 1 body column");
    equal(cont2.firstTextLeft, marker.firstTextLeft, "continuation 2 body column");

    const nestedLines = lines.filter((l) => /a second source line/.test(l.text));
    ok(nestedLines.length >= 3, "expected three nested/ordered continuation lines");
    ok(
      /padding-inline-start: 6ch/.test(nestedLines[0].style),
      `nested continuation: ${nestedLines[0].style}`,
    );
    ok(
      /padding-inline-start: 6ch/.test(nestedLines[1].style),
      `task continuation: ${nestedLines[1].style}`,
    );
    ok(
      /padding-inline-start: 3ch/.test(nestedLines[2].style),
      `ordered continuation: ${nestedLines[2].style}`,
    );
    equal(
      nestedLines[0].firstTextLeft,
      nestedMarker.firstTextLeft,
      "nested continuation body column",
    );
  });
});
