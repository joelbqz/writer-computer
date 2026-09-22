import { describe, expect, test } from "vite-plus/test";
import { BUILD_RELEASE, LATEST_RELEASE_URL, parseLatestRelease } from "../src/latest-release";

const DMG =
  "https://github.com/joelbqz/writer-computer/releases/download/v0.7.2/Writer_0.7.2_aarch64.dmg";

/** The shape `GET /repos/{owner}/{repo}/releases/latest` answers with, trimmed to what matters. */
const payload = {
  tag_name: "v0.7.2",
  draft: false,
  prerelease: false,
  assets: [
    { name: "latest.json", browser_download_url: "https://example.invalid/latest.json" },
    {
      name: "Writer.app.tar.gz",
      browser_download_url: "https://example.invalid/Writer.app.tar.gz",
    },
    { name: "Writer_0.7.2_aarch64.dmg", browser_download_url: DMG },
  ],
};

describe("parseLatestRelease", () => {
  test("picks the version off the tag and the DMG out of the assets", () => {
    expect(parseLatestRelease(payload)).toEqual({ version: "0.7.2", dmgUrl: DMG });
  });

  test("asset order does not matter", () => {
    expect(parseLatestRelease({ ...payload, assets: [...payload.assets].reverse() })).toEqual({
      version: "0.7.2",
      dmgUrl: DMG,
    });
  });

  test("a release without a DMG is not something the button can point at", () => {
    expect(parseLatestRelease({ ...payload, assets: payload.assets.slice(0, 2) })).toBeNull();
    expect(parseLatestRelease({ ...payload, assets: [] })).toBeNull();
    // A DMG entry whose URL is missing is as good as no DMG.
    expect(
      parseLatestRelease({ ...payload, assets: [{ name: "Writer_0.7.2_aarch64.dmg" }] }),
    ).toBeNull();
  });

  test("a tag that is not v<semver> is rejected rather than shown", () => {
    expect(parseLatestRelease({ ...payload, tag_name: "0.7.2" })).toBeNull();
    expect(parseLatestRelease({ ...payload, tag_name: "v0.7" })).toBeNull();
    expect(parseLatestRelease({ ...payload, tag_name: "v0.7.2-rc1" })).toBeNull();
  });

  test("anything that is not a release object yields null", () => {
    expect(parseLatestRelease(null)).toBeNull();
    expect(parseLatestRelease("v0.7.2")).toBeNull();
    expect(parseLatestRelease({})).toBeNull();
    expect(parseLatestRelease({ tag_name: "v0.7.2" })).toBeNull();
    expect(parseLatestRelease({ tag_name: "v0.7.2", assets: [null, 1, "x"] })).toBeNull();
    // GitHub's error body for a spent rate limit.
    expect(
      parseLatestRelease({ message: "API rate limit exceeded", documentation_url: "" }),
    ).toBeNull();
  });
});

describe("build-time fallback", () => {
  test("is the version and DMG the build inlined, and the API URL names the release repo", () => {
    expect(BUILD_RELEASE.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(BUILD_RELEASE.dmgUrl).toBe(
      `https://github.com/joelbqz/writer-computer/releases/download/v${BUILD_RELEASE.version}/Writer_${BUILD_RELEASE.version}_aarch64.dmg`,
    );
    expect(LATEST_RELEASE_URL).toBe(
      "https://api.github.com/repos/joelbqz/writer-computer/releases/latest",
    );
  });
});
