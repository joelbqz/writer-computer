import { createFileRoute } from "@tanstack/react-router";

import { COMPARE } from "../../compare/pages";
import { ContentArticle } from "../../components/ContentLayout";
import { loadPage, pageHead } from "../../content-route";

export const Route = createFileRoute("/compare/$slug")({
  loader: ({ params }) => loadPage(COMPARE, params.slug),
  head: ({ loaderData }) => (loaderData ? pageHead(COMPARE, loaderData.page, "Article") : {}),
  component: ComparePage,
});

function ComparePage() {
  const { html } = Route.useLoaderData();
  return <ContentArticle html={html} />;
}
