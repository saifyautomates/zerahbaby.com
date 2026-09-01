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
import { Toaster } from "@/components/ui/sonner";
import { CartProvider } from "@/lib/cart";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { BottomNav } from "@/components/site/BottomNav";
import { OnboardingModal } from "@/components/site/OnboardingModal";
import { SplashScreen } from "@/components/site/SplashScreen";
import { supabase } from "@/integrations/supabase/client";
import { lazy, Suspense } from "react";

const GlobalRealtimeSyncHost = lazy(() =>
  import("@/lib/realtime-sync").then((m) => ({ default: m.GlobalRealtimeSyncHost })),
);
const OfflineSyncHost = lazy(() =>
  import("@/lib/offline-sync-engine").then((m) => ({ default: m.OfflineSyncHost })),
);

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
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
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

const DirectLabelPrintHost = lazy(() =>
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
    // Global barcode scanner listener: navigate to admin POS if scanned anywhere
    const unbindScanner = initGlobalBarcodeScanner((_code) => {
      if (!location.pathname.startsWith("/admin")) {
        router.navigate({ to: "/admin" });
      }
    });
    return unbindScanner;
  }, [location.pathname, router]);

  useEffect(() => {
    // Force light mode on all non-admin routes
    if (!isAdminRoute) {
      document.documentElement.classList.remove("dark");
    }
  }, [isAdminRoute]);

  useEffect(() => {
    // Visitor Analytics Tracking
    const trackVisitor = async () => {
      // Don't track admin pages or if already tracked in this session
      if (
        typeof window === "undefined" ||
        isAdminRoute ||
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
          <DirectLabelPrintHost />
          <GlobalRealtimeSyncHost />
          <OfflineSyncHost />
        </Suspense>
        <OnboardingModal />
        <SplashScreen />
      </CartProvider>
    </QueryClientProvider>
  );
}
