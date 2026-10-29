import { createFileRoute } from "@tanstack/react-router";

import { SectionIndex } from "../../components/ContentLayout";
import { sectionIndexHead } from "../../content-route";
import { DOCS } from "../../docs/pages";
import { DOWNLOAD_SIZE, PRODUCT_NAME } from "../../site";

const TITLE = `Docs — ${PRODUCT_NAME}`;
const DESCRIPTION = `How to use ${PRODUCT_NAME}, the free, open-source markdown editor for macOS: opening folders and Obsidian vaults, tables, tasks and code, Mermaid diagrams, LaTeX math, themes, the sidebar and keyboard shortcuts.`;

export const Route = createFileRoute("/docs/")({
  head: () => sectionIndexHead(DOCS, TITLE, DESCRIPTION),
  component: DocsIndex,
});

function DocsIndex() {
  return (
    <SectionIndex section={DOCS} title="Overview">
      <p>
        {PRODUCT_NAME} is a free, open-source markdown editor for macOS that opens the folders you
        already have. It's built with Tauri rather than Electron, so the download is about{" "}
        {DOWNLOAD_SIZE}, and it keeps itself up to date: it checks for a new version when it starts
        and once a day, and installs it when you say so. These pages cover what it reads, how it
        treats your files and how to use it.
      </p>
    </SectionIndex>
  );
}
