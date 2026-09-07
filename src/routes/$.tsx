import { createFileRoute, redirect } from "@tanstack/react-router";
import { resolveUrlPath } from "@/lib/route-resolver";
import { FallbackRecoveryPage } from "@/components/site/FallbackRecoveryPage";

export const Route = createFileRoute("/$")({
  beforeLoad: ({ location, search }) => {
    const resolved = resolveUrlPath(location.pathname, search as Record<string, unknown>);
    if (resolved) {
      if (resolved.params && resolved.to === "/product/$id") {
        throw redirect({
          to: "/product/$id",
          params: resolved.params as { id: string },
          search: resolved.search as any,
          replace: true,
        });
      }
      throw redirect({
        to: resolved.to as any,
        search: resolved.search as any,
        replace: true,
      });
    }
  },
  head: () => ({
    meta: [
      { title: "Explore Catalog — Zérah Baby & Kids" },
      { name: "robots", content: "noindex, follow" },
    ],
  }),
  component: FallbackRecoveryPage,
});
