import { createFileRoute } from "@tanstack/react-router";

import { ContentLayout } from "../../components/ContentLayout";

export const Route = createFileRoute("/docs")({
  head: () => ({
    // The glyph band above every docs title is set in it; preloading avoids
    // the fallback font showing first.
    links: [
      {
        rel: "preload",
        href: "/fonts/DepartureMono-Regular.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
    ],
  }),
  component: ContentLayout,
});
