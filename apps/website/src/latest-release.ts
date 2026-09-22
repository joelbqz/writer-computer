/**
 * Where the download button points and which version the page advertises.
 *
 * The build inlines the version from `tauri.conf.json` and derives the DMG URL
 * from it (see `vite.config.ts`). That is only right on the day the site is
 * deployed: the site is redeployed by hand and the app is released far more
 * often, so the prerendered page drifts behind whatever is actually published.
 * `fetchLatestRelease` asks GitHub for the latest published release at page
 * load so the visitor always gets the current one; the build-time pair below is
 * what the prerendered document shows and what the page keeps if GitHub cannot
 * be reached (offline, or the unauthenticated per-IP rate limit is spent).
 *
 * GitHub's REST API is the one source that answers a browser: the
 * `releases/latest/download/...` redirect the in-app updater follows carries no
 * CORS headers, so the page cannot read `latest.json` the way the app does.
 * `releases/latest` already excludes drafts and prereleases, which is what
 * "published" means here.
 */

export type Release = {
  /** Bare semver, without the tag's leading `v`. */
  version: string;
  dmgUrl: string;
};

/** What the build baked in; shown until (and unless) GitHub answers. */
export const BUILD_RELEASE: Release = {
  version: __WRITER_VERSION__,
  dmgUrl: __WRITER_DMG_URL__,
};

export const LATEST_RELEASE_URL = `https://api.github.com/repos/${__WRITER_RELEASE_REPO__}/releases/latest`;

const TAG = /^v(\d+\.\d+\.\d+)$/;
const DMG_SUFFIX = "_aarch64.dmg";

/**
 * Read a `releases/latest` payload down to the two fields the page needs.
 * Null when the shape is not what a Writer release looks like — a renamed
 * asset, a tag that is not `v<semver>` — so the caller keeps the build-time
 * pair rather than rendering a broken link.
 */
export function parseLatestRelease(payload: unknown): Release | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { tag_name, assets } = payload as { tag_name?: unknown; assets?: unknown };
  if (typeof tag_name !== "string" || !Array.isArray(assets)) return null;

  const version = TAG.exec(tag_name)?.[1];
  if (!version) return null;

  for (const asset of assets as unknown[]) {
    if (typeof asset !== "object" || asset === null) continue;
    const { name, browser_download_url } = asset as {
      name?: unknown;
      browser_download_url?: unknown;
    };
    if (typeof name !== "string" || !name.endsWith(DMG_SUFFIX)) continue;
    if (typeof browser_download_url !== "string" || browser_download_url === "") continue;
    return { version, dmgUrl: browser_download_url };
  }
  return null;
}

/**
 * The latest published release, or null when GitHub did not give one: a
 * non-2xx response (a spent rate limit answers 403) or a payload that does not
 * parse. Network failures and aborts reject as `fetch` does.
 */
export async function fetchLatestRelease(signal?: AbortSignal): Promise<Release | null> {
  const response = await fetch(LATEST_RELEASE_URL, {
    headers: { Accept: "application/vnd.github+json" },
    signal,
  });
  if (!response.ok) return null;
  return parseLatestRelease(await response.json());
}
