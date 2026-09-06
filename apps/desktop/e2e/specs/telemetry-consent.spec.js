import { ok, strictEqual } from "node:assert/strict";

// First-run telemetry consent dialog.
//
// The dialog only appears in a build with a PostHog key compiled in, so this
// spec self-skips otherwise — that is the same guard real users get, and a
// keyless dev build correctly shows nothing. Build with:
//
//   WRITER_POSTHOG_KEY=phc_e2e_fake_key WRITER_POSTHOG_HOST=http://127.0.0.1:9 \
//     cargo tauri build --features e2e --bundles app --ignore-version-mismatches \
//     --config '{"identifier":"com.writer-computer.e2e","bundle":{"createUpdaterArtifacts":false}}'
//
// The discard-port host keeps the fake key from reaching a real project: the
// dispatcher's request fails fast and the event is dropped.
//
// Between runs, wipe both `telemetry.json` (`prompted` is one-shot by design)
// and the `config` file in `~/Library/Application Support/com.writer-computer.e2e/`
// — an earlier accepted run leaves `telemetry.enabled = true` there, which the
// "off while the prompt is open" assertion below reads back.
describe("telemetry consent dialog", function () {
  it("shows on first run and stays opt-out until accepted", async function () {
    await $("#root > *").waitForExist({ timeout: 15_000 });

    const dialog = await $('[aria-labelledby="telemetry-consent-title"]');
    if (!(await dialog.isExisting())) {
      // No key compiled in, or this run already answered the prompt.
      this.skip();
      return;
    }

    // Copy is present and the destructive-sounding default is off.
    const text = await dialog.getText();
    ok(text.includes("What is sent"), "dialog lists what is sent");
    ok(text.includes("What is never sent"), "dialog lists what is never sent");
    ok(text.includes("Not now"), "declining is offered");

    const enabledBefore = await browser.executeAsync((done) => {
      void (async () => {
        const { invoke } = window.__TAURI_INTERNALS__;
        done(await invoke("get_setting", { key: "telemetry.enabled" }));
      })();
    });
    strictEqual(enabledBefore, false, "telemetry is off while the prompt is open");

    // Type an email, then accept.
    const emailInput = await dialog.$('input[type="email"]');
    await emailInput.addValue("e2e@example.com");
    const acceptButton = await dialog.$("button=Share usage data");
    await acceptButton.click();

    await dialog.waitForExist({ timeout: 5_000, reverse: true });

    const after = await browser.executeAsync((done) => {
      void (async () => {
        const { invoke } = window.__TAURI_INTERNALS__;
        done({
          enabled: await invoke("get_setting", { key: "telemetry.enabled" }),
          email: await invoke("get_setting", { key: "telemetry.email" }),
          shouldPrompt: await invoke("telemetry_should_prompt"),
        });
      })();
    });

    strictEqual(after.enabled, true, "accepting enables telemetry");
    strictEqual(after.email, "e2e@example.com", "the typed email is persisted");
    strictEqual(after.shouldPrompt, false, "the prompt does not return");
  });
});
