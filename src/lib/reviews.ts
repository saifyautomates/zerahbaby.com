// @ts-nocheck
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type Review = {
  id: string;
  product_id: string;
  user_id: string;
  order_id: string | null;
  rating: number;
  title: string;
  comment: string;
  images: string[];
  verified_purchase: boolean;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  updated_at: string;
};

/** Fetch approved reviews for a product */
export function useProductReviews(productId: string | undefined) {
  return useQuery({
    queryKey: ["reviews", productId],
    enabled: Boolean(productId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reviews")
        .select("*")
        .eq("product_id", productId!)
        .eq("status", "approved")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Review[];
    },
  });
}

/** Submit a review */
export function useSubmitReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      product_id: string;
      user_id: string;
      order_id?: string;
      rating: number;
      title: string;
      comment: string;
    }) => {
      // Check if user has purchased the product
      const verified = input.order_id ? true : false;
      const { error } = await supabase.from("reviews").insert({
        product_id: input.product_id,
        user_id: input.user_id,
        order_id: input.order_id ?? null,
        rating: input.rating,
        title: input.title,
        comment: input.comment,
        verified_purchase: verified,
        status: "pending",
      });
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      toast.success("Review submitted! It will appear after moderation.");
      qc.invalidateQueries({ queryKey: ["reviews", vars.product_id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Admin: fetch all reviews */
export function useAllReviews(enabled: boolean) {
  return useQuery({
    queryKey: ["admin-reviews"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reviews")
        .select("*, products:product_id(name, slug)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as (Review & { products: { name: string; slug: string } | null })[];
    },
  });
}

/** Admin: update review status */
export function useUpdateReviewStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
      const { error } = await supabase.from("reviews").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Review updated");
      qc.invalidateQueries({ queryKey: ["admin-reviews"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Admin: delete a review */
export function useDeleteReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("reviews").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Review deleted");
      qc.invalidateQueries({ queryKey: ["admin-reviews"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
