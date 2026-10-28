import { createFileRoute } from "@tanstack/react-router";

import { COMPARE } from "../../compare/pages";
import { SectionIndex } from "../../components/ContentLayout";
import { sectionIndexHead } from "../../content-route";
import { PRODUCT_NAME } from "../../site";

const TITLE = `${PRODUCT_NAME} compared with Obsidian, Typora, iA Writer and Apple Notes`;
const DESCRIPTION = `How ${PRODUCT_NAME}, a free, open-source markdown editor for macOS, compares with Obsidian, Typora, iA Writer and Apple Notes, and who each one suits.`;

export const Route = createFileRoute("/compare/")({
  head: () => sectionIndexHead(COMPARE, TITLE, DESCRIPTION),
  component: CompareIndex,
});

function CompareIndex() {
  return (
    <SectionIndex section={COMPARE} title={`Compare ${PRODUCT_NAME}`}>
      <p>
        {PRODUCT_NAME} is a free, open-source markdown editor for macOS that edits the folders of
        markdown files you already have. Each page below sets it beside another app: what each does,
        what each costs, and who each one suits. Details about the other apps come from their own
        websites, with the date they were checked.
      </p>
    </SectionIndex>
  );
}
