import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useProducts, getColorSwatchImage, type Product, type ProductVariant } from "@/lib/store";
import { useSession } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export type CartLine = { id: string; qty: number; variantId?: string };

export type CartItem = {
  product: Product;
  qty: number;
  variantId?: string;
  variant?: ProductVariant | null;
  price: number;
  stock: number;
  color?: string | null;
  size?: string | null;
  image: string;
  sku?: string;
};

export type CartCoupon = {
  code: string;
  id: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  minimumOrderValue: number;
  maximumDiscount: number;
  discount: number;
};

type CartContextValue = {
  lines: CartLine[];
  items: CartItem[];
  count: number;
  subtotal: number;
  savings: number;
  total: number;
  coupon: CartCoupon | null;
  add: (id: string, qty?: number, variantId?: string) => void;
  setQty: (id: string, qty: number, variantId?: string) => void;
  remove: (id: string, variantId?: string) => void;
  clear: () => void;
  applyCoupon: (code: string) => Promise<void>;
  removeCoupon: () => void;
  shipping: number;
  eligibleSubtotal: number;
  isFreeDelivery: boolean;
  freeDeliveryMessage: string | null;
  amountToFreeDelivery: number;
  isLoading: boolean;
};

const CartContext = createContext<CartContextValue | null>(null);
const GUEST_STORAGE_KEY = "zerah-cart-guest";
function getCartStorageKey(userId?: string) {
  return userId ? `zerah-cart-${userId}` : GUEST_STORAGE_KEY;
}

/** Silently sync cart lines to Supabase for logged-in users */
async function syncToSupabase(userId: string, lines: CartLine[], products: Product[]) {
  try {
    // Ensure cart exists
    let { data: cart } = await supabase
      .from("carts")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    if (!cart) {
      const { data: created, error } = await supabase
        .from("carts")
        .insert({ user_id: userId })
        .select("id")
        .single();
      if (error) return;
      cart = created;
    }

    // Clear existing items
    await supabase.from("cart_items").delete().eq("cart_id", cart.id);

    // Insert current lines
    if (lines.length > 0) {
      const items = lines
        .map((line) => {
          const product = products.find((p) => p.id === line.id);
          if (!product) return null;
          return {
            cart_id: cart.id,
            product_id: product.uuid,
            variant_id:
              line.variantId || (product.variants?.length ? product.variants[0].id : null),
            quantity: line.qty,
            price_at_add: product.price,
          };
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x));

      if (items.length > 0) {
        await supabase.from("cart_items").insert(items);
      }
    }
  } catch {
    // Silent fail
  }
}

/** Load cart from Supabase on login */
async function loadFromSupabase(userId: string, products: Product[]): Promise<CartLine[] | null> {
  try {
    const { data: cart } = await supabase
      .from("carts")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    if (!cart) return null;

    const { data: items } = await supabase
      .from("cart_items")
      .select("product_id, quantity, variant_id")
      .eq("cart_id", cart.id);

    if (!items || items.length === 0) return null;

    // Map product UUIDs back to slugs
    const lines: CartLine[] = [];
    for (const item of items) {
      const product = products.find((p) => p.uuid === item.product_id);
      if (product) {
        lines.push({ id: product.id, qty: item.quantity, variantId: item.variant_id ?? undefined });
      }
    }
    return lines.length > 0 ? lines : null;
  } catch {
    return null;
  }
}

import { useQuery } from "@tanstack/react-query";

export function CartProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [lines, setLines] = useState<CartLine[]>([]);
  const { data: products, isLoading: productsLoading } = useProducts();
  const prevUserIdRef = useState<{ id?: string }>({ id: undefined })[0];
  const [hasLoadedFromDb, setHasLoadedFromDb] = useState(false);

  const { data: settingsData } = useQuery({
    queryKey: ["site_settings", "shipping"],
    queryFn: async () => {
      const { data } = await supabase
        .from("site_settings")
        .select("key, value")
        .in("key", [
          "free_delivery_enabled",
          "free_delivery_threshold",
          "standard_shipping_charge",
          "free_delivery_message",
        ]);

      const settings = {
        free_delivery_enabled: "true",
        free_delivery_threshold: "999",
        standard_shipping_charge: "79",
        free_delivery_message: "Add ₹{amount} more for FREE DELIVERY 🎉",
      };

      if (data) {
        for (const row of data) {
          settings[row.key as keyof typeof settings] = row.value;
        }
      }
      return settings;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Handle user authentication transitions & storage scoping
  useEffect(() => {
    const currentUserId = user?.id;
    const prevUserId = prevUserIdRef.id;

    if (currentUserId !== prevUserId) {
      prevUserIdRef.id = currentUserId;
      setHasLoadedFromDb(false);

      if (!currentUserId) {
        // User logged out: clear memory cart and coupon
        setLines([]);
        setCoupon(null);
      } else {
        // User logged in / switched: load initial items from user-scoped storage or clear
        if (typeof window !== "undefined") {
          try {
            const guestRaw = window.localStorage.getItem(GUEST_STORAGE_KEY);
            const userRaw = window.localStorage.getItem(getCartStorageKey(currentUserId));
            const initialLines = userRaw
              ? (JSON.parse(userRaw) as CartLine[])
              : guestRaw
                ? (JSON.parse(guestRaw) as CartLine[])
                : [];
            setLines(initialLines);
          } catch {
            setLines([]);
          }
        }
      }
    }
  }, [user?.id, prevUserIdRef]);

  // Keep user-scoped localStorage updated when lines change
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const key = getCartStorageKey(user?.id);
      window.localStorage.setItem(key, JSON.stringify(lines));
    } catch {
      /* ignore quota errors */
    }
  }, [lines, user?.id]);

  // On login: sync & merge Supabase cart with local cart
  useEffect(() => {
    if (!user || !products || products.length === 0 || hasLoadedFromDb) return;

    loadFromSupabase(user.id, products).then((dbLines) => {
      setLines((prev) => {
        const merged = [...(dbLines ?? [])];
        for (const localLine of prev) {
          if (!merged.find((l) => l.id === localLine.id)) {
            merged.push(localLine);
          }
        }
        return merged;
      });

      // Clear guest storage after successful merge
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(GUEST_STORAGE_KEY);
      }
      setHasLoadedFromDb(true);
    });
  }, [user, products, hasLoadedFromDb]);

  // Prune deleted or inactive products from cart lines
  useEffect(() => {
    if (!products) return;
    const validIds = new Set(products.map((p) => p.id));
    setLines((prev) => {
      const filtered = prev.filter((l) => validIds.has(l.id));
      return filtered.length !== prev.length ? filtered : prev;
    });
  }, [products]);

  // Sync to Supabase (debounced)
  useEffect(() => {
    if (!user || !products || products.length === 0) return;
    const timer = setTimeout(() => {
      syncToSupabase(user.id, lines, products);
    }, 1000); // Debounce 1 second
    return () => clearTimeout(timer);
  }, [lines, user, products]);

  const [coupon, setCoupon] = useState<CartCoupon | null>(null);

  // Auto-remove coupon if subtotal falls below minimum order requirement
  useEffect(() => {
    if (!coupon) return;
    const list = products ?? [];
    const items = lines
      .map((line) => {
        const p = list.find((x) => x.id === line.id);
        if (!p) return null;
        const defaultVariantId = p.variants?.length ? p.variants[0].id : undefined;
        const v = p.variants?.find((v) => v.id === (line.variantId || defaultVariantId));
        return (v?.priceOverride || p.price) * line.qty;
      })
      .filter((x): x is number => x !== null);
    const subtotal = items.reduce((sum, val) => sum + val, 0);

    const minOrder = Number(coupon.minimumOrderValue || 0);
    if (minOrder > 0 && subtotal > 0 && subtotal < minOrder) {
      toast.error(`Coupon "${coupon.code}" removed (Min. order ₹${minOrder} required)`);
      setCoupon(null);
    }
  }, [lines, products, coupon]);

  const value = useMemo<CartContextValue>(() => {
    const list = products ?? [];
    const items: CartItem[] = lines
      .map((line): CartItem | null => {
        const product = list.find((x) => x.id === line.id);
        if (!product) return null;

        const defaultVariantId = product.variants?.length ? product.variants[0].id : undefined;
        const vId = line.variantId || defaultVariantId;
        const variant = product.variants?.find((v) => v.id === vId);
        const stock = variant ? variant.stock : product.stock;
        const price = variant?.priceOverride || product.price;
        const color = variant?.color || null;
        const size = variant?.size || null;
        const image = color ? getColorSwatchImage(product, color) : product.image;
        const sku = variant?.sku || product.sku;

        const clampedQty = Math.min(line.qty, stock);
        return {
          product,
          qty: clampedQty,
          variantId: vId,
          variant: variant || null,
          price,
          stock,
          color,
          size,
          image,
          sku,
        };
      })
      .filter((x): x is CartItem => x !== null && x.qty > 0);

    const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);

    // Dynamically recalculate coupon discount based on current subtotal
    let activeCoupon: CartCoupon | null = null;
    if (coupon) {
      const minOrder = Number(coupon.minimumOrderValue || 0);
      const discountType = coupon.discountType || "percentage";
      const discountVal = Number(coupon.discountValue || 0);
      const maxDiscount = Number(coupon.maximumDiscount || 0);

      if (subtotal >= minOrder) {
        let calculatedDiscount = 0;
        if (discountType === "percentage" && discountVal > 0) {
          calculatedDiscount = (subtotal * discountVal) / 100;
          if (maxDiscount > 0 && calculatedDiscount > maxDiscount) {
            calculatedDiscount = maxDiscount;
          }
        } else if (discountVal > 0) {
          calculatedDiscount = Math.min(subtotal, discountVal);
        } else {
          // Fallback if legacy object didn't have discountValue explicitly set
          calculatedDiscount = coupon.discount || 0;
        }

        calculatedDiscount = Math.round(calculatedDiscount);
        if (calculatedDiscount > 0) {
          activeCoupon = {
            ...coupon,
            discount: calculatedDiscount,
          };
        }
      }
    }

    const couponDiscount = activeCoupon?.discount || 0;
    const eligibleSubtotal = Math.max(0, subtotal - couponDiscount);

    // Default to true and 999 if settings are not loaded yet
    const freeDeliveryEnabled = settingsData?.free_delivery_enabled !== "false";
    const threshold = Number(settingsData?.free_delivery_threshold || 999);
    const standardCharge = Number(settingsData?.standard_shipping_charge || 79);

    const isFreeDelivery = freeDeliveryEnabled && eligibleSubtotal > threshold;
    const shipping = isFreeDelivery ? 0 : standardCharge;
    const amountToFreeDelivery = Math.max(0, threshold + 1 - eligibleSubtotal);

    let freeDeliveryMessage: string | null = null;
    if (freeDeliveryEnabled) {
      if (isFreeDelivery) {
        freeDeliveryMessage = "🎉 FREE DELIVERY UNLOCKED";
      } else {
        freeDeliveryMessage = (
          settingsData?.free_delivery_message || "Add ₹{amount} more for FREE DELIVERY 🎉"
        ).replace("{amount}", amountToFreeDelivery.toString());
      }
    }

    const total = Math.max(0, eligibleSubtotal + shipping);

    return {
      lines,
      items,
      count: items.reduce((sum, i) => sum + i.qty, 0),
      subtotal,
      savings: items.reduce((sum, i) => sum + Math.max(0, i.product.mrp - i.price) * i.qty, 0),
      total,
      shipping,
      eligibleSubtotal,
      isFreeDelivery,
      freeDeliveryMessage,
      amountToFreeDelivery,
      coupon: activeCoupon,
      add: (id, qty = 1, variantId) =>
        setLines((prev) => {
          const product = list.find((p) => p.id === id);
          if (!product) return prev;

          const defaultVariantId = product.variants?.length ? product.variants[0].id : undefined;
          const vId = variantId || defaultVariantId;
          const variant = product.variants?.find((v) => v.id === vId);
          const stock = variant ? variant.stock : product.stock;

          const existing = prev.find(
            (l) => l.id === id && (l.variantId || defaultVariantId) === vId,
          );
          const requestedQty = (existing?.qty || 0) + qty;
          const finalQty = Math.min(requestedQty, stock);

          if (existing) {
            return prev.map((l) =>
              l.id === id && (l.variantId || defaultVariantId) === vId
                ? { ...l, qty: finalQty }
                : l,
            );
          }
          return [...prev, { id, qty: finalQty, variantId: vId }];
        }),
      setQty: (id, qty, variantId) =>
        setLines((prev) => {
          const product = list.find((p) => p.id === id);
          if (!product) return prev;

          const defaultVariantId = product.variants?.length ? product.variants[0].id : undefined;
          const vId = variantId || defaultVariantId;
          const variant = product.variants?.find((v) => v.id === vId);
          const stock = variant ? variant.stock : product.stock;

          const finalQty = Math.min(qty, stock);
          return finalQty <= 0
            ? prev.filter((l) => !(l.id === id && (l.variantId || defaultVariantId) === vId))
            : prev.map((l) =>
                l.id === id && (l.variantId || defaultVariantId) === vId
                  ? { ...l, qty: finalQty }
                  : l,
              );
        }),
      remove: (id, variantId) =>
        setLines((prev) =>
          prev.filter((l) => {
            if (!variantId) return l.id !== id; // if no variantId provided, remove all variants of this product
            const product = list.find((p) => p.id === id);
            const defaultVariantId = product?.variants?.length ? product.variants[0].id : undefined;
            return !(l.id === id && (l.variantId || defaultVariantId) === variantId);
          }),
        ),
      clear: async () => {
        setLines([]);
        setCoupon(null);
        if (user) {
          const { data: cart } = await supabase
            .from("carts")
            .select("id")
            .eq("user_id", user.id)
            .maybeSingle();
          if (cart) {
            await supabase.from("cart_items").delete().eq("cart_id", cart.id);
          }
        }
      },
      applyCoupon: async (code: string) => {
        if (!user) {
          throw new Error("You must be logged in to use coupons");
        }
        const { data, error } = await supabase.rpc("validate_coupon", {
          _code: code,
          _user_id: user.id,
          _order_total: subtotal,
        });
        if (error) throw error;
        const result = data as {
          valid?: boolean;
          code?: string;
          discount?: number;
          coupon_id?: string;
          discount_type?: string;
          discount_value?: number;
          minimum_order_value?: number;
          maximum_discount?: number;
          error?: string;
        } | null;
        if (!result || !result.valid) {
          throw new Error(result?.error || "Invalid coupon");
        }
        setCoupon({
          code: result.code!,
          id: result.coupon_id!,
          discountType: (result.discount_type as "percentage" | "fixed") || "percentage",
          discountValue: Number(result.discount_value || 0),
          minimumOrderValue: Number(result.minimum_order_value || 0),
          maximumDiscount: Number(result.maximum_discount || 0),
          discount: Number(result.discount || 0),
        });
      },
      removeCoupon: () => setCoupon(null),
      isLoading: Boolean(productsLoading && lines.length > 0),
    };
  }, [lines, products, productsLoading, coupon, user, settingsData]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
