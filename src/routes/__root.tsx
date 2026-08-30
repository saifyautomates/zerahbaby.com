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
      { title: "Zerah Baby And Kid's — Best Kids Store in Kota" },
      {
        name: "description",
        content:
          "Looking for a kids store near me in Kota? Zerah Baby And Kid's offers the best organic baby clothing, safe toys, nursery care, and travel gear.",
      },
      {
        name: "keywords",
        content:
          "kids store in kota, baby shop near me, baby clothes kota, toys shop kota, zerah Baby And Kid's, baby gear",
      },
      { name: "author", content: "Zerah Baby And Kid's" },
      {
        property: "og:title",
        content: "Zerah Baby And Kid's — Best Kids Store in Kota",
      },
      {
        property: "og:description",
        content:
          "Looking for a kids store near me in Kota? Zerah Baby And Kid's offers the best organic baby clothing, safe toys, nursery care, and travel gear.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@zerah_kids" },
      { property: "og:site_name", content: "Zerah Baby And Kid's" },
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
            name: "Zerah Baby And Kid's",
            url: "https://zerahkids.com",
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
            name: "Zerah Baby And Kid's",
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
      { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
      { rel: "icon", type: "image/png", href: "/favicon.png", sizes: "32x32" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
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

        // Fetch location data
        try {
          const res = await fetch("https://ipapi.co/json/");
          if (res.ok) {
            const data = await res.json();
            city = data.city;
            region = data.region;
            country = data.country_name || "India";
          }
        } catch (e) {
          // ignore ip fetch errors
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
          <div className="flex min-h-[100dvh] w-full flex-col overflow-x-hidden relative isolate pb-[72px] md:pb-0">
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
