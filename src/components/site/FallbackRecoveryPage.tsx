import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Search,
  ShoppingBag,
  ArrowRight,
  ArrowLeft,
  Home,
  Sparkles,
  RotateCcw,
  ShieldCheck,
  Truck,
  Compass,
} from "lucide-react";
import logo from "@/assets/zerah-logo-official.png";
import { BrandName } from "@/components/site/BrandName";
import { resolveUrlPath } from "@/lib/route-resolver";

export function FallbackRecoveryPage() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [attemptedAutoRoute, setAttemptedAutoRoute] = useState(false);

  // Client-side automatic path recovery for direct URL hits or unexpected route misses
  useEffect(() => {
    if (typeof window === "undefined" || attemptedAutoRoute) return;
    setAttemptedAutoRoute(true);

    try {
      const searchObj: Record<string, string> = {};
      new URLSearchParams(window.location.search).forEach((v, k) => {
        searchObj[k] = v;
      });

      const resolved = resolveUrlPath(window.location.pathname, searchObj);
      if (resolved) {
        if (resolved.params && resolved.to === "/product/$id") {
          (navigate as any)({
            to: "/product/$id",
            params: { id: resolved.params.id || "" },
            search: resolved.search,
            replace: true,
          });
          return;
        }
        (navigate as any)({
          to: resolved.to,
          search: resolved.search,
          replace: true,
        });
      }
    } catch {
      // Graceful fallback to rich recovery UI
    }
  }, [navigate, attemptedAutoRoute]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchTerm.trim();
    if (!q) {
      navigate({ to: "/shop" });
      return;
    }
    navigate({
      to: "/shop",
      search: { q },
    });
  };

  const popularPills = [
    { label: "All Products", to: "/shop", search: {} },
    { label: "Clothing", to: "/shop", search: { category: "clothing" } },
    { label: "Wooden Toys", to: "/shop", search: { category: "toys" } },
    { label: "Nursery & Care", to: "/shop", search: { category: "nursery-care" } },
    { label: "Travel & Gear", to: "/shop", search: { category: "travel-gear" } },
  ];

  return (
    <div className="flex min-h-[85vh] w-full flex-col items-center justify-center bg-background px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-xl text-center">
        {/* Brand Icon */}
        <div className="mx-auto mb-6 flex size-16 sm:size-20 items-center justify-center rounded-3xl bg-primary/10 border border-primary/20 shadow-premium-sm transition-transform hover:scale-105">
          <img
            src={logo}
            alt="Zérah Baby & Kids"
            className="size-10 sm:size-12 object-contain drop-shadow-xs"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>

        {/* Heading */}
        <div className="inline-flex items-center gap-1.5 rounded-full bg-muted/80 px-3 py-1 text-xs font-semibold text-muted-foreground mb-3 border border-border/60">
          <Compass className="size-3.5 text-primary" />
          <span>Navigation Guide</span>
        </div>

        <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-foreground">
          Looking for something special?
        </h1>
        <p className="mx-auto mt-2.5 max-w-md text-xs sm:text-sm text-muted-foreground leading-relaxed">
          The page you requested may have moved or been updated. Search our collection or jump
          straight to what you need below.
        </p>

        {/* Quick Search Box */}
        <form onSubmit={handleSearchSubmit} className="mt-6 w-full relative">
          <div className="relative flex items-center">
            <Search className="absolute left-4 size-4 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search clothes, safe toys, diapers, gear…"
              aria-label="Search catalog"
              className="w-full rounded-full border border-border bg-card py-3 pl-11 pr-24 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground shadow-xs outline-none transition-all focus:border-primary focus:ring-4 focus:ring-primary/15"
            />
            <button
              type="submit"
              className="absolute right-1.5 rounded-full bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-xs transition hover:bg-primary/90 cursor-pointer"
            >
              Search
            </button>
          </div>
        </form>

        {/* Popular Category Chips */}
        <div className="mt-5">
          <span className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
            Popular Collections
          </span>
          <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
            {popularPills.map((pill) => (
              <Link
                key={pill.label}
                to={pill.to as any}
                search={pill.search as any}
                className="rounded-full border border-border/80 bg-card px-3.5 py-1.5 text-xs font-semibold text-foreground transition-all hover:border-primary hover:bg-primary hover:text-primary-foreground shadow-2xs"
              >
                {pill.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Main Action Buttons */}
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/shop"
            search={{}}
            className="flex w-full sm:w-auto items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-xs sm:text-sm font-bold text-primary-foreground shadow-premium-sm transition hover:bg-primary/90"
          >
            <ShoppingBag className="size-4" />
            <span>Explore All Products</span>
          </Link>

          <Link
            to="/orders"
            className="flex w-full sm:w-auto items-center justify-center gap-2 rounded-full border border-border bg-card px-5 py-3 text-xs sm:text-sm font-bold text-foreground transition hover:bg-muted shadow-2xs"
          >
            <span>Track Orders</span>
          </Link>

          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined" && window.history.length > 1) {
                window.history.back();
              } else {
                navigate({ to: "/" });
              }
            }}
            className="flex w-full sm:w-auto items-center justify-center gap-2 rounded-full border border-transparent px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition cursor-pointer"
          >
            <ArrowLeft className="size-3.5" />
            <span>Go Back</span>
          </button>
        </div>

        {/* Brand Assurance Perks */}
        <div className="mt-10 pt-6 border-t border-border/50 grid grid-cols-3 gap-2 text-center text-muted-foreground">
          <div className="flex flex-col items-center gap-1">
            <Truck className="size-4 text-primary" />
            <span className="text-[10px] sm:text-xs font-semibold">Pan-India Delivery</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <RotateCcw className="size-4 text-primary" />
            <span className="text-[10px] sm:text-xs font-semibold">7-Day Easy Returns</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <ShieldCheck className="size-4 text-primary" />
            <span className="text-[10px] sm:text-xs font-semibold">100% Baby Safe</span>
          </div>
        </div>
      </div>
    </div>
  );
}
