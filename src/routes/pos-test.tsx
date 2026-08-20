import { createFileRoute } from "@tanstack/react-router";
import { POSTab } from "@/components/admin/POSTab";
import { PrintLabelsModal } from "@/components/admin/PrintLabelsModal";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mapProduct } from "@/lib/store";

export const Route = createFileRoute("/pos-test")({
  component: PosTestRoute,
});

function PosTestRoute() {
  const [print, setPrint] = useState(false);
  const { data: products = [] } = useQuery({
    queryKey: ["admin-products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").eq("is_active", true);
      if (error) throw error;
      return (data as never[]).map((r) => mapProduct(r as never));
    },
  });

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">E2E Test Environment for POS</h1>
      <button onClick={() => setPrint(true)} className="bg-primary text-primary-foreground px-4 py-2 mb-8 rounded">
        Open Print Labels
      </button>
      <POSTab />
      
      {print && <PrintLabelsModal products={products} onClose={() => setPrint(false)} />}
    </div>
  );
}
