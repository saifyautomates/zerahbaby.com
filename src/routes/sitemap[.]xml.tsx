//
import { createFileRoute } from "@tanstack/react-router";

const BASE_URL = "https://zerahkids.com";

const STATIC_PATHS: Array<{ path: string; priority: string; changefreq: string }> = [
  { path: "/", priority: "1.0", changefreq: "daily" },
  { path: "/shop", priority: "0.9", changefreq: "daily" },
  { path: "/about", priority: "0.6", changefreq: "monthly" },
  { path: "/contact", priority: "0.6", changefreq: "monthly" },
  { path: "/returns", priority: "0.4", changefreq: "yearly" },
  { path: "/shipping-delivery", priority: "0.4", changefreq: "yearly" },
  { path: "/cancellation-refund", priority: "0.4", changefreq: "yearly" },
  { path: "/terms-conditions", priority: "0.3", changefreq: "yearly" },
  { path: "/privacy-policy", priority: "0.3", changefreq: "yearly" },
  { path: "/cart", priority: "0.3", changefreq: "weekly" },
];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        let productUrls: string[] = [];
        try {
          // Safely access env vars across different platforms (Node/Vercel vs Vite/Cloudflare)
          const base =
            (typeof process !== "undefined" && process.env?.SUPABASE_URL) ||
            (typeof process !== "undefined" && process.env?.VITE_SUPABASE_URL) ||
            import.meta.env?.VITE_SUPABASE_URL;

          const key =
            (typeof process !== "undefined" && process.env?.SUPABASE_PUBLISHABLE_KEY) ||
            (typeof process !== "undefined" && process.env?.VITE_SUPABASE_PUBLISHABLE_KEY) ||
            import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY;

          if (base && key) {
            const [prodRes, catRes] = await Promise.all([
              fetch(
                `${base}/rest/v1/products?select=slug&is_active=eq.true&sales_channel=neq.OFFLINE_ONLY&limit=1000`,
                { headers: { apikey: key } },
              ),
              fetch(`${base}/rest/v1/categories?select=slug&limit=100`, {
                headers: { apikey: key },
              }),
            ]);

            if (prodRes.ok) {
              const rows = (await prodRes.json()) as Array<{ slug: string }>;
              productUrls = rows
                .filter((r) => r.slug && r.slug.trim())
                .map(
                  (r) =>
                    `<url><loc>${BASE_URL}/product/${encodeURIComponent(r.slug)}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`,
                );
            }
            if (catRes.ok) {
              const rows = (await catRes.json()) as Array<{ slug: string }>;
              const catUrls = rows
                .filter((r) => r.slug && r.slug.trim())
                .map(
                  (r) =>
                    `<url><loc>${BASE_URL}/shop?category=${encodeURIComponent(r.slug)}</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>`,
                );
              productUrls = [...catUrls, ...productUrls];
            }
          }
        } catch {
          productUrls = [];
        }

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${STATIC_PATHS.map(
  (p) =>
    `<url><loc>${BASE_URL}${p.path}</loc><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`,
).join("\n")}
${productUrls.join("\n")}
</urlset>`;

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
