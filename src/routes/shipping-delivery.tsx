import { createFileRoute } from "@tanstack/react-router";
import { EditablePolicyPage } from "@/components/admin/EditablePolicyPage";
import { DEFAULT_SHIPPING_DELIVERY } from "@/lib/pages-content";

export const Route = createFileRoute("/shipping-delivery")({
  head: () => ({
    meta: [
      { title: "Shipping & Delivery Policy | Zérah Baby & Kids" },
      {
        name: "description",
        content:
          "Free delivery across India on orders above ₹999. Real-time tracking, safe packaging, and fast dispatch for baby clothing, toys, and essentials.",
      },
      { property: "og:site_name", content: "Zérah Baby & Kids" },
      { property: "og:title", content: "Shipping & Delivery Policy | Zérah Baby & Kids" },
      {
        property: "og:description",
        content: "Pan-India fast shipping, free delivery thresholds, and live dispatch tracking.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://zerahkids.com/shipping-delivery" },
      { property: "og:image", content: "https://zerahkids.com/logo.png" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://zerahkids.com/shipping-delivery" }],
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
