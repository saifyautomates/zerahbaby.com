import { createFileRoute } from "@tanstack/react-router";
import { EditablePolicyPage } from "@/components/admin/EditablePolicyPage";
import { DEFAULT_CANCELLATION_REFUND } from "@/lib/pages-content";

export const Route = createFileRoute("/cancellation-refund")({
  head: () => ({
    meta: [
      { title: "Cancellation & Refund Policy | Zérah Baby & Kids" },
      {
        name: "description",
        content:
          "Clear rules on order cancellations, automated Razorpay refunds, quality inspection timelines, and store credit processing at Zérah Baby & Kids.",
      },
      { property: "og:site_name", content: "Zérah Baby & Kids" },
      { property: "og:title", content: "Cancellation & Refund Policy | Zérah Baby & Kids" },
      {
        property: "og:description",
        content: "Transparent cancellation windows, automated refunds, and store credit policies.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://zerahkids.com/cancellation-refund" },
      { property: "og:image", content: "https://zerahkids.com/logo.png" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://zerahkids.com/cancellation-refund" }],
  }),
  component: CancellationRefundPage,
});

function CancellationRefundPage() {
  return (
    <EditablePolicyPage
      pageKey="page_cancellation_refund"
      defaultContent={DEFAULT_CANCELLATION_REFUND}
      pageUrl="/cancellation-refund"
    />
  );
}
