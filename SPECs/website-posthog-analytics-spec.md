# Website PostHog Analytics

## Problem

The marketing website reports to a self-hosted Umami instance, while the desktop
app reports to PostHog (`apps/desktop/src-tauri/src/telemetry.rs`). Two
analytics services means two dashboards, two event vocabularies, and no way to
line a download up against the `app_opened` that followed it. The Umami setup
also hardcodes both the script origin and the site ID in `__root.tsx`, so there
is no way to build the site without them.

## Goals

- Remove Umami from the website: the script tag, every `data-umami-*`
  attribute, and the stale doc references.
- Send the same signal to PostHog: pageviews, plus the three interactions the
  `data-umami-event` attributes covered, with the app version preserved on the
  download.
- Name events in the desktop app's `noun_verbed` style so one project reads as
  one vocabulary.
- Take configuration from the environment: a public project key and an
  overridable host defaulting to `https://us.i.posthog.com`.
- With no key, be structurally inert — no client, no network calls, no console
  noise — the same rule `telemetry.rs` applies to a keyless build.

## Non-Goals

- No change to the desktop app's telemetry behavior.
- No autocapture, session replay, surveys, heatmaps, or exception capture. The
  site collects the documented event list and nothing else.
- No consent banner. See the cookie note under Decisions.
- No deployment change; the Cloudflare Worker still serves prerendered assets.

## Implementation Notes

- `apps/website/src/analytics.tsx` owns the whole surface — the event union,
  the provider, and the capture hook. Nothing else in the site imports
  `posthog-js`.
- `resolveAnalyticsConfig(env)` sits in its own dependency-free module,
  `analytics-config.ts`, so "no key means inert" is asserted in
  `apps/website/tests/analytics.test.ts` without dragging React or `posthog-js`
  into the test. It is called once at module load — Vite inlines `VITE_*` at build
  time, so the result is a constant and the element tree never changes shape
  between renders.
- Initialization lives inside `PostHogProvider`'s effect, which only runs on the
  client. The server render and the prerender pass never construct a client or
  reach for `window`; the prerendered `index.html` contains no analytics script.
- `useAnalytics` returns a capture function typed to the event union and a
  closed property shape (`{ app_version: string }`), so there is no open
  property channel — the same restraint `telemetry.rs`'s fixed property set
  applies.
- `defaults: "2026-01-30"` is set explicitly: the legacy defaults inject
  PostHog's own scripts into `<body>`, which trips hydration on a prerendered
  document.
- Everything PostHog can switch on remotely (autocapture, heatmaps, exceptions,
  replay, surveys) is pinned off in the init options rather than left to a
  project toggle.

## Event Mapping

| Umami                      | PostHog                                      |
| -------------------------- | -------------------------------------------- |
| _(pageview)_               | `$pageview`                                  |
| `Open updates`             | `updates_opened`                             |
| `Open GitHub`              | `github_opened`                              |
| `Download macOS app`       | `download_started`                           |
| `data-umami-event-version` | `app_version` property on `download_started` |

## Decisions

- **Bundle cost.** `posthog-js` adds ~95 kB gzip to a page that shipped ~100 kB,
  where the Umami script was ~2 kB loaded from a separate origin. That is the
  price of the npm SDK; the alternatives are PostHog's CDN snippet (no React
  integration) or the undocumented `dist/module.slim.js` entrypoint (fragile
  across versions). Taking the documented entrypoint and paying the bytes.
- **Cookies.** Umami is cookieless; PostHog's default persistence uses a cookie
  and `localStorage`. Kept the default, because `cookieless_mode: "always"` is
  silently fatal unless the PostHog project is also configured for it — every
  event is dropped. Noted in `docs/website-analytics.md` as the switch to flip
  if the tradeoff is wanted.
- **Geolocation.** Left PostHog's IP-derived location on. The desktop app sets
  `$geoip_disable` because it is a local-first editor making a promise about the
  user's machine; a public marketing page reporting visitor countries is what
  Umami already did.

## Validation

- `vp check`
- `vp test`
- `vp run website#build`
- Build with `VITE_POSTHOG_KEY` set and confirm the key and host inline into the
  client bundle; build without it and confirm neither the bundle nor the
  prerendered HTML initializes anything.
