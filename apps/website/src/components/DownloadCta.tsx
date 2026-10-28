import { useAnalytics } from "../analytics";
import { useLatestRelease } from "../use-latest-release";
import { AppleGlyph } from "./Mark";

/**
 * The download button with its Beta pill and version. Prerenders the
 * build-time release and switches to the latest published one in the browser
 * (see `useLatestRelease`); the click reports the version it pointed at.
 */
export function DownloadCta() {
  const capture = useAnalytics();
  const release = useLatestRelease();

  return (
    <div className="cta">
      <a
        className="download"
        href={release.dmgUrl}
        onClick={() => capture("download_started", { app_version: release.version })}
      >
        <AppleGlyph size={20} />
        <span>Download for MacOS</span>
      </a>
      <span className="beta-pill">Beta</span>
      <span className="version">v{release.version}</span>
    </div>
  );
}
