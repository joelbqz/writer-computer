# Website TanStack Start Refactor

## Problem

The marketing website is currently a plain Vite React single-page app. It has a hand-written `index.html`, a manual client root in `src/main.tsx`, and version/download constants injected through Vite defines.

## Goals

- Move `apps/website` to TanStack Start's Vite plugin, file-based routes, root document, and generated route tree.
- Preserve the existing homepage UI, assets, metadata, analytics script, and version/download URL behavior.
- Keep the current static Cloudflare assets deployment path working.
- Keep validation on the existing Vite+ workflow.

## Non-Goals

- No visual redesign.
- No new server APIs or dynamic data loaders.
- No deployment provider change.

## Implementation Notes

- Use TanStack Start static prerendering so the static Cloudflare Worker can continue serving built assets without an SSR worker entry.
- Move document metadata, favicon, analytics script, and CSS link ownership into `src/routes/__root.tsx`.
- Move the homepage component into `src/routes/index.tsx` and keep shared mark components unchanged.
- Add the required Start client, router, and server entries so both dev and production requests route through TanStack Start.
- Keep the Tauri version-derived release constants in `vite.config.ts` and expose them with Vite `define`.
- Run the website's Start dev/build/preview through the real Vite binary via `vp exec vite ...`. Start dev requires Vite's runnable SSR dev environment; the repo's Vite+ core alias can build/prerender but falls through to `Cannot GET /` in dev.
- Keep demo videos visible by default. Do not hide them behind a React `loadeddata` state gate because the static prerendered HTML can load media before hydration attaches event handlers.

## Validation

- `vp install`
- `vp run website#build`
- `vp check`
