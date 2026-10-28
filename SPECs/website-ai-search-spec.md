# Website: discoverable by AI search

## Problem

AI search engines (ChatGPT, Perplexity, Claude, Google AI Overviews) answer
"what is a good markdown editor for my Obsidian vault on a Mac" by quoting pages
they can read. writer.computer gives them almost nothing: the prerendered
homepage is ~6.6 KB with one `h1`, five feature labels and nine uncaptioned
videos. There is no definition of the product, no privacy statement, no FAQ, no structured data, no `llms.txt` or `sitemap.xml`,
and `robots.txt` is Cloudflare's managed stub with no `Sitemap` line.

The name is also ambiguous. "Writer" alone collides with writer.com (an
enterprise AI company), iA Writer (a direct competitor) and LibreOffice Writer.

## Decisions

- **Canonical name: "Writer Computer".** Used wherever the product is defined:
  `<title>`, JSON-LD `name`, meta description, the first mention on every page,
  the README's first line. "Writer" stays the short name in the app and in
  casual copy, and is the JSON-LD `alternateName`.
- **The new text lives on `/faq`, not the homepage.** Owner decision: the
  homepage's visible copy stays as it was (original headline, five feature
  lines, "Free and open source. Forever"; only the "cold starts takes" typo is
  fixed). `/faq` is a plain page for people, named FAQ and written in the
  site's style, holding the definition, the folders lines, the selling points,
  the FAQ and the version line. A small "FAQ" pill in the homepage nav links to
  it and it links back home. Its `FAQPage` JSON-LD is generated from the same
  array as its visible FAQ, so the two cannot drift, and lives only on `/faq`
  because structured data must match the page it is on.
- **Invisible improvements stay on the homepage:** title, meta and OG
  description, canonical link, `SoftwareApplication` + `Person` JSON-LD, and
  visually hidden captions on the demo videos.
- **Keep the tone.** On `/faq` the selling points are short lowercase
  fragments like the homepage features, and each FAQ answer is one or two
  short sentences, at the owner's request.
- **Platform and license wording.** At the owner's request the copy, JSON-LD,
  `llms.txt` and README say "macOS" and "free and open source" and nothing more
  specific: no chip or architecture requirement, no license name or link.
- **Selling points up front.** Three claims lead the `/faq` definition and
  selling points, the FAQ, the JSON-LD and meta descriptions, `llms.txt` and the
  README: a small
  download (about 6 MB, under 10 MB installed), faster startup than Apple Notes
  and Obsidian (the owner's claim; no benchmark numbers are published), and
  instant cold starts on very large workspaces.
- **Static discovery files** live in `apps/website/public/` and are copied to
  `dist/client/` by the build. They carry no version number, so they don't go
  stale between deploys.
- **Nothing important exists only after hydration.** The version shown is the
  build-time one in the prerendered HTML; the existing latest-release lookup may
  replace it in the browser, as it already does for the download button.

## Facts and where they were verified

- Free and open source: the repository is public on GitHub.
- `.gitignore` respected, hidden folders skipped: `commands/fs.rs`
  (`visible_fs_entry`), `commands/search.rs` (`git_ignore(true)`).
- Files written in place, unchanged except for your edits: `write_file_impl`
  (atomic temp-file + rename of the editor's content).
- Only extra file created: `<note>-assets/` for pasted images
  (`commands/images.rs`). `.writer/config` is only written through a
  workspace-scoped setting, which no UI calls today.
- Wikilinks with autocomplete and `![[image]]` embeds:
  `wiki-link-extension.ts`; note embeds stay plain links (`wiki-links.ts`). Callouts and footnotes are not rendered (TODOS.md,
  hand-typing QA pass).
- Markdown: GFM (tables, task lists, strikethrough), Mermaid (Pele, every
  Mermaid 12.1 type), KaTeX math (`$`, `$$`), HTML blocks, YAML frontmatter as
  properties, fenced code highlighting: `editor-extensions.ts`.
- Telemetry: `docs/telemetry.md`.
- Size (v0.8.0): DMG 6.1 MB, `Writer.app.tar.gz` 5.7 MB (GitHub release
  assets), installed `Writer.app` 9.2 MB. Held in `src/site.ts`.
- Cold starts independent of workspace size: `get_startup_state` →
  `build_restore_bundle` reads settings, the workspace's top-level directory,
  the session and the active note; `prepare_workspace_state` hands the watcher,
  the full gitignore load and the index walk to a background thread
  (`run_workspace_bootstrap`), so the window doesn't wait on them.
- "Faster than Apple Notes and Obsidian": the owner's claim, not measured here.

## Deliverables

1. Homepage: master's visible copy with the typo fixed, a "FAQ" nav pill, and
   hidden captions for the demo videos.
2. `/faq`: definition, "Works with the folders you already have", selling
   points, FAQ, version line; its own title, description, canonical and
   `FAQPage` JSON-LD built from the visible FAQ's data.
3. Head: title, description, og tags, canonical link on both pages;
   `SoftwareApplication` + `Person` JSON-LD in the root head.
4. `llms.txt` (full fact sheet, `/faq` listed first), `sitemap.xml` (both
   pages), `robots.txt` in `public/`.
5. README opens with the canonical definition.

## Out of scope

Comparison pages, GitHub repo settings, Cloudflare settings (managed
robots.txt, AI crawler blocking), deploying, renaming the app.
