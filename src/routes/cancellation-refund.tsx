import { createFileRoute } from "@tanstack/react-router";
import { EditablePolicyPage } from "@/components/admin/EditablePolicyPage";
import { DEFAULT_CANCELLATION_REFUND } from "@/lib/pages-content";

export const Route = createFileRoute("/cancellation-refund")({
  head: () => ({
    meta: [{ title: "Cancellation and Refund Policy | Zérah Baby And Kid's" }],
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
