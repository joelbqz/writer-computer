/// <reference types="vite/client" />

declare const __WRITER_VERSION__: string;
declare const __WRITER_DMG_URL__: string;
declare const __WRITER_RELEASES_URL__: string;
declare const __WRITER_REPO_URL__: string;

/**
 * The desktop app's analytics variables, bridged by name in `vite.config.ts`
 * because they carry no `VITE_` prefix. `""` when unset.
 */
declare const __WRITER_POSTHOG_KEY__: string;
declare const __WRITER_POSTHOG_HOST__: string;

/**
 * The website's own analytics overrides, read at build time. Both are optional:
 * without either these or the `WRITER_*` pair above, the site sends nothing.
 * See `docs/website-analytics.md`.
 */
interface ImportMetaEnv {
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
}

declare module "*.css";
declare module "*.css?url" {
  const href: string;
  export default href;
}
