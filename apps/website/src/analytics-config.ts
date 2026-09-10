/**
 * Build-time analytics configuration, kept apart from `analytics.tsx` so the
 * "no key means inert" rule can be asserted without pulling React or
 * `posthog-js` into a test.
 *
 * The site and the desktop app share one PostHog project, so the desktop's
 * `WRITER_POSTHOG_KEY` — which already lives in the repo-root `.env` — stands
 * in as the fallback. `VITE_POSTHOG_KEY` still wins where it is set, which is
 * what lets the site be pointed somewhere else without touching the app.
 *
 * `WRITER_*` has no `VITE_` prefix, so Vite does not expose it on its own; it
 * is bridged by name in `vite.config.ts`. See `docs/website-analytics.md`.
 */

/** Matches the desktop app's `WRITER_POSTHOG_HOST` default. */
export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

export type AnalyticsConfig = { key: string; host: string };

/**
 * Environment inputs, in precedence order per pair. Every value is optional and
 * a blank one counts as absent, so an unset variable and one bridged through as
 * `""` behave the same.
 */
export type AnalyticsEnv = {
  VITE_POSTHOG_KEY?: string;
  WRITER_POSTHOG_KEY?: string;
  VITE_POSTHOG_HOST?: string;
  WRITER_POSTHOG_HOST?: string;
};

/** First value that is set and not just whitespace. */
function firstConfigured(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

/**
 * Resolve the configuration from the environment. Pure and env-injected: a
 * missing or blank key yields null, which is what makes the site structurally
 * inert rather than merely switched off.
 */
export function resolveAnalyticsConfig(env: AnalyticsEnv): AnalyticsConfig | null {
  const key = firstConfigured(env.VITE_POSTHOG_KEY, env.WRITER_POSTHOG_KEY);
  if (!key) return null;
  const host =
    firstConfigured(env.VITE_POSTHOG_HOST, env.WRITER_POSTHOG_HOST) ?? DEFAULT_POSTHOG_HOST;
  return { key, host };
}
