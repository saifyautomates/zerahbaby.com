import { createFileRoute } from "@tanstack/react-router";
import { EditablePolicyPage } from "@/components/admin/EditablePolicyPage";
import { DEFAULT_SHIPPING_DELIVERY } from "@/lib/pages-content";

export const Route = createFileRoute("/shipping-delivery")({
  head: () => ({
    meta: [{ title: "Shipping and Delivery Policy | Zérah Baby And Kid's" }],
  }),
  component: ShippingDeliveryPage,
});

function ShippingDeliveryPage() {
  return (
    <EditablePolicyPage
      pageKey="page_shipping_delivery"
      defaultContent={DEFAULT_SHIPPING_DELIVERY}
      pageUrl="/shipping-delivery"
    />
  );
}
