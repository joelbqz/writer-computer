import { createFileRoute } from "@tanstack/react-router";

import { ContentLayout } from "../../components/ContentLayout";
import { DOCS } from "../../docs/pages";

export const Route = createFileRoute("/docs")({
  component: () => <ContentLayout section={DOCS} overview="Overview" />,
});
