import { createFileRoute } from "@tanstack/react-router";
import { POSTab } from "@/components/admin/POSTab";
import { PrintLabelsModal } from "@/components/admin/PrintLabelsModal";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mapProduct } from "@/lib/store";

import { useIsAdmin, useSession } from "@/lib/auth";
import { useDirectLabelPrint } from "@/lib/label-printer";

export const Route = createFileRoute("/pos-test")({
  head: () => ({
    meta: [
      { title: "POS Test — Zerah Baby And Kid's" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PosTestRoute,
});

function PosTestRoute() {
  const { user, loading } = useSession();
  const { data: isAdmin, isLoading: roleLoading } = useIsAdmin(user?.id);
  const [print, setPrint] = useState(false);
  const { printLabel, isPrinting } = useDirectLabelPrint();

  const { data: products = [] } = useQuery({
    queryKey: ["admin-products"],
    enabled: Boolean(isAdmin),
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").eq("is_active", true);
      if (error) throw error;
      return (data as never[]).map((r) => mapProduct(r as never));
    },
  });

  if (loading || roleLoading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading...</div>;
  }

  if (!isAdmin) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-xl font-bold">Admin access required</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Sign in with an admin account to use POS.
        </p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">E2E Test Environment for POS</h1>
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={() => printLabel(products.slice(0, 2))}
          disabled={isPrinting || products.length === 0}
          className="bg-[#8B2020] text-white px-4 py-2 rounded-lg font-semibold cursor-pointer"
        >
          1-Click Print Labels
        </button>
        <button
          onClick={() => setPrint(true)}
          className="bg-secondary text-secondary-foreground px-4 py-2 rounded-lg font-semibold border border-border cursor-pointer"
        >
          Open Advanced Print Modal
        </button>
      </div>
      <POSTab />

      {print && <PrintLabelsModal products={products} onClose={() => setPrint(false)} />}
    </div>
  );
}
