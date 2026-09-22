import { useEffect, useState } from "react";

import { BUILD_RELEASE, type Release, fetchLatestRelease } from "./latest-release";

/**
 * The release the download button should point at. Starts as the build-time
 * pair, which is also what the prerendered document shows, then switches to
 * GitHub's latest published release once the page has asked for it. Stays on
 * the build-time pair if GitHub does not answer; that is reported to the
 * console rather than the visitor, who still has a working (if older) link.
 */
export function useLatestRelease(): Release {
  const [release, setRelease] = useState(BUILD_RELEASE);

  useEffect(() => {
    const controller = new AbortController();
    fetchLatestRelease(controller.signal).then(
      (latest) => {
        if (latest) setRelease(latest);
        else
          console.warn("Latest release lookup gave nothing usable; showing the built-in version.");
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn("Latest release lookup failed; showing the built-in version.", error);
      },
    );
    return () => controller.abort();
  }, []);

  return release;
}
