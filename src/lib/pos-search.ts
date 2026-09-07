import { supabase } from "@/integrations/supabase/client";
import { getCachedCatalog } from "@/lib/offline-sync-engine";

export interface POSSearchVariant {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  stock: number;
  price: number;
  mrp: number;
  color: string | null;
  size: string | null;
  image_url: string | null;
  is_matched: boolean;
}

export interface POSSearchResult {
  id: string;
  slug: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  mrp: number;
  stock: number;
  sku: string;
  barcode: string;
  image_url: string | null;
  sales_channel: string;
  is_active: boolean;
  match_score: number;
  matched_variant_id: string | null;
  matched_reason: string;
  variants: POSSearchVariant[];
}

/**
 * High-performance server-side product and variant search for POS Terminal.
 * Leverages pg_trgm fuzzy matching, multi-word matching, and 5-tier priority ranking.
 */
export async function searchPOSProducts(query: string, limit = 20): Promise<POSSearchResult[]> {
  const clean = query.trim();
  if (!clean) return [];

  // 1. Try server-side PostgreSQL search RPC
  const isOnline = typeof navigator === "undefined" || navigator.onLine !== false;
  if (isOnline) {
    try {
      const { data, error } = await (supabase.rpc as any)("pos_search_products", {
        _query: clean,
        _limit: limit,
      });

      if (!error && Array.isArray(data)) {
        return (data as POSSearchResult[]).map((r) => ({
          ...r,
          price: Number(r.price),
          mrp: Number(r.mrp),
          stock: Number(r.stock),
          variants: (r.variants || []).map((v) => ({
            ...v,
            price: Number(v.price),
            mrp: Number(v.mrp),
            stock: Number(v.stock),
          })),
        }));
      }

      if (error) {
        console.warn("[pos-search] RPC notice, falling back to client search:", error.message);
      }
    } catch (netErr) {
      console.warn("[pos-search] Network error, attempting offline cache fallback:", netErr);
    }
  }

  // 2. Offline IndexedDB Fallback
  try {
    const cached = await getCachedCatalog();
    if (cached && cached.length > 0) {
      const qLower = clean.toLowerCase();
      const qCompact = qLower.replace(/[\s\-_]+/g, "");
      const terms = qLower.split(/\s+/).filter(Boolean);

      const scored = cached
        .map((p: any) => {
          const nameLower = (p.name || "").toLowerCase();
          const skuLower = (p.sku || "").toLowerCase();
          const barcode = String(p.barcode || "");
          const brandLower = (p.brand || "").toLowerCase();
          const categoryLower = (p.category || "").toLowerCase();

          const variants: POSSearchVariant[] = (p.variants || p.product_variants || []).map(
            (v: any) => ({
              id: v.id,
              name: v.name || "Default",
              sku: v.sku || p.sku,
              barcode: v.barcode || null,
              stock: Number(v.stock ?? p.stock ?? 0),
              price: Number(v.price_override ?? v.priceOverride ?? p.price ?? 0),
              mrp: Number(v.mrp_override ?? v.mrpOverride ?? p.mrp ?? p.price ?? 0),
              color: v.color || null,
              size: v.size || null,
              image_url: v.image_url || v.imageUrl || p.image || null,
              is_matched: false,
            }),
          );

          let score = 0;
          let matchedVariantId: string | null = null;
          let reason = "Partial Match";

          // Exact barcode
          if (barcode === clean || variants.some((v) => v.barcode === clean)) {
            score = 100;
            reason = "Exact Barcode";
            const mv = variants.find((v) => v.barcode === clean);
            if (mv) matchedVariantId = mv.id;
          }
          // Exact SKU
          else if (skuLower === qLower || variants.some((v) => v.sku.toLowerCase() === qLower)) {
            score = 90;
            reason = "Exact SKU";
            const mv = variants.find((v) => v.sku.toLowerCase() === qLower);
            if (mv) matchedVariantId = mv.id;
          }
          // Compact code match
          else if (
            skuLower.replace(/[\s\-_]+/g, "") === qCompact ||
            variants.some((v) => v.sku.toLowerCase().replace(/[\s\-_]+/g, "") === qCompact)
          ) {
            score = 80;
            reason = "SKU Code";
            const mv = variants.find(
              (v) => v.sku.toLowerCase().replace(/[\s\-_]+/g, "") === qCompact,
            );
            if (mv) matchedVariantId = mv.id;
          }
          // Exact Name
          else if (nameLower === qLower) {
            score = 75;
            reason = "Exact Name";
          }
          // Name Prefix
          else if (nameLower.startsWith(qLower)) {
            score = 70;
            reason = "Name Prefix";
          }
          // All terms match
          else if (
            terms.length > 1 &&
            terms.every(
              (t) => nameLower.includes(t) || brandLower.includes(t) || categoryLower.includes(t),
            )
          ) {
            score = 65;
            reason = "Multi-word Match";
          }
          // Substring match in name or SKU
          else if (nameLower.includes(qLower) || skuLower.includes(qLower)) {
            score = 55;
            reason = "Partial Name";
          }
          // Variant attribute match
          else if (
            variants.some(
              (v) =>
                (v.color && v.color.toLowerCase().includes(qLower)) ||
                (v.name && v.name.toLowerCase().includes(qLower)),
            )
          ) {
            score = 50;
            reason = "Variant Attribute";
            const mv = variants.find(
              (v) =>
                (v.color && v.color.toLowerCase().includes(qLower)) ||
                (v.name && v.name.toLowerCase().includes(qLower)),
            );
            if (mv) matchedVariantId = mv.id;
          }
          // Typo normalization: double letter collapse (e.g. tshirrt <-> tshirt)
          else if (
            nameLower.replace(/([a-z])\1+/g, "$1").includes(qLower.replace(/([a-z])\1+/g, "$1")) ||
            qLower.replace(/([a-z])\1+/g, "$1").includes(nameLower.replace(/([a-z])\1+/g, "$1"))
          ) {
            score = 45;
            reason = "Fuzzy Name";
          }

          if (score === 0) return null;

          return {
            id: p.id || p.uuid,
            slug: p.slug || p.id,
            name: p.name,
            brand: p.brand || "Zérah Baby & Kids",
            category: p.category || "Clothing",
            price: Number(p.price || 0),
            mrp: Number(p.mrp || p.price || 0),
            stock: Number(p.stock || 0),
            sku: p.sku || "",
            barcode: p.barcode || "",
            image_url: p.image || p.imageUrl || null,
            sales_channel: p.sales_channel || p.salesChannel || "ONLINE_AND_OFFLINE",
            is_active: p.is_active ?? p.isActive ?? true,
            match_score: score,
            matched_variant_id: matchedVariantId,
            matched_reason: reason,
            variants: variants.map((v) => ({
              ...v,
              is_matched: v.id === matchedVariantId,
            })),
          } as POSSearchResult;
        })
        .filter(Boolean) as POSSearchResult[];

      scored.sort((a, b) => b.match_score - a.match_score || (b.stock > 0 ? 1 : -1));
      return scored.slice(0, limit);
    }
  } catch (offlineErr) {
    console.warn("[pos-search] Offline catalog search failed:", offlineErr);
  }

  return [];
}
