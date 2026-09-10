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

## Configuration

Two environment variables, both read at **build** time and inlined by Vite:

| Variable            | Required | Default                    |
| ------------------- | -------- | -------------------------- |
| `VITE_POSTHOG_KEY`  | yes      | —                          |
| `VITE_POSTHOG_HOST` | no       | `https://us.i.posthog.com` |

`VITE_POSTHOG_KEY` is the PostHog **project** key (a `phc_...` value). It is
publishable — it ships in the client bundle by design and is not a secret. Do
not put a personal API key here.

## No key means inert

With `VITE_POSTHOG_KEY` unset or blank, `resolveAnalyticsConfig` returns null,
`PostHogProvider` is never rendered, `posthog.init` is never called, and
`useAnalytics` returns a no-op. No network request is made and nothing is
logged. This is the same rule the desktop app applies to a build with no
`WRITER_POSTHOG_KEY`: inert by construction rather than merely switched off.

That is what makes a plain `vp run website#build`, `vp run website#dev`, and
anyone's clone of this repo silent without any further setup.

## Local development

Copy `apps/website/.env.example` to `apps/website/.env` and fill in a key from
your own PostHog project:

```sh
cp apps/website/.env.example apps/website/.env
```

Leave the file absent to keep local builds inert.

## Deploying

`.env` is gitignored and is not part of the deploy. The key has to be present in
the environment that runs the build, before `wrangler deploy` uploads the
result:

```sh
VITE_POSTHOG_KEY=phc_your_project_key vp run website#build
vp dlx wrangler deploy --config wrangler.jsonc
```

Setting it as a Cloudflare Worker variable or secret does nothing: the Worker
only serves static assets, and the key is baked into the client bundle at build
time. See [website-deploy.md](./website-deploy.md).

## Adding an event

Three things change in the same commit: the `AnalyticsEvent` union in
`apps/website/src/analytics.tsx`, the call site, and the table in this file. If
a change would make those disagree, it needs a different design.
