import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import logo from "@/assets/zerah-logo-official.png";
import { Toaster } from "@/components/ui/sonner";
import { CartProvider } from "@/lib/cart";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { BottomNav } from "@/components/site/BottomNav";
import { OnboardingModal } from "@/components/site/OnboardingModal";
import { supabase } from "@/integrations/supabase/client";
import { Suspense } from "react";
import { safeLazy, isChunkLoadError } from "@/lib/safe-lazy";

const GlobalRealtimeSyncHost = safeLazy(() =>
  import("@/lib/realtime-sync").then((m) => ({ default: m.GlobalRealtimeSyncHost })),
);
const OfflineSyncHost = safeLazy(() =>
  import("@/lib/offline-sync-engine").then((m) => ({ default: m.OfflineSyncHost })),
);

import { AlertTriangle, RefreshCw } from "lucide-react";

function NotFoundComponent() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-primary-foreground transition-all hover:bg-primary/90 shadow-premium-sm"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error("[RootErrorComponent] Caught root route error:", error);

    if (typeof window !== "undefined" && isChunkLoadError(error)) {
      const key = "zerah_chunk_reload_lock";
      const last = parseInt(sessionStorage.getItem(key) || "0", 10);
      const now = Date.now();

      if (now - last > 20_000) {
        sessionStorage.setItem(key, now.toString());
        console.warn(
          "[RootErrorComponent] Detected stale chunk. Reloading page once for latest deployment...",
        );
        window.location.reload();
      }
    }
  }, [error]);

  return (
    <div className="flex min-h-[100dvh] w-full flex-col items-center justify-center bg-background p-6 antialiased">
      {/* Brand Skeleton Loading Screen */}
      <div className="w-full max-w-md space-y-6 text-center animate-in fade-in duration-300">
        <div className="flex justify-center">
          <div className="relative size-16 flex items-center justify-center rounded-2xl bg-card border border-border p-3 shadow-xs">
            <img
              loading="lazy"
              decoding="async"
              src={logo}
              alt="Zérah Baby & Kids"
              className="h-full w-auto object-contain animate-pulse"
            />
          </div>
        </div>

        {/* Pulse Skeleton Skeleton Bar Simulation */}
        <div className="space-y-3 pt-2">
          <div className="h-4 w-3/4 mx-auto rounded-full bg-muted animate-pulse" />
          <div className="h-3 w-1/2 mx-auto rounded-full bg-muted/60 animate-pulse" />
        </div>

        {/* Card skeleton placeholders */}
        <div className="grid grid-cols-2 gap-3 pt-2">
          <div className="h-20 rounded-2xl bg-muted/40 animate-pulse border border-border/40" />
          <div className="h-20 rounded-2xl bg-muted/40 animate-pulse border border-border/40" />
        </div>

        <div className="pt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            {error?.message || "An unexpected issue occurred while loading this view."}
          </p>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                try {
                  reset();
                } catch {
                  window.location.reload();
                }
              }}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-xs font-bold text-primary-foreground shadow-premium-sm transition-all hover:bg-primary/90 cursor-pointer"
            >
              <RefreshCw className="size-3.5" />
              Try again
            </button>
            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-6 py-2.5 text-xs font-bold text-foreground transition-all hover:bg-muted cursor-pointer"
            >
              Return Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Zérah Baby & Kids — Best Kids Store in Kota" },
      {
        name: "description",
        content:
          "Looking for a kids store near me in Kota? Zérah Baby & Kids offers the best organic baby clothing, safe toys, nursery care, and travel gear.",
      },
      {
        name: "keywords",
        content:
          "kids store in kota, baby shop near me, baby clothes kota, toys shop kota, Zérah Baby & Kids, baby gear",
      },
      { name: "author", content: "Zérah Baby & Kids" },
      {
        property: "og:title",
        content: "Zérah Baby & Kids — Best Kids Store in Kota",
      },
      {
        property: "og:description",
        content:
          "Looking for a kids store near me in Kota? Zérah Baby & Kids offers the best organic baby clothing, safe toys, nursery care, and travel gear.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://zerahkids.com" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@zerah_kids" },
      { property: "og:site_name", content: "Zérah Baby & Kids" },
      { property: "og:image", content: "https://zerahkids.com/logo.png" },
      { property: "og:image:secure_url", content: "https://zerahkids.com/logo.png" },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:width", content: "1024" },
      { property: "og:image:height", content: "1024" },
      { property: "og:image:alt", content: "Zérah Baby & Kids Logo" },
      { name: "twitter:image", content: "https://zerahkids.com/logo.png" },
      { name: "twitter:image:alt", content: "Zérah Baby & Kids Logo" },
      {
        name: "google-site-verification",
        content: "Gb8-IGMq85AIv7UMDmz6EOQ1XXBtR9vqXLnZVQFtP4k",
      },
      {
        name: "google-site-verification",
        content: "LMGRXFIKXaUzB14HSDoKn8SrBMcWTee6mpmGioA1RXo",
      },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify([
          {
            "@context": "https://schema.org",
            "@type": "Organization",
            name: "Zérah Baby & Kids",
            url: "https://zerahkids.com",
            logo: "https://zerahkids.com/logo.png",
            image: "https://zerahkids.com/logo.png",
            description:
              "Zérah Baby & Kids — Premium baby and kids clothing, safe toys, gear, and essentials.",
            email: "hello@zerahkids.com",
            telephone: "+919057074777",
            address: {
              "@type": "PostalAddress",
              streetAddress: "80 Feet Link Rd, near Bajot Restaurant, Atwal Nagar, Gordhanpura",
              addressLocality: "Kota",
              addressRegion: "Rajasthan",
              postalCode: "324001",
              addressCountry: "IN",
            },
            sameAs: ["https://www.instagram.com/zerah_kids/"],
          },
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "Zérah Baby & Kids",
            url: "https://zerahkids.com",
            potentialAction: {
              "@type": "SearchAction",
              target: "https://zerahkids.com/shop?q={search_term_string}",
              "query-input": "required name=search_term_string",
            },
          },
        ]),
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico?v=5" },
      { rel: "icon", type: "image/png", sizes: "48x48", href: "/favicon-48x48.png?v=5" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png?v=5" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png?v=5" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icon-192x192.png?v=5" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/icon-512x512.png?v=5" },
      { rel: "shortcut icon", href: "/favicon.ico?v=5" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png?v=5" },
      { rel: "manifest", href: "/site.webmanifest?v=5" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700;800&family=Nunito:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=window.location.pathname;var t=localStorage.getItem("zerah-theme");if(p.startsWith("/admin")&&(t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches))){document.documentElement.classList.add("dark");}else{document.documentElement.classList.remove("dark");}}catch(e){}})();`,
          }}
        />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

import { trackEvent } from "@/lib/analytics";
import { initGlobalBarcodeScanner } from "@/lib/barcode-scanner";
import { useSettings } from "@/lib/store";
import { MaintenanceScreen } from "@/components/site/MaintenanceScreen";

const DirectLabelPrintHost = safeLazy(() =>
  import("@/components/admin/LabelPrintEngine").then((m) => ({ default: m.DirectLabelPrintHost })),
);

function MaintenanceGuard({
  children,
  isAdminRoute,
}: {
  children: ReactNode;
  isAdminRoute: boolean;
}) {
  const { data: settings, isLoading } = useSettings();
  const [bypass, setBypass] = useState(false);

  useEffect(() => {
    let typed = "";
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.length !== 1) return; // ignore shift, capslock, etc
      typed += e.key.toLowerCase();
      if (typed.length > 4) typed = typed.slice(-4);
      if (typed === "saif") {
        setBypass(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (isAdminRoute || isLoading || bypass) return <>{children}</>;

  if (settings?.maintenance_mode === "true") {
    return <MaintenanceScreen onBypass={() => setBypass(true)} />;
  }

  return <>{children}</>;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const location = router.state.location;
  const isAdminRoute = location.pathname.startsWith("/admin");

  useEffect(() => {
    // Global barcode scanner listener: navigate to admin POS if scanned anywhere on the website
    const unbindScanner = initGlobalBarcodeScanner((_code) => {
      localStorage.setItem("zerah_admin_active_tab", "billing");
      localStorage.setItem("zerah_admin_active_subtab", "pos");
      if (!location.pathname.startsWith("/admin")) {
        router.navigate({ to: "/admin", search: { tab: "billing", subtab: "pos" } });
      }
    });
    return unbindScanner;
  }, [location.pathname, router]);

  // Live real-time page browsing tracking for non-admin storefront visits
  useEffect(() => {
    if (!isAdminRoute && typeof window !== "undefined") {
      trackEvent("page_view", {
        metadata: {
          path: location.pathname,
          search: location.searchStr || "",
          title: typeof document !== "undefined" ? document.title : "",
        },
      });
    }
  }, [location.pathname, isAdminRoute]);

  useEffect(() => {
    // Global handler for stale dynamic module imports / chunk load failures
    const handleChunkError = (event: ErrorEvent | PromiseRejectionEvent) => {
      const errorMsg =
        event instanceof ErrorEvent
          ? event.message || event.error?.message || ""
          : (event.reason as Error)?.message || String(event.reason || "");

      if (
        errorMsg.includes("Failed to fetch dynamically imported module") ||
        errorMsg.includes("Importing a module script failed") ||
        errorMsg.includes("error loading dynamically imported module") ||
        errorMsg.includes("Loading chunk")
      ) {
        const key = "zerah_auto_reload_chunk";
        const lastReload = parseInt(sessionStorage.getItem(key) || "0", 10);
        const now = Date.now();
        if (now - lastReload > 8000) {
          sessionStorage.setItem(key, now.toString());
          window.location.reload();
        }
      }
    };

    window.addEventListener("error", handleChunkError);
    window.addEventListener("unhandledrejection", handleChunkError);
    return () => {
      window.removeEventListener("error", handleChunkError);
      window.removeEventListener("unhandledrejection", handleChunkError);
    };
  }, []);

  useEffect(() => {
    // Force light mode on all non-admin routes
    if (!isAdminRoute) {
      document.documentElement.classList.remove("dark");
    }
  }, [isAdminRoute]);

  useEffect(() => {
    // Visitor Analytics Tracking (only on production domain, never on localhost/development)
    const trackVisitor = async () => {
      // Don't track admin pages, local environments, or if already tracked in this session
      if (
        typeof window === "undefined" ||
        isAdminRoute ||
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        sessionStorage.getItem("visitor_tracked")
      )
        return;

      try {
        sessionStorage.setItem("visitor_tracked", "true");
        const sessionId = sessionStorage.getItem("visitor_session_id") ?? crypto.randomUUID();
        sessionStorage.setItem("visitor_session_id", sessionId);

        let city = null;
        let region = null;
        let country = "India";
        let customer_name = null;

        // Fetch location data (CORS-safe with 3s timeout)
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000);
          const res = await fetch("https://ipwho.is/", {
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          if (res.ok) {
            const data = await res.json();
            if (data.success !== false) {
              city = data.city || null;
              region = data.region || null;
              country = data.country || "India";
            }
          }
        } catch {
          // Graceful fallback to default country
        }

        // Fetch user data if logged in
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (session?.user) {
            const user = session.user;
            customer_name =
              user.user_metadata?.full_name || user.user_metadata?.name || user.email || null;
          }
        } catch (e) {
          // ignore auth errors
        }

        // Safely record visitor without throwing on external IP service failure
        await supabase.from("website_visitors").insert({
          session_id: sessionId,
          city,
          region,
          country,
          customer_name,
        });
      } catch (error) {
        // Silent fail for analytics
      }
    };

    trackVisitor();
  }, [isAdminRoute]);

  return (
    <QueryClientProvider client={queryClient}>
      <CartProvider>
        <MaintenanceGuard isAdminRoute={isAdminRoute}>
          <div className="flex min-h-[100dvh] w-full flex-col relative">
            {!isAdminRoute && <Header />}
            <main id="main" className="flex-1 fade-in-soft bg-muted/20 min-w-0">
              {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
              <Outlet />
            </main>
            {!isAdminRoute && <Footer />}
            {!isAdminRoute && <BottomNav />}
          </div>
        </MaintenanceGuard>
        <Toaster />
        <Suspense fallback={null}>
          <GlobalRealtimeSyncHost />
          {isAdminRoute && <DirectLabelPrintHost />}
          {isAdminRoute && <OfflineSyncHost />}
        </Suspense>
        <OnboardingModal />
      </CartProvider>
    </QueryClientProvider>
  );
}
