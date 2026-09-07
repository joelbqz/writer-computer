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
  it("subscribes by email without switching usage data on", async function () {
    await $("#root > *").waitForExist({ timeout: 15_000 });

    const dialog = await $('[aria-labelledby="telemetry-consent-title"]');
    if (!(await dialog.isExisting())) {
      // No key compiled in, or this run already answered the prompt.
      this.skip();
      return;
    }

    ok((await dialog.getText()).includes("Not now"), "declining is offered");

    // The full list is a hover popover, so nothing shows until it is asked for.
    strictEqual(
      await dialog.$("#telemetry-consent-details").isExisting(),
      false,
      "the list stays out of the way until hovered",
    );
    const disclosure = await dialog.$('[aria-describedby="telemetry-consent-details"]');
    await disclosure.moveTo();
    const details = await dialog.$("#telemetry-consent-details");
    await details.waitForExist({ timeout: 2_000 });
    const detailsText = await details.getText();
    ok(detailsText.includes("Sent"), "the popover lists what is sent");
    ok(detailsText.includes("Never sent"), "the popover lists what is never sent");

    const enabledBefore = await browser.executeAsync((done) => {
      void (async () => {
        const { invoke } = window.__TAURI_INTERNALS__;
        done(await invoke("get_setting", { key: "telemetry.enabled" }));
      })();
    });
    strictEqual(enabledBefore, false, "telemetry is off while the prompt is open");

    // Subscribe to release news while declining usage data — the two asks are
    // independent, and this is the combination that only works because an
    // email change is exempt from the usage switch.
    const emailInput = await dialog.$('input[type="email"]');
    await emailInput.addValue("e2e@example.com");
    const usageSwitch = await dialog.$('[role="switch"]');
    strictEqual(await usageSwitch.getAttribute("aria-checked"), "true", "usage data starts on");
    await usageSwitch.click();
    strictEqual(await usageSwitch.getAttribute("aria-checked"), "false", "the switch turns it off");

    const acceptButton = await dialog.$("button=Subscribe");
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

    strictEqual(after.enabled, false, "an unchecked box leaves usage data off");
    strictEqual(after.email, "e2e@example.com", "the typed email is persisted anyway");
    strictEqual(after.shouldPrompt, false, "the prompt does not return");
  });
});
