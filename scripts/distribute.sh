#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
RELEASE_REPO="joelbqz/writer-computer"

NOTES_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --notes-file)
      NOTES_FILE="$2"
      shift 2
      ;;
    --notes-file=*)
      NOTES_FILE="${1#*=}"
      shift
      ;;
    *)
      echo "Error: unknown argument: $1"
      echo "Usage: $0 --notes-file <path>"
      exit 1
      ;;
  esac
done

if [ -z "$NOTES_FILE" ]; then
  echo "Error: --notes-file <path> is required"
  echo "Pass a markdown file with the user-facing release notes (drafted by the agent from CHANGELOG.md)."
  exit 1
fi
if [ ! -s "$NOTES_FILE" ]; then
  echo "Error: notes file is missing or empty: $NOTES_FILE"
  exit 1
fi

# Load environment variables
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env file not found at $ENV_FILE"
  echo ""
  echo "Create it with:"
  echo "  APPLE_SIGNING_IDENTITY=\"Developer ID Application: Your Name (TEAMID)\""
  echo "  APPLE_ID=\"your@apple.id\""
  echo "  APPLE_PASSWORD=\"xxxx-xxxx-xxxx-xxxx\"  # app-specific password"
  echo "  APPLE_TEAM_ID=\"XXXXXXXXXX\""
  echo "  TAURI_SIGNING_PRIVATE_KEY=\"/absolute/path/to/writer-updater-key\""
  echo "  TAURI_SIGNING_PRIVATE_KEY_PASSWORD=\"\"  # empty if keypair has no password"
  echo "  WRITER_POSTHOG_KEY=\"phc_...\"  # optional; omit to ship with telemetry disabled"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

for var in APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID TAURI_SIGNING_PRIVATE_KEY; do
  if [ -z "${!var:-}" ]; then
    echo "Error: $var is not set in .env"
    exit 1
  fi
done

# `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is optional but tauri-cli checks the env
# var is present — export an empty default so the build doesn't fail on macOS.
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

# Opt-in telemetry is compiled in only when a project key is present. Not fatal
# — a keyless release is a working release with telemetry permanently inert —
# but it is worth saying out loud, because the symptom is silence in PostHog
# long after the release has shipped. See docs/telemetry.md.
if [ -z "${WRITER_POSTHOG_KEY:-}" ]; then
  echo "Warning: WRITER_POSTHOG_KEY is not set — this build ships with telemetry disabled."
fi

# Read version from tauri.conf.json
TAURI_CONF="$ROOT_DIR/apps/desktop/src-tauri/tauri.conf.json"
VERSION=$(python3 -c "import json; print(json.load(open('$TAURI_CONF'))['version'])")
TAG="v$VERSION"

# Pre-flight: must be on master, clean, in sync with origin, and the tag must
# not already exist anywhere. These checks are cheap — fail before the long
# release build rather than after.
CURRENT_BRANCH=$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "master" ]; then
  echo "Error: releases must be cut from master, currently on '$CURRENT_BRANCH'"
  exit 1
fi

if ! git -C "$ROOT_DIR" diff-index --quiet HEAD --; then
  echo "Error: working tree has uncommitted changes — commit the version bump first"
  git -C "$ROOT_DIR" status --short
  exit 1
fi

echo "Fetching origin to verify sync..."
git -C "$ROOT_DIR" fetch origin master --tags

LOCAL_REV=$(git -C "$ROOT_DIR" rev-parse HEAD)
REMOTE_REV=$(git -C "$ROOT_DIR" rev-parse origin/master)
BASE_REV=$(git -C "$ROOT_DIR" merge-base HEAD origin/master)
if [ "$LOCAL_REV" != "$REMOTE_REV" ] && [ "$BASE_REV" != "$REMOTE_REV" ]; then
  echo "Error: local master is not a fast-forward of origin/master"
  echo "  local:  $LOCAL_REV"
  echo "  origin: $REMOTE_REV"
  echo "  Pull or rebase before releasing."
  exit 1
fi

if git -C "$ROOT_DIR" rev-parse --verify --quiet "refs/tags/$TAG" >/dev/null; then
  echo "Error: tag $TAG already exists locally — bump the version or delete the tag"
  exit 1
fi
if git -C "$ROOT_DIR" ls-remote --tags --exit-code origin "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "Error: tag $TAG already exists on origin — bump the version"
  exit 1
fi

# Push master so the commit the release points at is on origin before we build.
# Idempotent if local already matches origin.
echo "Pushing master to origin..."
git -C "$ROOT_DIR" push origin master

echo "Building Writer $TAG..."

# Build signed and notarized DMG + updater artifacts (.app.tar.gz + .sig).
cd "$ROOT_DIR/apps/desktop"
vp exec tauri build --bundles app,dmg

BUNDLE_DIR="$ROOT_DIR/apps/desktop/src-tauri/target/release/bundle"
DMG_DIR="$BUNDLE_DIR/dmg"
MACOS_DIR="$BUNDLE_DIR/macos"

DMG_FILE=$(ls "$DMG_DIR"/*.dmg 2>/dev/null | head -1 || true)
TAR_FILE=$(ls "$MACOS_DIR"/*.app.tar.gz 2>/dev/null | head -1 || true)
SIG_FILE=$(ls "$MACOS_DIR"/*.app.tar.gz.sig 2>/dev/null | head -1 || true)

if [ -z "$DMG_FILE" ]; then
  echo "Error: No DMG found in $DMG_DIR"
  exit 1
fi

if [ -z "$TAR_FILE" ] || [ -z "$SIG_FILE" ]; then
  echo "Error: Updater artifacts missing in $MACOS_DIR"
  echo "  Expected: *.app.tar.gz and *.app.tar.gz.sig"
  echo "  Check that \`createUpdaterArtifacts\` is true and TAURI_SIGNING_PRIVATE_KEY is valid."
  exit 1
fi

echo ""
echo "Built: $(basename "$DMG_FILE") ($(du -h "$DMG_FILE" | cut -f1))"
echo "Built: $(basename "$TAR_FILE") ($(du -h "$TAR_FILE" | cut -f1))"

# Determine target triple for latest.json (arm64 host → aarch64).
HOST_ARCH=$(uname -m)
case "$HOST_ARCH" in
  arm64|aarch64) TARGET="darwin-aarch64" ;;
  x86_64) TARGET="darwin-x86_64" ;;
  *) echo "Error: unsupported host architecture $HOST_ARCH"; exit 1 ;;
esac

SIGNATURE=$(cat "$SIG_FILE")
TAR_NAME=$(basename "$TAR_FILE")
PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
NOTES="Writer $TAG"
DOWNLOAD_URL="https://github.com/$RELEASE_REPO/releases/download/$TAG/$TAR_NAME"

LATEST_JSON="$BUNDLE_DIR/latest.json"
python3 - "$LATEST_JSON" "$VERSION" "$NOTES" "$PUB_DATE" "$TARGET" "$SIGNATURE" "$DOWNLOAD_URL" <<'PY'
import json, sys
out_path, version, notes, pub_date, target, signature, url = sys.argv[1:]
payload = {
    "version": version,
    "notes": notes,
    "pub_date": pub_date,
    "platforms": {
        target: {
            "signature": signature,
            "url": url,
        }
    },
}
with open(out_path, "w") as f:
    json.dump(payload, f, indent=2)
PY

echo "Built: latest.json ($TARGET)"

# Create a DRAFT GitHub Release with DMG, updater tarball, signed manifest,
# and the agent-drafted user-facing notes.
echo ""
echo "Creating draft release $TAG on $RELEASE_REPO..."

gh release create "$TAG" "$DMG_FILE" "$TAR_FILE" "$LATEST_JSON" \
  --repo "$RELEASE_REPO" \
  --title "Writer $TAG" \
  --notes-file "$NOTES_FILE" \
  --draft

DRAFT_URL=$(gh release view "$TAG" --repo "$RELEASE_REPO" --json url --jq '.url')

# Tag this repo so the release artifact is pinned to a specific commit. If you
# end up abandoning the draft, delete the tag manually.
echo ""
echo "Tagging $TAG locally and pushing to origin..."
git -C "$ROOT_DIR" tag "$TAG"
git -C "$ROOT_DIR" push origin "$TAG"

echo ""
echo "Draft created: $DRAFT_URL"
echo "Review the notes and click Publish to ship it."
