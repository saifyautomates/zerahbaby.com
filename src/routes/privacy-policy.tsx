import { createFileRoute } from "@tanstack/react-router";
import { EditablePolicyPage } from "@/components/admin/EditablePolicyPage";
import { DEFAULT_PRIVACY_POLICY } from "@/lib/pages-content";

export const Route = createFileRoute("/privacy-policy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy | Zérah Baby & Kids" },
      {
        name: "description",
        content:
          "Read how Zérah Baby & Kids protects your personal information, customer order details, address data, and secure payment privacy.",
      },
      { property: "og:site_name", content: "Zérah Baby & Kids" },
      { property: "og:title", content: "Privacy Policy | Zérah Baby & Kids" },
      {
        property: "og:description",
        content: "Customer data protection standards and transaction security at Zérah Baby & Kids.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://zerahkids.com/privacy-policy" },
      { property: "og:image", content: "https://zerahkids.com/logo.png" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://zerahkids.com/privacy-policy" }],
  }),
  component: PrivacyPolicyPage,
});

function PrivacyPolicyPage() {
  return (
    <EditablePolicyPage
      pageKey="page_privacy_policy"
      defaultContent={DEFAULT_PRIVACY_POLICY}
      pageUrl="/privacy-policy"
    />
  );
}
