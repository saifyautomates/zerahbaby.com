//
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Menu,
  Search,
  ShoppingCart,
  Heart,
  User,
  LayoutDashboard,
  ShieldCheck,
  Truck,
  Sparkle,
  BadgeCheck,
} from "lucide-react";
import { useState } from "react";
import logo from "@/assets/zerah-logo.jpg";
import { ageGroups, useCategories, useSettings } from "@/lib/store";
import { useCart } from "@/lib/cart";
import { useSession } from "@/lib/auth";
import { useAdminMode } from "@/lib/admin-mode";
import { useWishlist } from "@/lib/wishlist";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";

export function Header() {
  const { count } = useCart();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [term, setTerm] = useState("");
  const navigate = useNavigate();
  const { data: categories } = useCategories();
  const { brandName, announcement } = useSettings();
  const { user } = useSession();
  const { isAdmin, adminMode, toggleAdminMode } = useAdminMode();
  const { productIds: wishlistIds } = useWishlist();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = term.trim();
    setOpen(false);
    setSearchOpen(false);
    navigate({ to: "/shop", search: q ? { q } : {} });
  }

  return (
    <header className="sticky top-0 z-50 w-full">
      <a
        href="#main"
        className="focus-ring sr-only z-[70] focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      <div className="announce-bar">
        <span className="announce-sheen" aria-hidden />
        <div className="relative z-[3] mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-1.5">
          {/* Desktop left trust badge */}
          <div className="hidden flex-1 items-center gap-2 lg:flex">
            <span className="announce-pill">
              <Truck className="size-3 announce-gold-text" aria-hidden />
              Pan-India shipping
            </span>
          </div>

          {/* Center announcement — marquee on mobile, static on desktop */}
          <div className="flex flex-1 items-center justify-center overflow-hidden lg:flex-none lg:shrink-0">
            <p className="hidden items-center justify-center gap-2 text-center sm:gap-3 lg:flex">
              <Sparkle className="size-3 shrink-0 announce-gold-text" aria-hidden />
              <span className="font-display text-[11px] font-semibold uppercase tracking-widest text-[var(--announce-foreground)]">
                {announcement}
              </span>
              <Sparkle className="size-3 shrink-0 announce-gold-text" aria-hidden />
            </p>
            <div className="group relative w-full lg:hidden" aria-label="Announcement">
              <div className="announce-marquee group-hover:announce-marquee-pause whitespace-nowrap">
                <span className="inline-flex items-center gap-2 px-4 font-display text-[10px] font-semibold uppercase tracking-widest text-[var(--announce-foreground)] whitespace-nowrap">
                  <Sparkle className="size-2.5 shrink-0 announce-gold-text" aria-hidden />
                  {announcement}
                  <Sparkle className="size-2.5 shrink-0 announce-gold-text" aria-hidden />
                </span>
                <span className="inline-flex items-center gap-2 px-4 font-display text-[10px] font-semibold uppercase tracking-widest text-[var(--announce-foreground)] whitespace-nowrap">
                  <Sparkle className="size-2.5 shrink-0 announce-gold-text" aria-hidden />
                  {announcement}
                  <Sparkle className="size-2.5 shrink-0 announce-gold-text" aria-hidden />
                </span>
              </div>
            </div>
          </div>

          <div className="hidden flex-1 items-center justify-end gap-2 lg:flex"></div>
        </div>
      </div>

      <div className="border-b border-border glass-header">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2.5 sm:gap-4 sm:px-4 sm:py-3">
          <button
            className="focus-ring -ml-1 rounded-md p-2 text-foreground transition hover:bg-muted md:hidden"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <Menu className="size-5" />
          </button>

          <Link
            to="/"
            className="focus-ring press flex min-w-0 items-center gap-2 rounded-lg transition-transform duration-200 hover:-translate-y-0.5"
          >
            <img
              src={logo}
              alt={`${brandName} logo`}
              width={40}
              height={40}
              className="size-8 object-contain sm:size-10"
              onError={(e) => {
                (e.target as HTMLImageElement).style.opacity = "0";
              }}
            />
            <span className="font-display text-base font-bold leading-none tracking-tight text-foreground sm:text-xl">
              Zérah <span className="text-primary">Baby</span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-[11px]">
                And Kids
              </span>
            </span>
          </Link>

          <form
            className="ml-auto hidden flex-1 items-center md:flex"
            onSubmit={submitSearch}
            role="search"
          >
            <div className="relative w-full max-w-xl">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Search for onesies, strollers, diapers…"
                aria-label="Search products"
                className="w-full rounded-full border border-border bg-muted/60 py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-primary focus:bg-background"
              />
            </div>
          </form>

          <nav className="ml-auto flex items-center gap-0.5 sm:gap-1 md:ml-0">
            {/* Mobile Search Toggle */}
            <button
              className="md:hidden focus-ring rounded-full p-2.5 text-foreground transition duration-300 hover:bg-muted hover:text-primary"
              aria-label="Toggle search"
              onClick={() => setSearchOpen(!searchOpen)}
            >
              <Search className="size-5" />
            </button>
            {user ? (
              <>
                <Link
                  to="/orders"
                  className="focus-ring hidden rounded-full px-3 py-2 text-sm font-semibold transition hover:bg-muted lg:block"
                >
                  My orders
                </Link>
                {isAdmin && (
                  <>
                    <button
                      type="button"
                      onClick={toggleAdminMode}
                      aria-pressed={adminMode}
                      title={adminMode ? "Admin mode is on" : "Turn on admin mode to edit the site"}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-bold uppercase tracking-wide transition",
                        adminMode
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground hover:bg-muted",
                      )}
                    >
                      <ShieldCheck className="size-4" />
                      <span className="hidden sm:inline">Admin {adminMode ? "on" : "off"}</span>
                    </button>
                    {adminMode && (
                      <Link
                        to="/admin"
                        className="focus-ring rounded-full p-2.5 text-foreground transition duration-300 hover:bg-muted hover:text-primary"
                        aria-label="Admin dashboard"
                      >
                        <LayoutDashboard className="size-5" />
                      </Link>
                    )}
                  </>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="focus-ring rounded-full p-2.5 text-foreground transition duration-300 hover:bg-muted hover:text-primary"
                      aria-label="User profile"
                    >
                      <User className="size-5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <div className="px-2 py-1.5 text-sm font-medium truncate">{user.email}</div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link to="/profile" className="cursor-pointer">
                        My profile
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/orders" className="cursor-pointer">
                        My orders
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/wishlist" className="cursor-pointer">
                        My wishlist
                      </Link>
                    </DropdownMenuItem>
                    {isAdmin && (
                      <DropdownMenuItem asChild>
                        <Link to="/admin" className="cursor-pointer">
                          Admin Dashboard
                        </Link>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleSignOut}
                      className="cursor-pointer text-destructive focus:text-destructive"
                    >
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <Link
                to="/auth"
                className="focus-ring press rounded-full p-2.5 text-foreground transition duration-200 hover:bg-muted hover:text-primary"
                aria-label="Sign in"
              >
                <User className="size-5" />
              </Link>
            )}
            {user && (
              <Link
                to="/wishlist"
                className="focus-ring press relative rounded-full p-2.5 text-foreground transition duration-200 hover:bg-muted hover:text-primary"
                aria-label={`Wishlist with ${wishlistIds.length} items`}
              >
                <Heart
                  className={`size-5 ${wishlistIds.length > 0 ? "fill-red-500 text-red-500" : ""}`}
                />
                {wishlistIds.length > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 grid min-w-5 animate-in zoom-in duration-200 place-items-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">
                    {wishlistIds.length}
                  </span>
                )}
              </Link>
            )}
            <Link
              to="/cart"
              className="focus-ring press relative rounded-full p-2.5 text-foreground transition duration-200 hover:bg-muted hover:text-primary"
              aria-label={`Cart with ${count} items`}
            >
              <ShoppingCart className="size-5" />
              {count > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid min-w-5 animate-in zoom-in duration-200 place-items-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">
                  {count}
                </span>
              )}
            </Link>
          </nav>
        </div>

        {searchOpen && (
          <form
            className="mx-auto max-w-7xl px-3 pb-2.5 md:hidden"
            onSubmit={submitSearch}
            role="search"
          >
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={term}
                autoFocus
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Search products…"
                aria-label="Search products"
                className="w-full rounded-full border border-border bg-muted/60 py-2 pl-10 pr-4 text-sm outline-none transition focus:border-primary focus:bg-background"
              />
            </div>
          </form>
        )}

        <div className={cn("border-t border-border md:block", open ? "block" : "hidden")}>
          <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-2 text-sm font-medium md:flex-row md:items-center md:gap-6">
            <Link
              to="/shop"
              search={{}}
              className="focus-ring relative w-fit py-1.5 transition-colors duration-300 after:absolute after:inset-x-0 after:bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:bg-primary after:transition-transform after:duration-300 hover:text-primary hover:after:scale-x-100"
              activeProps={{ className: "text-primary after:scale-x-100" }}
              onClick={() => setOpen(false)}
            >
              All Products
            </Link>
            {(categories ?? []).map((c) => (
              <Link
                key={c.slug}
                to="/shop"
                search={{ category: c.slug }}
                className="focus-ring relative w-fit py-1.5 transition-colors duration-300 after:absolute after:inset-x-0 after:bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:bg-primary after:transition-transform after:duration-300 hover:text-primary hover:after:scale-x-100"
                activeProps={{ className: "text-primary after:scale-x-100" }}
                onClick={() => setOpen(false)}
              >
                {c.name}
              </Link>
            ))}
            <Link
              to="/about"
              className="focus-ring relative w-fit py-1.5 transition-colors duration-300 after:absolute after:inset-x-0 after:bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:bg-primary after:transition-transform after:duration-300 hover:text-primary hover:after:scale-x-100"
              activeProps={{ className: "text-primary after:scale-x-100" }}
              onClick={() => setOpen(false)}
            >
              About
            </Link>
            <Link
              to="/contact"
              className="focus-ring relative w-fit py-1.5 transition-colors duration-300 after:absolute after:inset-x-0 after:bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:bg-primary after:transition-transform after:duration-300 hover:text-primary hover:after:scale-x-100"
              activeProps={{ className: "text-primary after:scale-x-100" }}
              onClick={() => setOpen(false)}
            >
              Contact
            </Link>

            <div className="flex items-center gap-2 py-1.5 md:ml-auto">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Age
              </span>
              <div className="flex flex-wrap gap-1.5">
                {ageGroups.map((a) => (
                  <Link
                    key={a}
                    to="/shop"
                    search={{ age: a }}
                    className="focus-ring rounded-full border border-border px-2.5 py-1 text-xs font-semibold transition duration-300 hover:-translate-y-0.5 hover:border-primary hover:text-primary"
                    onClick={() => setOpen(false)}
                  >
                    {a}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
