/// <reference types="vite/client" />

import type { ReactNode } from "react";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";

import { Analytics } from "../analytics";
import styles from "../styles.css?url";
import {
  APP_ID,
  AUTHOR_GITHUB_URL,
  AUTHOR_ID,
  AUTHOR_X_URL,
  DOWNLOAD_SIZE,
  PRODUCT_NAME,
  SHORT_NAME,
  SITE_URL,
  jsonLdScript,
} from "../site";

const TITLE = `${PRODUCT_NAME} — free, open-source markdown editor for macOS`;
const DESCRIPTION = `${PRODUCT_NAME} is a free, open-source markdown editor for macOS. About ${DOWNLOAD_SIZE}, starts faster than Apple Notes and Obsidian, and opens the folders you already have as plain markdown.`;
const OG_DESCRIPTION = `A free, open-source markdown editor for macOS. About ${DOWNLOAD_SIZE} and faster to start than Apple Notes and Obsidian.`;

// One graph so the app can point at its author by `@id`, and the docs pages at
// both. Facts here must match the visible page; see `src/site.ts`.
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      "@id": APP_ID,
      name: PRODUCT_NAME,
      alternateName: SHORT_NAME,
      description: DESCRIPTION,
      url: `${SITE_URL}/`,
      applicationCategory: "UtilitiesApplication",
      applicationSubCategory: "Markdown editor",
      operatingSystem: "macOS",
      softwareVersion: __WRITER_VERSION__,
      downloadUrl: `${__WRITER_REPO_URL__}/releases/latest`,
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      image: `${SITE_URL}/og.jpg`,
      sameAs: [__WRITER_REPO_URL__],
      author: { "@id": AUTHOR_ID },
    },
    {
      "@type": "Person",
      "@id": AUTHOR_ID,
      name: "Joel",
      url: AUTHOR_X_URL,
      sameAs: [AUTHOR_X_URL, AUTHOR_GITHUB_URL],
    },
  ],
};

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1.0" },
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:site_name", content: PRODUCT_NAME },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: OG_DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SITE_URL}/` },
      { property: "og:image", content: `${SITE_URL}/og.jpg` },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: `${SITE_URL}/og.jpg` },
    ],
    links: [
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "stylesheet", href: styles },
    ],
    scripts: [jsonLdScript(STRUCTURED_DATA)],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Analytics>
        <Outlet />
      </Analytics>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
