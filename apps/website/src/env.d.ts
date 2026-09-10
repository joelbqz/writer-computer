/// <reference types="vite/client" />

declare const __WRITER_VERSION__: string;
declare const __WRITER_DMG_URL__: string;
declare const __WRITER_RELEASES_URL__: string;
declare const __WRITER_REPO_URL__: string;

/**
 * Analytics configuration, read at build time. Both are optional: with no key
 * the site sends nothing. See `docs/website-analytics.md`.
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
