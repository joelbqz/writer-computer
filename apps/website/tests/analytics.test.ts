import { describe, expect, test } from "vite-plus/test";
import { DEFAULT_POSTHOG_HOST, resolveAnalyticsConfig } from "../src/analytics-config";

describe("resolveAnalyticsConfig", () => {
  test("no key means inert — nothing to initialize", () => {
    expect(resolveAnalyticsConfig({})).toBeNull();
    expect(resolveAnalyticsConfig({ VITE_POSTHOG_KEY: "" })).toBeNull();
    expect(resolveAnalyticsConfig({ VITE_POSTHOG_KEY: "   " })).toBeNull();
    // A host on its own is not enough: the key is what enables the client.
    expect(resolveAnalyticsConfig({ VITE_POSTHOG_HOST: "https://eu.i.posthog.com" })).toBeNull();
  });

  test("a key alone resolves against the default host", () => {
    expect(resolveAnalyticsConfig({ VITE_POSTHOG_KEY: " phc_test " })).toEqual({
      key: "phc_test",
      host: DEFAULT_POSTHOG_HOST,
    });
  });

  test("the host is overridable, and a blank override falls back", () => {
    expect(
      resolveAnalyticsConfig({
        VITE_POSTHOG_KEY: "phc_test",
        VITE_POSTHOG_HOST: " https://eu.i.posthog.com ",
      }),
    ).toEqual({ key: "phc_test", host: "https://eu.i.posthog.com" });
    expect(
      resolveAnalyticsConfig({ VITE_POSTHOG_KEY: "phc_test", VITE_POSTHOG_HOST: "  " }),
    ).toEqual({ key: "phc_test", host: DEFAULT_POSTHOG_HOST });
  });
});
