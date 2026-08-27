import { createFileRoute } from "@tanstack/react-router";
import { EditablePolicyPage } from "@/components/admin/EditablePolicyPage";
import { DEFAULT_RETURNS_POLICY } from "@/lib/pages-content";

export const Route = createFileRoute("/returns")({
  head: () => ({
    meta: [
      { title: "Refund & Return Policy — Zerah Baby And Kid's" },
      {
        name: "description",
        content:
          "Returns accepted within 7 days of delivery. Products must be unused, unwashed and in original packaging. Refunds are processed after inspection.",
      },
      { property: "og:title", content: "Refund & Return Policy — Zerah Baby And Kid's" },
      {
        property: "og:description",
        content:
          "7-day returns, inspection-based refunds and shipping charge rules for Zerah Baby And Kid's orders.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
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
