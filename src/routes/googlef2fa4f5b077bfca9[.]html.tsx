import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/googlef2fa4f5b077bfca9.html")({
  server: {
    handlers: {
      GET: async () => {
        return new Response("google-site-verification: googlef2fa4f5b077bfca9.html", {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
          },
        });
      },
    },
  },
});
