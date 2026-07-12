# Releasing Writer

How to cut a signed, notarized macOS release and publish it so the in-app updater picks it up. This is the process for an agent (or human) running locally on the maintainer's machine — releases are not built in CI.

## Pre-flight Checks

Before bumping anything:

- `vp check` and `vp test` pass.
- The `CHANGELOG.md` entry for this release already exists. If it doesn't, write it first as a separate commit — release commits should only touch version fields.

`scripts/distribute.sh` enforces the rest itself: it refuses to run unless you're on `master` with a clean working tree, fast-forward of `origin/master`, and the target tag doesn't already exist locally or on origin.

## Step 1 — Bump the version

The authoritative version lives in `apps/desktop/src-tauri/tauri.conf.json`. `scripts/distribute.sh` reads it from there to derive the tag (`v<version>`) and DMG filename. Three other files must be kept in sync so the crate, npm package, and Tauri config all agree:

1. `apps/desktop/src-tauri/tauri.conf.json` — `version` field
2. `apps/desktop/src-tauri/Cargo.toml` — `[package].version`
3. `apps/desktop/package.json` — `version` field
4. `apps/desktop/src-tauri/Cargo.lock` — refresh with `cargo update -p desktop --offline` from `apps/desktop/src-tauri/`

Use a patch bump for fixes and small improvements, a minor bump for new user-visible features. Major bumps are reserved for breaking changes or 1.0.

Commit with a message like `Bump version to <version>`. Do not bundle other changes into the bump commit — it should be reviewable in isolation. **Do not push or tag manually** — the script does both.

## Step 2 — Draft user-facing release notes

The detailed bullets in `CHANGELOG.md` are written for engineers — too long and too jargon-heavy for the GitHub release page. The agent drafts a short, user-facing version from the latest dated section of `CHANGELOG.md` and writes it to a markdown file (any path; a temp file is fine).

Guidelines for the drafted notes:

- 3–8 bullets, one short line each. Lead with the user-visible behavior, not the implementation.
- Group as you see fit — typically a short intro paragraph (optional) plus bullets, no headings needed.
- No code spans for internal symbols (`view.setState`, `--surface-card`, etc.) and no spec/PR references.
- Keep wording in the same voice as the existing CHANGELOG (active, terse, sentence case).

The draft is not the final word — you'll review and can edit it directly on GitHub before publishing.

## Step 3 — Run distribute.sh

Run from the repo root, passing the notes file:

```sh
./scripts/distribute.sh --notes-file /tmp/release-notes.md
```

The script will, in order:

1. Validate `.env`, signing credentials, and the notes file (must exist and be non-empty).
2. Run pre-flight git checks (on master, clean tree, fast-forward of origin, tag doesn't already exist).
3. Push `master` to origin so the commit the release will point at is published before the build starts.
4. Build the desktop crate in release mode (`vp exec tauri build --bundles app,dmg`).
5. Sign `Writer.app` and the DMG with the Developer ID identity from `.env`.
6. Submit the app to Apple notarization and wait for the result. This is the slowest step and the most likely to fail — if Apple returns anything other than `Accepted`, stop and report the notarization log to the user.
7. Staple the notarization ticket to the app.
8. Bundle `Writer.app.tar.gz` and produce `Writer.app.tar.gz.sig` using the Tauri updater key.
9. Write `latest.json` with the new version, signature, and download URL pointing at `joelbqz/writer-computer`.
10. Create a **draft** release on `joelbqz/writer-computer` via `gh release create --draft`, uploading the DMG, the updater tarball, and `latest.json`, with the drafted notes attached.
11. Tag this repo with `v<version>` and push the tag to origin.
12. Print the draft URL.

Expect the whole script to take several minutes — most of it is the cargo release build and Apple notarization.

Note on the Quick Look extension: `tauri build` runs `src-tauri/quicklook/build.sh` (as `beforeBundleCommand`) which compiles and signs `WriterQuickLook.appex` before it is embedded at `Writer.app/Contents/PlugIns/`. The script signs the appex with `APPLE_SIGNING_IDENTITY` (hardened runtime + sandbox entitlements) when that env var is set — which `distribute.sh` guarantees — because tauri-bundler's nested-code signing does not cover `.appex` bundles. An ad-hoc-signed appex inside a release build will fail notarization; if notarization reports an unsigned or ad-hoc binary at `Contents/PlugIns/WriterQuickLook.appex`, check that the env var was exported when the appex was built.

## Step 4 — Review and publish on GitHub

Open the draft URL printed by `distribute.sh`. Confirm:

- Three assets are attached: `Writer_<version>_aarch64.dmg`, `Writer.app.tar.gz`, `latest.json`.
- The notes read well; edit them inline if needed.

Click **Publish release**. Until you do, the in-app updater won't see the new version (the `latest` endpoint skips drafts). If you abandon the draft instead, delete the local and remote tag manually (`git tag -d v<version> && git push origin :refs/tags/v<version>`).

## Step 5 — Verify

- Confirm `https://github.com/joelbqz/writer-computer/releases/latest/download/latest.json` resolves to the new version. The in-app updater hits this URL on launch (see `apps/desktop/src-tauri/tauri.conf.json`).
- Existing installs will pick up the update on next launch.

## When things go wrong

- **Pre-flight check fails.** The script aborted before doing anything irreversible. Read the error, fix the underlying state (commit, pull, bump version, etc.), and re-run.
- **Notarization fails.** Apple's response includes a submission ID. Ask the user how to proceed — do not retry blindly. Common causes: an entitlement mismatch, an unsigned binary inside the bundle, or an expired signing identity.
- **`gh release create` fails because the tag already exists in `writer-computer`.** A previous attempt got far enough to publish. Do not delete the existing release without explicit user permission — it may already be live to users via the updater. Ask first.
- **Build fails after the version bump is committed.** Fix the build, commit the fix, and re-run `distribute.sh`. Do not amend or revert the bump commit unless the user asks for it.
- **The script succeeded but the local tag push failed.** The draft is created; you just need to push the tag. Run `git push origin v<version>` manually. Don't re-run the whole script.
- **You decide not to publish the draft.** Delete the draft on GitHub, then drop the tag: `git tag -d v<version> && git push origin :refs/tags/v<version>`.
- **You realize mid-release that the version was wrong.** Stop. Revert is risky once the GH release exists. Ask the user before taking any destructive action.

## What this doc deliberately does not cover

- Cross-platform releases (Windows, Linux, x86_64 macOS). The script and config are arm64-only today.
- CI-driven releases. There is no GitHub Actions workflow for this — everything runs on the maintainer's machine because of the Apple signing requirement.
- Rolling back a published release. There is no documented rollback procedure; if you need one, escalate to the user.
