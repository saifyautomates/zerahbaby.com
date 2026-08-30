import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/google9046c9669db277c7.html")({
  server: {
    handlers: {
      GET: async () => {
        return new Response("google-site-verification: google9046c9669db277c7.html", {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
          },
        });
      },
    },
  },
});
