import { createFileRoute } from "@tanstack/react-router";

import { COMPARE } from "../../compare/pages";
import { ContentLayout } from "../../components/ContentLayout";

export const Route = createFileRoute("/compare")({
  component: () => <ContentLayout section={COMPARE} overview="All comparisons" />,
});
