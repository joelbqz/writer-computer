# macOS Quick Look Extension

GitHub issue: [#80 — Feature request: add Quick Look support](https://github.com/joelbqz/writer-computer/issues/80)

Pressing Space on a `.md` / `.markdown` file in Finder should show a rendered
markdown preview instead of the system plain-text preview. Reference
implementation: [FluxMarkdown](https://github.com/xykong/flux-markdown), a
dedicated Swift app whose Quick Look app extension renders markdown through a
web renderer.

## Approach

Ship a native Quick Look **preview app extension** (`WriterQuickLook.appex`)
embedded in `Writer.app/Contents/PlugIns/`. macOS discovers extensions inside
installed apps automatically once the host app has been launched (or the
bundle is registered with LaunchServices) — no separate install step.

The extension uses the **data-based preview API** (macOS 12+):
`QLPreviewProvider` returns a `QLPreviewReply` of type `.html`, and Quick Look
renders that HTML in its own sandboxed, script-disabled web view. No view
controller, no WKWebView of our own.

### Markdown rendering

Writer's editor renders markdown in place via CodeMirror — there is no
markdown→HTML pipeline in the app to reuse. The extension renders with
[`marked`](https://github.com/markedjs/marked) (GFM tables, task lists,
autolinks) evaluated through the system **JavaScriptCore** framework:

- `marked.min.js` is copied from `node_modules` at build time (declared as a
  devDependency of `apps/desktop`) — no vendored blob in the repo, no network
  at appex build time beyond the normal `vp install`.
- JavaScriptCore runs interpreter-only inside the sandbox (no JIT
  entitlement); a one-document parse is well within budget.
- YAML frontmatter is stripped before rendering.
- Input is capped (2 MB) with a truncation notice so a giant file can't stall
  Quick Look.

A hand-written `preview.css` approximates Writer's editor typography and
supports light/dark via `prefers-color-scheme`.

### Bundle integration

- `apps/desktop/src-tauri/quicklook/` holds the extension: Swift sources,
  `Info.plist` template, `entitlements.plist`, `preview.css`, `build.sh`.
- `build.sh` (macOS-only, no-op elsewhere) compiles the Swift sources with
  `swiftc -application-extension` linking `_NSExtensionMain`, assembles the
  `.appex` under `src-tauri/target/quicklook/`, stamps the app version from
  `tauri.conf.json`, copies `marked.min.js` + `preview.css` into Resources,
  and codesigns it.
- `tauri.conf.json` gains `build.beforeBundleCommand` (runs `build.sh`) and
  `bundle.macOS.files` mapping `PlugIns/WriterQuickLook.appex` to the build
  output. tauri-bundler copies custom files **before** signing the outer app,
  so the sealed bundle includes the appex.

### Signing

tauri-bundler's nested-code signing walk only matches `.app`/`.xpc`/dylibs —
it does **not** sign `.appex` bundles. `build.sh` therefore signs the appex
itself:

- Dev builds: ad-hoc (`-`).
- Release builds: `APPLE_SIGNING_IDENTITY` (already exported by
  `scripts/distribute.sh`), with hardened runtime — required for
  notarization.

App extensions must be sandboxed: `entitlements.plist` sets
`com.apple.security.app-sandbox`. Quick Look grants the extension read access
to the previewed file only.

### Content-type matching

The appex declares `QLSupportedContentTypes = [net.daringfireball.markdown]`.
The host `Info.plist` gains a `UTImportedTypeDeclarations` entry for
`net.daringfireball.markdown` (conforming to `public.plain-text`, extensions
`md`, `markdown`) so `.md` files resolve to that UTI even when no other app
declares it.

## Out of scope (v1)

- Images: relative-path images can't be read (sandbox only exposes the
  previewed file) and remote images aren't loaded by the Quick Look web view.
  `<img>` tags keep their alt text; no attachment plumbing.
- Mermaid / KaTeX / syntax highlighting — code blocks render as plain
  monospaced blocks. Requires bundling more JS; revisit on demand.
- A Quick Look **thumbnail** extension (Finder icon previews).
- Windows/Linux: the appex build script exits 0 off-macOS; nothing else
  changes.

## Verification

- `build.sh` output passes `codesign --verify --deep` and `plutil -lint`.
- A swiftc test harness compiles the renderer sources (QL-free) and asserts
  HTML output for headings, tables, task lists, frontmatter stripping.
- Full `tauri build --debug --bundles app`, then `pluginkit -a` on the
  embedded appex and a `qlmanage -p` smoke test on a sample document.
