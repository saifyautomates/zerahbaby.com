//
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type Coupon = {
  id: string;
  code: string;
  discount_type: "percentage" | "fixed";
  discount_value: number;
  minimum_order_value: number;
  maximum_discount: number;
  usage_limit: number;
  usage_count: number;
  per_user_limit: number;
  starts_at: string | null;
  expires_at: string | null;
  active: boolean;
  created_at: string;
};

/** Admin: list all coupons */
export function useAllCoupons(enabled: boolean) {
  return useQuery({
    queryKey: ["admin-coupons"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("coupons")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Coupon[];
    },
  });
}

/** Admin: create coupon */
export function useCreateCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<Coupon, "id" | "usage_count" | "created_at">) => {
      const { error } = await supabase.from("coupons").insert({
        code: input.code.toUpperCase().trim(),
        discount_type: input.discount_type,
        discount_value: input.discount_value,
        minimum_order_value: input.minimum_order_value,
        maximum_discount: input.maximum_discount,
        usage_limit: input.usage_limit,
        per_user_limit: input.per_user_limit,
        starts_at: input.starts_at,
        expires_at: input.expires_at,
        active: input.active,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Coupon created");
      qc.invalidateQueries({ queryKey: ["admin-coupons"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Admin: delete coupon */
export function useDeleteCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("coupons").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Coupon deleted");
      qc.invalidateQueries({ queryKey: ["admin-coupons"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Admin: toggle coupon active status */
export function useToggleCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("coupons").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-coupons"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
