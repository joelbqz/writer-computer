#!/usr/bin/env bash
# Builds WriterQuickLook.appex — the macOS Quick Look markdown preview
# extension embedded into Writer.app via `bundle.macOS.files`.
#
# Runs as tauri's beforeBundleCommand (cwd: apps/desktop). Safe to run
# standalone from anywhere. No-op on non-macOS hosts.
#
# Signing: tauri-bundler does not sign .appex bundles in its nested-code walk,
# so the appex is signed here — with APPLE_SIGNING_IDENTITY (exported by
# scripts/distribute.sh) and hardened runtime for releases, ad-hoc otherwise.
set -euo pipefail

if [ "$(uname)" != "Darwin" ]; then
  echo "quicklook: skipping appex build (not macOS)"
  exit 0
fi

QL_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_TAURI="$(dirname "$QL_DIR")"
APP_DIR="$(dirname "$SRC_TAURI")"

VERSION=$(python3 -c "import json; print(json.load(open('$SRC_TAURI/tauri.conf.json'))['version'])")

MARKED_JS="$APP_DIR/node_modules/marked/lib/marked.umd.js"
if [ ! -f "$MARKED_JS" ]; then
  echo "quicklook: error: $MARKED_JS not found — run 'vp install' first" >&2
  exit 1
fi

OUT_DIR="$SRC_TAURI/target/quicklook"
APPEX="$OUT_DIR/WriterQuickLook.appex"
rm -rf "$APPEX"
mkdir -p "$APPEX/Contents/MacOS" "$APPEX/Contents/Resources"

echo "quicklook: compiling WriterQuickLook.appex (v$VERSION)"
swiftc -O \
  -parse-as-library \
  -application-extension \
  -target arm64-apple-macos12.0 \
  -module-name WriterQuickLook \
  -framework QuickLookUI \
  -framework JavaScriptCore \
  -Xlinker -e -Xlinker _NSExtensionMain \
  -o "$APPEX/Contents/MacOS/WriterQuickLook" \
  "$QL_DIR/MarkdownRenderer.swift" \
  "$QL_DIR/PreviewProvider.swift"

sed "s/__VERSION__/$VERSION/g" "$QL_DIR/Info.plist" > "$APPEX/Contents/Info.plist"
plutil -lint "$APPEX/Contents/Info.plist" > /dev/null

cp "$MARKED_JS" "$APPEX/Contents/Resources/marked.js"
cp "$QL_DIR/preview.css" "$APPEX/Contents/Resources/preview.css"

IDENTITY="${APPLE_SIGNING_IDENTITY:--}"
SIGN_ARGS=(--force --sign "$IDENTITY" --entitlements "$QL_DIR/entitlements.plist")
if [ "$IDENTITY" != "-" ]; then
  SIGN_ARGS+=(--options runtime --timestamp)
fi
codesign "${SIGN_ARGS[@]}" "$APPEX"
codesign --verify --deep --strict "$APPEX"

echo "quicklook: built $APPEX"
