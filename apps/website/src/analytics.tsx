/**
 * The marketing site's analytics surface. Nothing else on the site imports
 * `posthog-js`; the build-time configuration lives in `./analytics-config`.
 *
 * Nothing here touches the network unless `VITE_POSTHOG_KEY` was set at *build*
 * time. With no key `resolveAnalyticsConfig` returns null, the provider is
 * never rendered, PostHog is never initialized, and `useAnalytics` hands back a
 * no-op — inert rather than merely switched off, the same rule
 * `apps/desktop/src-tauri/src/telemetry.rs` applies to a keyless build. That is
 * what makes a local `vp run website#build` and anyone's clone of this repo
 * silent by construction.
 *
 * Initialization lives inside `PostHogProvider`'s effect, so the server render
 * and the prerender pass never construct a client or reach for `window`.
 *
 * See `docs/website-analytics.md` for the event list and the env vars. If the
 * events below change, that doc changes in the same commit.
 */

import { PostHogProvider, usePostHog } from "posthog-js/react";
import { useCallback, type ReactNode } from "react";

import { resolveAnalyticsConfig } from "./analytics-config";

/**
 * The complete list of events the site sends, in the desktop app's
 * `noun_verbed` style. `$pageview` is PostHog's own and is captured by the SDK;
 * these three are every explicit interaction.
 */
export type AnalyticsEvent = "updates_opened" | "github_opened" | "download_started";

/**
 * The only per-event property. Deliberately a closed shape rather than an open
 * `Record<string, unknown>`: there is no channel through which anything else
 * could be attached to an event.
 */
type AnalyticsProperties = { app_version: string };

/**
 * Resolved once, at module load. Every input is inlined at build time — the
 * `VITE_*` pair by Vite, the `WRITER_*` pair by the `define` bridge in
 * `vite.config.ts` — so this is a constant and the element tree below never
 * changes shape between renders. The four are passed by name rather than
 * handing over `import.meta.env`, which carries only the `VITE_*` ones.
 */
const config = resolveAnalyticsConfig({
  VITE_POSTHOG_KEY: import.meta.env.VITE_POSTHOG_KEY,
  WRITER_POSTHOG_KEY: __WRITER_POSTHOG_KEY__,
  VITE_POSTHOG_HOST: import.meta.env.VITE_POSTHOG_HOST,
  WRITER_POSTHOG_HOST: __WRITER_POSTHOG_HOST__,
});

/**
 * Wrap the routed tree so `useAnalytics` has a client to talk to. Renders its
 * children untouched when there is no key.
 */
export function Analytics({ children }: Readonly<{ children: ReactNode }>) {
  if (!config) return children;
  return (
    <PostHogProvider
      apiKey={config.key}
      options={{
        api_host: config.host,
        // Current defaults, including injecting PostHog's own scripts into
        // <head> — the body injection the legacy defaults use trips hydration
        // on a prerendered document.
        defaults: "2026-01-30",
        capture_pageview: "history_change",
        // Everything below can otherwise be switched on remotely from project
        // settings. The site collects the documented event list and nothing
        // else, so each one is pinned off here rather than left to a toggle.
        autocapture: false,
        capture_heatmaps: false,
        capture_exceptions: false,
        disable_session_recording: true,
        disable_surveys: true,
        // Visitors are anonymous; nothing on this site identifies anyone, so
        // there is no reason to mint a person profile per visitor.
        person_profiles: "identified_only",
      }}
    >
      {children}
    </PostHogProvider>
  );
}

/**
 * Capture one of the site's events. A no-op without a key, so callers never
 * have to know whether analytics exists.
 */
export function useAnalytics() {
  const posthog = usePostHog();
  return useCallback(
    (event: AnalyticsEvent, properties?: AnalyticsProperties) => {
      if (!config) return;
      posthog.capture(event, properties);
    },
    [posthog],
  );
}
