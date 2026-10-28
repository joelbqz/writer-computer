import { COMPARE } from "./compare/pages";
import type { ContentSection } from "./content";
import { DOCS } from "./docs/pages";

/** Every markdown section, in the order the sitemap lists them. */
export const SECTIONS: readonly ContentSection[] = [DOCS, COMPARE];
