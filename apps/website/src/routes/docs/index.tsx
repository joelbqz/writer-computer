import { createFileRoute } from "@tanstack/react-router";

import { SectionIndex } from "../../components/ContentLayout";
import { sectionIndexHead } from "../../content-route";
import { DOCS } from "../../docs/pages";
import { PRODUCT_NAME } from "../../site";

const TITLE = `Docs — ${PRODUCT_NAME}`;
const DESCRIPTION = `How to use ${PRODUCT_NAME}, the free, open-source markdown editor for macOS: opening folders and Obsidian vaults, Mermaid diagrams, LaTeX math and keyboard shortcuts.`;

export const Route = createFileRoute("/docs/")({
  head: () => sectionIndexHead(DOCS, TITLE, DESCRIPTION),
  component: DocsIndex,
});

function DocsIndex() {
  return (
    <SectionIndex section={DOCS} title="Overview">
      <p>
        {PRODUCT_NAME} is a free, open-source markdown editor for macOS that opens the folders you
        already have. These pages cover what it reads, how it treats your files and how to use it.
      </p>
    </SectionIndex>
  );
}
