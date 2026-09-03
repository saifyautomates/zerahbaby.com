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
  helpful_count?: number;
  user_name?: string;
};

export type ReviewStats = {
  averageRating: number;
  totalRatings: number;
  totalReviews: number;
  recommendPct: number;
  breakdown: Record<1 | 2 | 3 | 4 | 5, { count: number; pct: number }>;
  allImages: Array<{ url: string; reviewId: string; rating: number; title: string }>;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Resolves a product UUID from either a valid UUID string or a product slug.
 * Prevents PostgreSQL 22P02 invalid input syntax errors when a slug is passed.
 */
export async function resolveProductUuid(identifier: string | undefined): Promise<string | null> {
  if (!identifier) return null;
  const trimmed = identifier.trim();
  if (UUID_REGEX.test(trimmed)) return trimmed;

  try {
    const { data } = await supabase
      .from("products")
      .select("id")
      .or(`slug.eq.${trimmed},id.eq.${trimmed}`)
      .maybeSingle();

    if (data?.id && UUID_REGEX.test(data.id)) {
      return data.id;
    }
  } catch (err) {
    console.warn("[reviews] Failed to resolve product UUID for identifier:", identifier, err);
  }
  return null;
}

/** Fetch approved reviews for a product with user profile info */
export function useProductReviews(productId: string | undefined) {
  return useQuery({
    queryKey: ["reviews", productId],
    enabled: Boolean(productId),
    queryFn: async () => {
      if (!productId) return [];
      const canonicalId = await resolveProductUuid(productId);
      if (!canonicalId) return [];

      const { data, error } = await supabase
        .from("reviews")
        .select("*")
        .eq("product_id", canonicalId)
        .eq("status", "approved")
        .order("created_at", { ascending: false });

      if (error) throw error;

      return (data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id,
        product_id: r.product_id,
        user_id: r.user_id,
        order_id: r.order_id,
        rating: Number(r.rating) || 5,
        title: (r.title as string) || "",
        comment: (r.comment as string) || "",
        images: Array.isArray(r.images) ? r.images : [],
        verified_purchase: Boolean(r.verified_purchase),
        status: r.status,
        created_at: r.created_at,
        updated_at: r.updated_at,
        user_name: (r.profiles as { full_name?: string } | null)?.full_name || "Verified Customer",
      })) as Review[];
    },
  });
}

/** Check if the current authenticated user has purchased this specific product */
export function useCanUserReviewProduct(
  productId: string | undefined,
  productSlug?: string,
  userId?: string,
) {
  return useQuery({
    queryKey: ["can-review-product", productId, productSlug, userId],
    enabled: Boolean(userId && (productId || productSlug)),
    queryFn: async () => {
      if (!userId || (!productId && !productSlug)) {
        return {
          canReview: false,
          isVerifiedBuyer: false,
          orderId: null as string | null,
          hasAlreadyReviewed: false,
          existingReview: null as Review | null,
        };
      }

      // 1. Resolve canonical product UUID
      const canonicalId =
        (await resolveProductUuid(productId)) || (await resolveProductUuid(productSlug));

      // 2. Check if user already submitted a review for this product
      let existingReviewQuery = supabase.from("reviews").select("*").eq("user_id", userId);

      if (canonicalId) {
        existingReviewQuery = existingReviewQuery.eq("product_id", canonicalId);
      }

      const { data: existingReviews } = await existingReviewQuery.limit(1);
      const existingReview =
        existingReviews && existingReviews.length > 0 ? (existingReviews[0] as Review) : null;

      // 3. Query user's non-cancelled orders with order items
      const { data: orders, error } = await supabase
        .from("orders")
        .select("id, status, order_items(product_id, product_slug)")
        .eq("user_id", userId)
        .neq("status", "cancelled");

      if (error) {
        console.warn("Could not verify customer orders:", error);
        return {
          canReview: false,
          isVerifiedBuyer: false,
          orderId: null,
          hasAlreadyReviewed: Boolean(existingReview),
          existingReview,
        };
      }

      // Check if any order item matches this product's UUID or slug
      let matchedOrderId: string | null = null;

      if (orders && Array.isArray(orders)) {
        for (const order of orders) {
          const items = Array.isArray(order.order_items) ? order.order_items : [];
          const matched = items.some((item) => {
            if (canonicalId && item.product_id === canonicalId) {
              return true;
            }
            if (productId && (item.product_id === productId || item.product_slug === productId)) {
              return true;
            }
            if (
              productSlug &&
              (item.product_slug === productSlug || item.product_id === productSlug)
            ) {
              return true;
            }
            return false;
          });

          if (matched) {
            matchedOrderId = order.id;
            break;
          }
        }
      }

      const isVerifiedBuyer = Boolean(matchedOrderId);

      return {
        canReview: isVerifiedBuyer,
        isVerifiedBuyer,
        orderId: matchedOrderId,
        hasAlreadyReviewed: Boolean(existingReview),
        existingReview,
      };
    },
  });
}

/** Calculate summary statistics, star breakdowns, and customer gallery images */
export function calculateReviewStats(reviews: Review[] = []): ReviewStats {
  const total = reviews.length;
  if (total === 0) {
    return {
      averageRating: 0,
      totalRatings: 0,
      totalReviews: 0,
      recommendPct: 0,
      breakdown: {
        5: { count: 0, pct: 0 },
        4: { count: 0, pct: 0 },
        3: { count: 0, pct: 0 },
        2: { count: 0, pct: 0 },
        1: { count: 0, pct: 0 },
      },
      allImages: [],
    };
  }

  let sum = 0;
  let recommendCount = 0;
  const counts: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const allImages: ReviewStats["allImages"] = [];

  for (const r of reviews) {
    const star = Math.min(5, Math.max(1, Math.round(r.rating))) as 1 | 2 | 3 | 4 | 5;
    counts[star] = (counts[star] || 0) + 1;
    sum += r.rating;
    if (r.rating >= 4) recommendCount++;

    if (Array.isArray(r.images)) {
      for (const img of r.images) {
        if (img && typeof img === "string" && img.startsWith("http")) {
          allImages.push({
            url: img,
            reviewId: r.id,
            rating: r.rating,
            title: r.title || "Customer photo",
          });
        }
      }
    }
  }

  const averageRating = Number((sum / total).toFixed(1));
  const recommendPct = Math.round((recommendCount / total) * 100);

  const breakdown: ReviewStats["breakdown"] = {
    5: { count: counts[5], pct: Math.round((counts[5] / total) * 100) },
    4: { count: counts[4], pct: Math.round((counts[4] / total) * 100) },
    3: { count: counts[3], pct: Math.round((counts[3] / total) * 100) },
    2: { count: counts[2], pct: Math.round((counts[2] / total) * 100) },
    1: { count: counts[1], pct: Math.round((counts[1] / total) * 100) },
  };

  return {
    averageRating,
    totalRatings: total,
    totalReviews: reviews.filter((r) => r.comment && r.comment.trim().length > 0).length,
    recommendPct,
    breakdown,
    allImages,
  };
}

/** Submit or update a verified product review */
export function useSubmitReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      product_id: string;
      user_id: string;
      order_id?: string | null;
      rating: number;
      title: string;
      comment: string;
      images?: string[];
      review_id?: string;
    }) => {
      const canonicalProductId = await resolveProductUuid(input.product_id);
      if (!canonicalProductId) {
        throw new Error(
          "Could not verify product identifier. Please refresh the page and try again.",
        );
      }

      const verified = Boolean(input.order_id);
      const images = Array.isArray(input.images) ? input.images.filter(Boolean) : [];

      if (input.review_id) {
        // Update existing review
        const { error } = await supabase
          .from("reviews")
          .update({
            product_id: canonicalProductId,
            rating: input.rating,
            title: input.title.trim(),
            comment: input.comment.trim(),
            images,
            order_id: input.order_id ?? null,
            verified_purchase: verified,
            status: "pending",
          })
          .eq("id", input.review_id)
          .eq("user_id", input.user_id);

        if (error) throw error;
      } else {
        // Insert new review
        const { error } = await supabase.from("reviews").insert({
          product_id: canonicalProductId,
          user_id: input.user_id,
          order_id: input.order_id ?? null,
          rating: input.rating,
          title: input.title.trim(),
          comment: input.comment.trim(),
          images,
          verified_purchase: verified,
          status: "pending",
        });

        if (error) throw error;
      }
    },
    onSuccess: (_, vars) => {
      toast.success("Thank you! Your verified review has been submitted.");
      qc.invalidateQueries({ queryKey: ["reviews"] });
      qc.invalidateQueries({ queryKey: ["can-review-product"] });
      qc.invalidateQueries({ queryKey: ["admin-reviews"] });
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

      return (data ?? []).map((r: Record<string, unknown>) => ({
        ...r,
        images: Array.isArray(r.images) ? r.images : [],
        user_name: (r.profiles as { full_name?: string } | null)?.full_name || "Customer",
        user_phone: (r.profiles as { phone?: string } | null)?.phone || "",
      })) as (Review & {
        products: { name: string; slug: string } | null;
        user_name?: string;
        user_phone?: string;
      })[];
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
      toast.success("Review updated successfully");
      qc.invalidateQueries({ queryKey: ["admin-reviews"] });
      qc.invalidateQueries({ queryKey: ["reviews"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["admin-products"] });
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
      qc.invalidateQueries({ queryKey: ["reviews"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["admin-products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
