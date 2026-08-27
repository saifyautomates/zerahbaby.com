import { createFileRoute } from "@tanstack/react-router";
import { EditablePolicyPage } from "@/components/admin/EditablePolicyPage";
import { DEFAULT_TERMS_CONDITIONS } from "@/lib/pages-content";

export const Route = createFileRoute("/terms-conditions")({
  head: () => ({
    meta: [{ title: "Terms and Conditions | Zérah Baby And Kid's" }],
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
