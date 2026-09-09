import { createFileRoute } from "@tanstack/react-router";
import { EditablePolicyPage } from "@/components/admin/EditablePolicyPage";
import { DEFAULT_TERMS_CONDITIONS } from "@/lib/pages-content";

export const Route = createFileRoute("/terms-conditions")({
  head: () => ({
    meta: [
      { title: "Terms & Conditions | Zérah Baby & Kids" },
      {
        name: "description",
        content:
          "Website usage terms, purchase conditions, coupon guidelines, and service agreements for Zérah Baby & Kids.",
      },
      { property: "og:site_name", content: "Zérah Baby & Kids" },
      { property: "og:title", content: "Terms & Conditions | Zérah Baby & Kids" },
      {
        property: "og:description",
        content: "Store terms, purchase policies, and service guidelines.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://zerahkids.com/terms-conditions" },
      { property: "og:image", content: "https://zerahkids.com/logo.png" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://zerahkids.com/terms-conditions" }],
  }),
  component: TermsConditionsPage,
});

function TermsConditionsPage() {
  return (
    <EditablePolicyPage
      pageKey="page_terms_conditions"
      defaultContent={DEFAULT_TERMS_CONDITIONS}
      pageUrl="/terms-conditions"
    />
  );
}
