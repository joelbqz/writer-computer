import { createFileRoute } from "@tanstack/react-router";

import { ContentLayout } from "../../components/ContentLayout";

export const Route = createFileRoute("/docs")({
  component: ContentLayout,
});
