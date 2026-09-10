/**
 * Build-time analytics configuration, kept apart from `analytics.tsx` so the
 * "no key means inert" rule can be asserted without pulling React or
 * `posthog-js` into a test.
 */

/** Matches the desktop app's `WRITER_POSTHOG_HOST` default. */
export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

export type AnalyticsConfig = { key: string; host: string };

/**
 * Resolve the configuration from the environment. Pure and env-injected: a
 * missing or blank key yields null, which is what makes the site structurally
 * inert rather than merely switched off.
 */
export function resolveAnalyticsConfig(env: {
  VITE_POSTHOG_KEY?: string;
  VITE_POSTHOG_HOST?: string;
}): AnalyticsConfig | null {
  const key = env.VITE_POSTHOG_KEY?.trim();
  if (!key) return null;
  return { key, host: env.VITE_POSTHOG_HOST?.trim() || DEFAULT_POSTHOG_HOST };
}
