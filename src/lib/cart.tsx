//
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useProducts, type Product } from "@/lib/store";
import { useSession } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export type CartLine = { id: string; qty: number };

export type CartCoupon = { code: string; discount: number; id: string };

type CartContextValue = {
  lines: CartLine[];
  items: { product: Product; qty: number }[];
  count: number;
  subtotal: number;
  savings: number;
  total: number;
  coupon: CartCoupon | null;
  add: (id: string, qty?: number) => void;
  setQty: (id: string, qty: number) => void;
  remove: (id: string) => void;
  clear: () => void;
  applyCoupon: (code: string) => Promise<void>;
  removeCoupon: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);
const STORAGE_KEY = "zerah-cart";

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
    // Silent fail — localStorage is the primary store
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
      .select("product_id, quantity")
      .eq("cart_id", cart.id);

    if (!items || items.length === 0) return null;

    // Map product UUIDs back to slugs
    const lines: CartLine[] = [];
    for (const item of items) {
      const product = products.find((p) => p.uuid === item.product_id);
      if (product) {
        lines.push({ id: product.id, qty: item.quantity });
      }
    }
    return lines.length > 0 ? lines : null;
  } catch {
    return null;
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const { data: products } = useProducts();
  const { user } = useSession();
  const [hasLoadedFromDb, setHasLoadedFromDb] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setLines(JSON.parse(raw) as CartLine[]);
    } catch {
      /* ignore malformed storage */
    }
  }, []);

  // Reset DB load flag if user changes (e.g., logout then login as another user)
  useEffect(() => {
    setHasLoadedFromDb(false);
  }, [user?.id]);

  // On login: merge Supabase cart with localStorage cart
  useEffect(() => {
    if (!user || !products || products.length === 0 || hasLoadedFromDb) return;

    loadFromSupabase(user.id, products).then((dbLines) => {
      if (dbLines && dbLines.length > 0) {
        setLines((prev) => {
          // Merge: keep localStorage items, add DB items that aren't already present
          const merged = [...prev];
          for (const dbLine of dbLines) {
            if (!merged.find((l) => l.id === dbLine.id)) {
              merged.push(dbLine);
            }
          }
          return merged;
        });
      }
      setHasLoadedFromDb(true);
    });
  }, [user, products, hasLoadedFromDb]);

  // Persist to localStorage
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      /* ignore quota errors */
    }
  }, [lines]);

  // Sync to Supabase (debounced)
  useEffect(() => {
    if (!user || !products || products.length === 0) return;
    const timer = setTimeout(() => {
      syncToSupabase(user.id, lines, products);
    }, 1000); // Debounce 1 second
    return () => clearTimeout(timer);
  }, [lines, user, products]);

  const [coupon, setCoupon] = useState<CartCoupon | null>(null);

  const value = useMemo<CartContextValue>(() => {
    const list = products ?? [];
    const items = lines
      .map((line) => {
        const product = list.find((x) => x.id === line.id);
        if (!product) return null;
        const clampedQty = Math.min(line.qty, product.stock);
        return { product, qty: clampedQty };
      })
      .filter((x): x is { product: Product; qty: number } => x !== null && x.qty > 0);

    const subtotal = items.reduce((sum, i) => sum + i.product.price * i.qty, 0);
    const total = Math.max(0, subtotal - (coupon?.discount || 0));

    return {
      lines,
      items,
      count: items.reduce((sum, i) => sum + i.qty, 0),
      subtotal,
      savings: items.reduce(
        (sum, i) => sum + Math.max(0, i.product.mrp - i.product.price) * i.qty,
        0,
      ),
      total,
      coupon,
      add: (id, qty = 1) =>
        setLines((prev) => {
          const product = list.find((p) => p.id === id);
          if (!product) return prev;

          const existing = prev.find((l) => l.id === id);
          const requestedQty = (existing?.qty || 0) + qty;
          const finalQty = Math.min(requestedQty, product.stock);

          if (existing) {
            return prev.map((l) => (l.id === id ? { ...l, qty: finalQty } : l));
          }
          return [...prev, { id, qty: finalQty }];
        }),
      setQty: (id, qty) =>
        setLines((prev) => {
          const product = list.find((p) => p.id === id);
          if (!product) return prev;

          const finalQty = Math.min(qty, product.stock);
          return finalQty <= 0
            ? prev.filter((l) => l.id !== id)
            : prev.map((l) => (l.id === id ? { ...l, qty: finalQty } : l));
        }),
      remove: (id) => setLines((prev) => prev.filter((l) => l.id !== id)),
      clear: () => {
        setLines([]);
        setCoupon(null);
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
          error?: string;
        } | null;
        if (!result || !result.valid) {
          throw new Error(result?.error || "Invalid coupon");
        }
        setCoupon({ code: result.code!, discount: result.discount!, id: result.coupon_id! });
      },
      removeCoupon: () => setCoupon(null),
    };
  }, [lines, products, coupon, user]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
