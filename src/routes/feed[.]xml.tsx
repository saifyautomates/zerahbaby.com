import { createFileRoute } from "@tanstack/react-router";
import { buildGoogleShoppingXml } from "@/lib/seo";
import type { Product } from "@/domain/models";

export const Route = createFileRoute("/feed.xml")({
  server: {
    handlers: {
      GET: async () => {
        let products: Product[] = [];
        try {
          const base =
            (typeof process !== "undefined" && process.env?.SUPABASE_URL) ||
            (typeof process !== "undefined" && process.env?.VITE_SUPABASE_URL) ||
            import.meta.env?.VITE_SUPABASE_URL;

          const key =
            (typeof process !== "undefined" && process.env?.SUPABASE_PUBLISHABLE_KEY) ||
            (typeof process !== "undefined" && process.env?.VITE_SUPABASE_PUBLISHABLE_KEY) ||
            import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY;

          if (base && key) {
            const res = await fetch(
              `${base}/rest/v1/products?select=*,variants:product_variants(*)&is_active=eq.true&sales_channel=neq.OFFLINE_ONLY&limit=1000`,
              { headers: { apikey: key } },
            );
            if (res.ok) {
              const rows = await res.json();
              products = rows.map((r: Record<string, unknown>) => ({
                uuid: (r.id as string) || "",
                id: (r.slug as string) || (r.id as string) || "",
                name: (r.name as string) || "",
                brand: (r.brand as string) || "Zérah Baby & Kids",
                category: (r.category as string) || "General",
                price: Number(r.price) || 0,
                mrp: Number(r.mrp) || Number(r.price) || 0,
                rating: Number(r.rating) || 0,
                reviews: Number(r.reviews_count || r.reviews) || 0,
                ageGroup: (r.age_group as string) || "",
                image: (r.image_url as string) || (r.image as string) || "",
                imageUrl: (r.image_url as string) || null,
                description: (r.description as string) || "",
                highlights: Array.isArray(r.highlights) ? (r.highlights as string[]) : [],
                isFeatured: Boolean(r.is_featured),
                isActive: Boolean(r.is_active),
                sortOrder: Number(r.sort_order) || 0,
                stock: Number(r.stock) || 0,
                lowStockAt: Number(r.low_stock_threshold || r.lowStockAt) || 2,
                sku: (r.sku as string) || (r.slug as string) || "",
                barcode: (r.barcode as string) || "",
                images: Array.isArray(r.images) ? (r.images as string[]) : [],
                salesChannel: ((r.sales_channel as string) || "ONLINE_AND_OFFLINE") as
                  | "ONLINE_AND_OFFLINE"
                  | "OFFLINE_ONLY",
                sales_channel: ((r.sales_channel as string) || "ONLINE_AND_OFFLINE") as
                  | "ONLINE_AND_OFFLINE"
                  | "OFFLINE_ONLY",
                variants: Array.isArray(r.variants)
                  ? r.variants.map((v: Record<string, unknown>) => ({
                      id: (v.id as string) || "",
                      name: (v.name as string) || "",
                      color: (v.color as string) || null,
                      size: (v.size as string) || null,
                      sku: (v.sku as string) || (v.id as string) || "",
                      barcode: (v.barcode as string) || null,
                      stock: Number(v.stock) || 0,
                      priceOverride: v.price_override !== undefined && v.price_override !== null ? Number(v.price_override) : undefined,
                      mrpOverride: v.mrp_override !== undefined && v.mrp_override !== null ? Number(v.mrp_override) : undefined,
                      imageUrl: (v.image_url as string) || null,
                    }))
                  : [],
              }));
            }
          }
        } catch {
          products = [];
        }

        const xml = buildGoogleShoppingXml(products);

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600, s-maxage=3600",
          },
        });
      },
    },
  },
});
