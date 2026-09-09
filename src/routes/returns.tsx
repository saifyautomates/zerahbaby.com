import { createFileRoute } from "@tanstack/react-router";
import { EditablePolicyPage } from "@/components/admin/EditablePolicyPage";
import { DEFAULT_RETURNS_POLICY } from "@/lib/pages-content";

export const Route = createFileRoute("/returns")({
  head: () => ({
    meta: [
      { title: "Refund & Return Policy — Zérah Baby & Kids" },
      {
        name: "description",
        content:
          "Hassle-free returns accepted within 7 days of delivery for unworn, unwashed baby clothing and toys in original packaging. Inspection-based refunds processed quickly.",
      },
      { property: "og:site_name", content: "Zérah Baby & Kids" },
      { property: "og:title", content: "Refund & Return Policy — Zérah Baby & Kids" },
      {
        property: "og:description",
        content:
          "7-day easy returns, reverse pickup logistics, inspection-based refunds and store credit rules.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://zerahkids.com/returns" },
      { property: "og:image", content: "https://zerahkids.com/logo.png" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://zerahkids.com/returns" }],
  }),
  component: ReturnsPage,
});

function ReturnsPage() {
  return (
    <EditablePolicyPage
      pageKey="page_returns"
      defaultContent={DEFAULT_RETURNS_POLICY}
      pageUrl="/returns"
    />
  );
}
