//
import { createFileRoute } from "@tanstack/react-router";

const BASE_URL = "https://zerahkids.com";

const STATIC_PATHS: Array<{ path: string; priority: string; changefreq: string }> = [
  { path: "/", priority: "1.0", changefreq: "daily" },
  { path: "/shop", priority: "0.9", changefreq: "daily" },
  { path: "/categories", priority: "0.8", changefreq: "weekly" },
  { path: "/about", priority: "0.6", changefreq: "monthly" },
  { path: "/contact", priority: "0.6", changefreq: "monthly" },
  { path: "/returns", priority: "0.5", changefreq: "monthly" },
  { path: "/shipping-delivery", priority: "0.5", changefreq: "monthly" },
  { path: "/cancellation-refund", priority: "0.5", changefreq: "monthly" },
  { path: "/terms-conditions", priority: "0.3", changefreq: "yearly" },
  { path: "/privacy-policy", priority: "0.3", changefreq: "yearly" },
];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        let dynamicUrls: string[] = [];
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
                `${base}/rest/v1/products?select=id,slug,name,image,image_url,updated_at&is_active=eq.true&sales_channel=neq.OFFLINE_ONLY&limit=1000`,
                { headers: { apikey: key } },
              ),
              fetch(`${base}/rest/v1/categories?select=slug,name&limit=100`, {
                headers: { apikey: key },
              }),
            ]);

            if (catRes.ok) {
              const catRows = (await catRes.json()) as Array<{ slug: string; name?: string }>;
              const catUrls = catRows
                .filter((r) => r.slug && r.slug.trim())
                .map(
                  (r) =>
                    `<url><loc>${BASE_URL}/shop?category=${encodeURIComponent(r.slug)}</loc><changefreq>daily</changefreq><priority>0.85</priority></url>`,
                );
              dynamicUrls.push(...catUrls);
            }

            if (prodRes.ok) {
              const prodRows = (await prodRes.json()) as Array<{
                id?: string;
                slug?: string;
                name?: string;
                image?: string;
                image_url?: string;
                updated_at?: string;
              }>;
              const prodUrls = prodRows
                .filter((r) => (r.slug || r.id) && (r.slug || r.id)!.trim())
                .map((r) => {
                  const targetSlug = r.slug || r.id;
                  const img = r.image_url || r.image;
                  const hasHttpImg = img && typeof img === "string" && img.startsWith("http");
                  const lastMod = r.updated_at
                    ? `<lastmod>${new Date(r.updated_at).toISOString().split("T")[0]}</lastmod>`
                    : "";
                  const imageXml = hasHttpImg
                    ? `<image:image><image:loc>${img.replace(/&/g, "&amp;")}</image:loc><image:title>${(r.name || "Product").replace(/&/g, "&amp;")}</image:title></image:image>`
                    : "";
                  return `<url><loc>${BASE_URL}/product/${encodeURIComponent(targetSlug!)}</loc>${lastMod}<changefreq>weekly</changefreq><priority>0.8</priority>${imageXml}</url>`;
                });
              dynamicUrls.push(...prodUrls);
            }
          }
        } catch {
          dynamicUrls = [];
        }

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${STATIC_PATHS.map(
  (p) =>
    `<url><loc>${BASE_URL}${p.path}</loc><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`,
).join("\n")}
${dynamicUrls.join("\n")}
</urlset>`;

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
