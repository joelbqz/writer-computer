import { createFileRoute } from "@tanstack/react-router";

import { ContentArticle } from "../../components/ContentLayout";
import { loadPage, pageHead } from "../../content-route";
import { DOCS } from "../../docs/pages";

export const Route = createFileRoute("/docs/$slug")({
  loader: ({ params }) => loadPage(DOCS, params.slug),
  head: ({ loaderData }) => (loaderData ? pageHead(DOCS, loaderData.page, "TechArticle") : {}),
  component: DocPage,
});

function DocPage() {
  const { html } = Route.useLoaderData();
  return <ContentArticle html={html} />;
}
