# Website Analytics

The marketing website in `apps/website/` reports to PostHog. This document is
the complete list of what it sends and how it is configured. If it disagrees
with the code, the code is the bug — everything below is mirrored in
`apps/website/src/analytics.tsx`, the only file on the site that talks to an
analytics service, and `apps/website/src/analytics-config.ts`, which reads the
environment.

This is separate from the desktop app's telemetry, which has its own project key
and its own disclosure — see [telemetry.md](./telemetry.md).

## What is collected

Four events. That is the whole list.

| Event              | When                                                |
| ------------------ | --------------------------------------------------- |
| `$pageview`        | A page is viewed, including client-side navigations |
| `updates_opened`   | The **Updates** link in the header is clicked       |
| `github_opened`    | The **GitHub** link in the header is clicked        |
| `download_started` | The **Download for MacOS** button is clicked        |

`download_started` carries one property, `app_version` — the version the site
was built to advertise, taken from `tauri.conf.json`. No other event carries a
custom property, and `useAnalytics` is typed so that no other property can be
attached without changing this document in the same commit.

Autocapture, session replay, surveys, heatmaps, and exception capture are all
pinned off in the init options. Each of those can otherwise be switched on
remotely from PostHog project settings, which would quietly widen this list, so
the site does not leave them to a toggle.

Visitors are anonymous (`person_profiles: "identified_only"`); nothing on the
site identifies anyone.

PostHog's default persistence uses a cookie and `localStorage`, where the
previous Umami setup was cookieless. `cookieless_mode: "always"` is the switch
back, but it only works if the PostHog project is configured for cookieless
ingestion too — otherwise every event is silently dropped. Turn on the project
setting first.

## One project, shared with the app

The site and the desktop app report to the **same PostHog project**. Anything
scoped to one surface has to say so: filter on the event name (the app sends
`app_opened`, `workspace_opened`, `file_created`, `folder_created`,
`email_updated`, `prompt_declined`; the site sends the four above), or on a
property only one of them sets.

The two do **not** share a `distinct_id`. The desktop app mints a per-install
UUID and stores it in `telemetry.json`; the browser mints its own anonymous id.
A visitor and the install they went on to download are two different persons in
PostHog, and a site-to-app funnel will not stitch. Nothing here tries to make it
stitch — doing so would mean carrying a browser identifier into the installer
and back out of the app, which is exactly the kind of cross-surface tracking
[telemetry.md](./telemetry.md) promises the app does not do. Read the download
count and the install count as two separate numbers.

## Configuration

Four environment variables, all read at **build** time. Each pair is tried in
order, and a blank value counts as absent:

| Purpose | Order                                           | Default                    |
| ------- | ----------------------------------------------- | -------------------------- |
| Key     | `VITE_POSTHOG_KEY`, then `WRITER_POSTHOG_KEY`   | none — the site is inert   |
| Host    | `VITE_POSTHOG_HOST`, then `WRITER_POSTHOG_HOST` | `https://us.i.posthog.com` |

`WRITER_POSTHOG_KEY` is the desktop app's variable, and it already lives in the
repo-root `.env` — that is what makes one value configure both surfaces with no
drift. `VITE_POSTHOG_KEY` overrides it for the website alone, which is how you
point the site at a scratch project without touching the app.

The key is the PostHog **project** key (a `phc_...` value). It is publishable —
it ships in the client bundle by design and is not a secret. Do not put a
personal API key here.

### How `WRITER_POSTHOG_KEY` reaches the client

It has no `VITE_` prefix, so Vite does not expose it. `apps/website/vite.config.ts`
bridges it — and the host — by name through `define`, and nothing else.

That is deliberate and it must stay that way. The repo-root `.env` also holds
the Apple credentials and the Tauri updater signing key, and the client bundle
is public. Do not widen `envDir` to the repo root, do not call `loadEnv` with an
empty prefix, and do not forward `process.env` wholesale: any of those would put
signing secrets into a file served to every visitor. Adding one name to the
`define` block is the only way in.

## No key means inert

With neither `VITE_POSTHOG_KEY` nor `WRITER_POSTHOG_KEY` set,
`resolveAnalyticsConfig` returns null, `PostHogProvider` is never rendered,
`posthog.init` is never called, and `useAnalytics` returns a no-op. No network
request is made and nothing is logged. This is the same rule the desktop app
applies to a build with no `WRITER_POSTHOG_KEY`: inert by construction rather
than merely switched off.

That is what makes a plain `vp run website#build`, `vp run website#dev`, and
anyone's clone of this repo silent without any further setup.

## Building with the key

The website build does **not** load the repo-root `.env` by itself. Source it
first, from the repository root:

```sh
set -a; source .env; set +a
vp run website#build
```

Or pass the value inline for a one-off:

```sh
WRITER_POSTHOG_KEY=phc_your_project_key vp run website#build
```

`vp run website#build` is not cached, so a later build without the variable
produces an inert bundle rather than replaying the keyed one.

To point the website somewhere else without touching the app, copy
`apps/website/.env.example` to `apps/website/.env` — Vite loads that one
automatically — and set `VITE_POSTHOG_KEY`. Leave it absent to fall back to the
shared key, or leave both unset to keep local builds inert.

## Deploying

Neither `.env` is part of the deploy; both are gitignored. The key has to be in
the environment that runs the **build**, before `wrangler deploy` uploads the
result:

```sh
set -a; source .env; set +a
vp run website#build
vp dlx wrangler deploy --config wrangler.jsonc
```

Setting it as a Cloudflare Worker variable or secret does nothing: the Worker
only serves static assets, and the key is baked into the client bundle at build
time. See [website-deploy.md](./website-deploy.md).

## Adding an event

Three things change in the same commit: the `AnalyticsEvent` union in
`apps/website/src/analytics.tsx`, the call site, and the table in this file. If
a change would make those disagree, it needs a different design.
