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
  X,
  History,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import logo from "@/assets/zerah-logo.png";
import { ageGroups, useCategories, useSettings, useProducts } from "@/lib/store";
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
import { ResponsiveMedia } from "@/components/ui/ResponsiveMedia";

// Simple debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

// Recent searches hook
function useRecentSearches() {
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("recent_searches");
      if (stored) setRecent(JSON.parse(stored));
    } catch (e) {
      // ignore
    }
  }, []);

  const addSearch = (term: string) => {
    const t = term.trim();
    if (!t) return;
    const next = [t, ...recent.filter((x) => x !== t)].slice(0, 5);
    setRecent(next);
    try {
      localStorage.setItem("recent_searches", JSON.stringify(next));
    } catch (e) {
      // ignore
    }
  };

  const removeSearch = (term: string) => {
    const next = recent.filter((x) => x !== term);
    setRecent(next);
    try {
      localStorage.setItem("recent_searches", JSON.stringify(next));
    } catch (e) {
      // ignore
    }
  };

  return { recent, addSearch, removeSearch };
}

import { CategoriesTab } from "@/components/admin/CategoriesManager";

export function Header() {
  const { count } = useCart();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const categoryScrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const navigate = useNavigate();
  const { data: categories } = useCategories();
  const { data: products } = useProducts();
  const { brandName, announcement } = useSettings();
  const { user } = useSession();
  const { isAdmin, adminMode, toggleAdminMode } = useAdminMode();
  const { productIds: wishlistIds } = useWishlist();

  const { recent, addSearch, removeSearch } = useRecentSearches();
  const debouncedTerm = useDebounce(term, 300);

  const checkCategoryScroll = () => {
    if (categoryScrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = categoryScrollRef.current;
      setCanScrollLeft(scrollLeft > 5);
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 5);
    }
  };

  const scrollCategories = (direction: "left" | "right") => {
    if (categoryScrollRef.current) {
      const amount = direction === "left" ? -280 : 280;
      categoryScrollRef.current.scrollBy({ left: amount, behavior: "smooth" });
      setTimeout(checkCategoryScroll, 320);
    }
  };

  useEffect(() => {
    checkCategoryScroll();
    const handleResize = () => checkCategoryScroll();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [categories]);

  // Close suggestions when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filter products for suggestions
  const suggestions = (() => {
    if (!products || !debouncedTerm.trim()) return [];
    const query = debouncedTerm.trim().toLowerCase();
    return products
      .filter((p) =>
        [p.name, p.brand, p.category, p.description]
          .filter(Boolean)
          .some((val) => String(val).toLowerCase().includes(query)),
      )
      .slice(0, 4); // Show top 4 matches
  })();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  function submitSearch(e: React.FormEvent, forceTerm?: string) {
    e?.preventDefault();
    const q = (forceTerm ?? term).trim();
    if (q) addSearch(q);
    setOpen(false);
    setSearchOpen(false);
    setShowSuggestions(false);
    setTerm(q);
    navigate({ to: "/shop", search: q ? { q } : {} });
  }

  function handleSuggestionClick(productId: string) {
    if (term.trim()) addSearch(term.trim());
    setOpen(false);
    setSearchOpen(false);
    setShowSuggestions(false);
    navigate({ to: "/product/$id", params: { id: String(productId) } });
  }

  return (
    <header className="sticky top-0 z-50 w-full">
      <a
        href="#main"
        className="focus-ring sr-only z-[70] focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      {announcement && announcement.trim().length > 0 && (
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
      )}

      <div className="border-b border-border glass-header">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2.5 sm:gap-4 sm:px-4 sm:py-3">
          <button
            className="focus-ring -ml-2 rounded-xl p-3 text-foreground transition hover:bg-muted md:hidden"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <Menu className="size-6" />
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
              className="size-8 object-contain rounded-full sm:size-10"
              onError={(e) => {
                (e.target as HTMLImageElement).style.opacity = "0";
              }}
            />
            <span className="font-display text-base font-bold leading-[1.1] tracking-tight text-foreground sm:text-xl whitespace-pre-wrap">
              {brandName}
            </span>
          </Link>

          <div className="hidden flex-1 items-center mx-4 md:flex lg:mx-8 relative" ref={searchRef}>
            <form
              className="w-full max-w-md lg:max-w-xl mx-auto relative z-10 group"
              onSubmit={(e) => submitSearch(e)}
              role="search"
            >
              <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
              <input
                type="search"
                value={term}
                onChange={(e) => {
                  setTerm(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                placeholder="Search for onesies, strollers, diapers…"
                aria-label="Search products"
                className="w-full rounded-full border border-border/60 bg-muted/50 py-2.5 pl-11 pr-4 text-sm outline-none transition-all duration-300 focus:border-primary focus:bg-background focus:shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-primary)_15%,transparent)] hover:border-border/80"
              />
            </form>

            {/* Desktop Autocomplete Dropdown */}
            {showSuggestions && (term.trim() || recent.length > 0) && (
              <div className="absolute left-1/2 top-full mt-2 w-full max-w-md lg:max-w-xl -translate-x-1/2 rounded-2xl border border-border bg-background p-2 shadow-xl animate-in fade-in zoom-in-95 duration-200">
                {!term.trim() && recent.length > 0 && (
                  <div className="p-2">
                    <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                      Recent Searches
                    </h3>
                    <ul className="space-y-1">
                      {recent.map((r) => (
                        <li
                          key={r}
                          className="flex items-center justify-between group rounded-lg transition hover:bg-muted"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              submitSearch({ preventDefault: () => {} } as React.FormEvent, r)
                            }
                            className="flex-1 flex items-center gap-2 px-3 py-2 text-sm text-left"
                          >
                            <History className="size-4 text-muted-foreground" /> {r}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeSearch(r);
                            }}
                            className="p-2 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition"
                            aria-label="Remove search"
                          >
                            <X className="size-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {term.trim() && suggestions.length === 0 && (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    No results for "{term}"
                  </div>
                )}
                {term.trim() && suggestions.length > 0 && (
                  <div className="p-1">
                    <h3 className="mb-2 px-2 pt-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                      Products
                    </h3>
                    <ul className="space-y-1">
                      {suggestions.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => handleSuggestionClick(p.id)}
                            className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-muted"
                          >
                            <ResponsiveMedia
                              src={p.image}
                              alt={p.name}
                              width={40}
                              height={40}
                              fit="cover"
                              aspect="1/1"
                              containerClassName="size-10 shrink-0 rounded-lg bg-card"
                            />
                            <div className="flex flex-col min-w-0">
                              <span className="truncate text-sm font-semibold">{p.name}</span>
                              <span className="truncate text-xs text-muted-foreground">
                                {p.brand}
                              </span>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      onClick={(e) => submitSearch(e as unknown as React.FormEvent)}
                      className="mt-2 w-full rounded-lg bg-primary/5 py-2.5 text-center text-sm font-semibold text-primary transition hover:bg-primary/10"
                    >
                      See all results for "{term}"
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <nav className="ml-auto flex items-center gap-1 sm:gap-1.5 md:ml-0">
            {/* Mobile Search Toggle */}
            <button
              className="md:hidden focus-ring rounded-full p-2.5 text-foreground transition duration-300 hover:bg-muted hover:text-primary"
              aria-label="Toggle search"
              onClick={() => setSearchOpen(!searchOpen)}
            >
              <Search className="size-5" />
            </button>

            {/* Desktop Navigation Links */}
            <Link
              to="/about"
              className="focus-ring hidden rounded-full px-3 py-1.5 text-xs lg:text-sm font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground md:inline-block"
            >
              About
            </Link>
            <Link
              to="/contact"
              className="focus-ring hidden rounded-full px-3 py-1.5 text-xs lg:text-sm font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground md:inline-block"
            >
              Contact
            </Link>

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
          <div className="mx-auto max-w-7xl px-3 pb-2.5 md:hidden">
            <form onSubmit={(e) => submitSearch(e)} role="search" className="group">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                <input
                  type="search"
                  value={term}
                  autoFocus
                  onChange={(e) => setTerm(e.target.value)}
                  placeholder="Search products…"
                  aria-label="Search products"
                  className="w-full rounded-full border border-border/60 bg-muted/50 py-2.5 pl-11 pr-4 text-sm outline-none transition-all duration-300 focus:border-primary focus:bg-background focus:shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-primary)_15%,transparent)] hover:border-border/80"
                />
              </div>
            </form>
            {/* Mobile Suggestions */}
            {(term.trim() || recent.length > 0) && (
              <div className="mt-2 rounded-2xl border border-border bg-background p-2 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
                {!term.trim() && recent.length > 0 && (
                  <div className="p-2">
                    <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                      Recent
                    </h3>
                    <ul className="space-y-1">
                      {recent.map((r) => (
                        <li
                          key={r}
                          className="flex items-center justify-between group rounded-lg hover:bg-muted"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              submitSearch({ preventDefault: () => {} } as React.FormEvent, r)
                            }
                            className="flex-1 flex items-center gap-2 px-2 py-2 text-sm text-left"
                          >
                            <History className="size-4 text-muted-foreground" /> {r}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeSearch(r);
                            }}
                            className="p-2 text-muted-foreground hover:text-destructive"
                          >
                            <X className="size-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {term.trim() && suggestions.length === 0 && (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    No results for "{term}"
                  </div>
                )}
                {term.trim() && suggestions.length > 0 && (
                  <div className="p-1">
                    <h3 className="mb-2 px-2 pt-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                      Products
                    </h3>
                    <ul className="space-y-1">
                      {suggestions.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => handleSuggestionClick(p.id)}
                            className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-muted"
                          >
                            <ResponsiveMedia
                              src={p.image}
                              alt={p.name}
                              width={40}
                              height={40}
                              fit="cover"
                              aspect="1/1"
                              containerClassName="size-10 shrink-0 rounded-lg bg-card"
                            />
                            <div className="flex flex-col min-w-0">
                              <span className="truncate text-sm font-semibold">{p.name}</span>
                              <span className="truncate text-xs text-muted-foreground">
                                {p.brand}
                              </span>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div
          className={cn(
            "border-t border-border/60 bg-background/95 backdrop-blur-md transition-all duration-300 md:block",
            open ? "block shadow-premium-md" : "hidden",
          )}
        >
          <div className="mx-auto flex max-w-7xl flex-col md:flex-row md:items-center px-2 sm:px-4">
            {/* Scrollable Categories Area with Non-Overlapping Chevrons and Mouse Wheel / Touch Support */}
            <div className="relative min-w-0 flex-1 flex items-center gap-1.5">
              {canScrollLeft && (
                <button
                  type="button"
                  onClick={() => scrollCategories("left")}
                  aria-label="Scroll categories left"
                  className="hidden md:flex shrink-0 size-6 items-center justify-center rounded-full bg-muted/80 border border-border text-foreground shadow-sm hover:bg-primary hover:text-primary-foreground transition duration-200 cursor-pointer"
                >
                  <ChevronLeft className="size-3.5" />
                </button>
              )}

              <div
                ref={categoryScrollRef}
                onScroll={checkCategoryScroll}
                onWheel={(e) => {
                  if (categoryScrollRef.current && e.deltaY !== 0) {
                    categoryScrollRef.current.scrollLeft += e.deltaY;
                  }
                }}
                className="min-w-0 flex-1 overflow-x-auto no-scrollbar py-1.5 px-0.5 scroll-smooth touch-pan-x select-none"
              >
                <div className="flex w-max items-center gap-1.5 sm:gap-2">
                  <Link
                    to="/shop"
                    search={{}}
                    className="focus-ring shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold transition-all duration-300 bg-muted/60 text-foreground hover:bg-primary hover:text-primary-foreground hover:shadow-premium-sm"
                    activeProps={{
                      className: "bg-primary text-primary-foreground shadow-premium-sm",
                    }}
                    onClick={() => setOpen(false)}
                  >
                    All Products
                  </Link>
                  {(categories ?? []).map((c) => (
                    <Link
                      key={c.slug}
                      to="/shop"
                      search={{ category: c.slug }}
                      className="focus-ring shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-300 bg-muted/60 text-foreground hover:bg-primary hover:text-primary-foreground hover:shadow-premium-sm"
                      activeProps={{
                        className:
                          "bg-primary text-primary-foreground font-semibold shadow-premium-sm",
                      }}
                      onClick={() => setOpen(false)}
                    >
                      {c.name}
                    </Link>
                  ))}
                  {isAdmin && adminMode && (
                    <button
                      type="button"
                      className="focus-ring shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold transition-all duration-300 border border-dashed border-primary/60 text-primary bg-primary/5 hover:bg-primary hover:text-primary-foreground cursor-pointer"
                      title="Manage Categories"
                      onClick={() => {
                        setOpen(false);
                        setShowCategoryModal(true);
                      }}
                    >
                      + Add / Edit
                    </button>
                  )}
                </div>
              </div>

              {canScrollRight && (
                <button
                  type="button"
                  onClick={() => scrollCategories("right")}
                  aria-label="Scroll categories right"
                  className="hidden md:flex shrink-0 size-6 items-center justify-center rounded-full bg-muted/80 border border-border text-foreground shadow-sm hover:bg-primary hover:text-primary-foreground transition duration-200 cursor-pointer"
                >
                  <ChevronRight className="size-3.5" />
                </button>
              )}
            </div>

            {/* Dedicated Age Filters & Mobile Links */}
            <div className="shrink-0 flex flex-col border-t border-border/50 bg-muted/20 px-3 py-1.5 md:flex-row md:items-center md:border-t-0 md:bg-transparent md:border-l md:border-border/60 md:pl-3 md:pr-1">
              {/* Mobile Only: About & Contact links inside drawer */}
              <div className="flex md:hidden items-center gap-4 text-xs font-semibold shrink-0 whitespace-nowrap mb-2 pb-1.5 border-b border-border/40">
                <Link
                  to="/about"
                  className="focus-ring transition-colors hover:text-primary whitespace-nowrap"
                  onClick={() => setOpen(false)}
                >
                  About
                </Link>
                <Link
                  to="/contact"
                  className="focus-ring transition-colors hover:text-primary whitespace-nowrap"
                  onClick={() => setOpen(false)}
                >
                  Contact
                </Link>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground shrink-0">
                  Age:
                </span>
                <div className="flex flex-wrap gap-1 shrink-0">
                  {ageGroups.map((a) => (
                    <Link
                      key={a}
                      to="/shop"
                      search={{ age: a }}
                      className="focus-ring whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-[10px] font-bold transition-all duration-300 hover:border-primary hover:bg-primary hover:text-primary-foreground"
                      activeProps={{
                        className: "border-primary bg-primary text-primary-foreground",
                      }}
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
      </div>

      {showCategoryModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="relative w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-3xl bg-background shadow-2xl p-6 border border-border">
            <div className="flex items-center justify-between mb-6 border-b border-border pb-4">
              <h2 className="text-xl font-black font-display tracking-tight text-foreground">
                Manage Categories
              </h2>
              <button
                onClick={() => setShowCategoryModal(false)}
                className="rounded-full p-2 bg-muted hover:bg-muted-foreground/20 transition-colors"
              >
                <X className="size-5" />
              </button>
            </div>
            <CategoriesTab />
          </div>
        </div>
      )}
    </header>
  );
}
