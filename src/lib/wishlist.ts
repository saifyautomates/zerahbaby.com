//
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/auth";

export function useWishlist() {
  const { user } = useSession();
  const qc = useQueryClient();

  const { data: wishlistData } = useQuery({
    queryKey: ["wishlist", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      // Ensure wishlist exists
      let { data: wl } = await supabase
        .from("wishlists")
        .select("id")
        .eq("user_id", user!.id)
        .maybeSingle();

      if (!wl) {
        const { data: created, error } = await supabase
          .from("wishlists")
          .insert({ user_id: user!.id })
          .select("id")
          .single();
        if (error) throw error;
        wl = created;
      }

      const { data: items, error: itemsErr } = await supabase
        .from("wishlist_items")
        .select("id, product_id, created_at")
        .eq("wishlist_id", wl.id)
        .order("created_at", { ascending: false });
      if (itemsErr) throw itemsErr;

      return { wishlistId: wl.id, items: items ?? [] };
    },
  });

  const wishlistId = wishlistData?.wishlistId;
  const items = wishlistData?.items ?? [];
  const productIds = items.map((i) => i.product_id);

  const isWishlisted = (productId: string) => productIds.includes(productId);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["wishlist", user?.id] });

  const add = useMutation({
    mutationFn: async (productId: string) => {
      if (!wishlistId) throw new Error("No wishlist");
      const { error } = await supabase
        .from("wishlist_items")
        .insert({ wishlist_id: wishlistId, product_id: productId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (productId: string) => {
      if (!wishlistId) throw new Error("No wishlist");
      const { error } = await supabase
        .from("wishlist_items")
        .delete()
        .eq("wishlist_id", wishlistId)
        .eq("product_id", productId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const toggle = (productId: string) => {
    if (isWishlisted(productId)) remove.mutate(productId);
    else add.mutate(productId);
  };

  return { items, productIds, isWishlisted, toggle, add, remove };
}
