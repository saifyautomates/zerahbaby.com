//
import { createFileRoute } from "@tanstack/react-router";

const STATIC_PATHS: Array<{ path: string; priority: string; changefreq: string }> = [
  { path: "/", priority: "1.0", changefreq: "daily" },
  { path: "/shop", priority: "0.9", changefreq: "daily" },
  { path: "/about", priority: "0.6", changefreq: "monthly" },
  { path: "/contact", priority: "0.6", changefreq: "monthly" },
  { path: "/cart", priority: "0.3", changefreq: "weekly" },
];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        const today = new Date().toISOString().slice(0, 10);

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
            const res = await fetch(
              `${base}/rest/v1/products?select=slug&is_active=eq.true&limit=1000`,
              {
                headers: { apikey: key },
              },
            );
            if (res.ok) {
              const rows = (await res.json()) as Array<{ slug: string }>;
              productUrls = rows
                .filter((r) => r.slug && r.slug.trim())
                .map(
                  (r) =>
                    `<url><loc>${origin}/product/${encodeURIComponent(r.slug)}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`,
                );
            }
          }
        } catch {
          productUrls = [];
        }

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${STATIC_PATHS.map(
  (p) =>
    `<url><loc>${origin}${p.path}</loc><lastmod>${today}</lastmod><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`,
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
