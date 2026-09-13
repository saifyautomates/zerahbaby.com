import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  vite: {
    // Keep environment variable values available for client & SSR bundles
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
        process.env["VITE_SUPABASE_URL"] ||
          process.env["SUPABASE_URL"] ||
          "https://wbbatgbvizhghtkvuguf.supabase.co",
      ),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
        process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
          process.env["SUPABASE_PUBLISHABLE_KEY"] ||
          "sb_publishable_WiczJQTx4afGJ02WAiUIUw_8YlWjkSP",
      ),
    },
    build: {
      chunkSizeWarningLimit: 2000,
      rollupOptions: {
        output: {
          manualChunks: (id: string): string | undefined => {
            // Supabase client — large, changes rarely → own chunk
            if (id.includes("@supabase")) return "supabase";
            // Tanstack query + router — framework, rarely changes
            if (id.includes("@tanstack")) return "tanstack";
            // Lucide icons — large icon set
            if (id.includes("lucide-react")) return "icons";
            // React core
            if (id.includes("/node_modules/react/") || id.includes("/node_modules/react-dom/"))
              return "react";
            // Radix UI primitives + Sonner toast
            if (id.includes("@radix-ui") || id.includes("sonner")) return "ui";
            return undefined;
          },
        },
      },
    },
    resolve: {
      tsconfigPaths: true,
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
