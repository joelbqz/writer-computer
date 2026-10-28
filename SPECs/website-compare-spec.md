# Website Comparison Pages Spec

## Summary

Add comparison pages to writer.computer's docs, at `/docs/compare/`: one "Writer Computer vs X" page each for Obsidian, Typora, iA Writer and Apple Notes, plus an index. People who already know one of these apps search for "X vs …" and "X alternative", and AI assistants answer those questions by citing comparison pages, so these pages give both something accurate to find. Builds on [`website-docs-spec.md`](./website-docs-spec.md).

## Decisions

- **Owner's choice of format and competitors:** "Writer Computer vs X" pages (not "X alternative" pages) for Obsidian, Typora, iA Writer and Apple Notes, at `/docs/compare/writer-computer-vs-<x>/`.
- **Every competitor fact comes from the competitor's own site**, docs, download or App Store listing, checked on 2026-10-28, and each page lists its sources and that date under the table. Where an official page doesn't mention something, the table says "Not in X's docs" instead of claiming X lacks it. Where two official sources disagree (iA Writer's iPhone/iPad price on its pricing page vs the App Store), the number is left out. Download sizes were measured from the official download or taken from the App Store listing.
- **Writer Computer's limits are in the table too:** no sync, no export, no mobile apps, no plugins, search by file name only. Each page has a "Choose X if" section before "Choose Writer Computer if".
- **No speed claims.** The homepage's "starts faster than Apple Notes and Obsidian" is the owner's claim and was never measured; the comparison pages don't repeat it, and compare only what was measured (download size).
- **One source per fact.** `apps/website/src/compare/pages.ts` holds the table rows with Writer Computer's column written once, and each competitor's values, date and sources. Each page's markdown has a `{{comparison}}` line that `docs-plugin.ts` replaces with the table, so the prose and the data stay separate and the build fails if either is missing.
- **Shared section machinery.** Docs and comparisons are both `ContentSection`s (`src/content.ts`, listed in `src/sections.ts`): one renderer, one layout (`components/ContentLayout.tsx`), one head builder (`src/content-route.ts`), and the sitemap and `llms.txt` lists built from the same lists. Comparison pages use `Article` JSON-LD; docs keep `TechArticle`.
- **Part of the docs** (owner's call, after first shipping them as a separate `/compare/` section): `COMPARE` is nested in `DOCS` (`parent`), served under `/docs/compare/`, listed in the docs sidebar under a "Compare" heading, with Docs › Compare › page breadcrumbs. Nothing had been deployed at `/compare/`, so there are no redirects.
- **Linked from every docs and comparison page** through the shared footer ("Compared with Obsidian, Typora, iA Writer and Apple Notes"), not from the homepage header.

## Out of scope

- "X alternative" pages and X-vs-Y pages between two other apps.
- Customer quotes or switching stories; there are none to cite yet.
- Pricing outside USD.

## Upkeep

Prices, sizes and features change. Re-check a competitor's column against its sources before editing its page, and at least each quarter; update `checked` when you do.

## Validation

- `vp check`; `vp test` (`apps/website/tests/docs.test.ts` renders every page of every section and checks each comparison table names the competitor, the date and every source).
- The build prerenders `/docs/compare/` and the four pages, each with its own title, description, canonical and JSON-LD, and lists them in `sitemap.xml` and `llms.txt`.
- Every source URL answers 200.
- Screenshots at 1440 px and 390 px; no horizontal page scroll at 390 px (the table scrolls inside its column).
