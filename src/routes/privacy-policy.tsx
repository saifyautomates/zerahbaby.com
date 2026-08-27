import { createFileRoute } from "@tanstack/react-router";
import { EditablePolicyPage } from "@/components/admin/EditablePolicyPage";
import { DEFAULT_PRIVACY_POLICY } from "@/lib/pages-content";

export const Route = createFileRoute("/privacy-policy")({
  head: () => ({
    meta: [{ title: "Privacy Policy | Zérah Baby And Kid's" }],
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
