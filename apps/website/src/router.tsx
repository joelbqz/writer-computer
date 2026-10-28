import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    // Prerendered pages are `<path>/index.html`, which Cloudflare serves at
    // `<path>/` and redirects to from `<path>`. Links carry the slash so
    // crawlers land on the canonical URL without the redirect.
    trailingSlash: "always",
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
