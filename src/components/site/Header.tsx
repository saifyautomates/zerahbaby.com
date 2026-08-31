//
import { Link, useNavigate, useLocation, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
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
  MapPin,
  LifeBuoy,
  Info,
  LogOut,
  ShoppingBag,
  Camera,
  Loader2,
  LayoutGrid,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import logo from "@/assets/zerah-logo-official.png";
import { ageGroups, useCategories, useSettings, useProducts } from "@/lib/store";
import { useCart } from "@/lib/cart";
import { useSession } from "@/lib/auth";
import { useProfile, useSaveProfile } from "@/lib/orders";
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
import { AnnouncementBanner } from "@/components/public/AnnouncementBanner";
import { CategoriesTab } from "@/components/admin/CategoriesManager";
import { uploadMedia } from "@/lib/uploads";
import { toast } from "sonner";

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
  const qc = useQueryClient();
  const { data: categories } = useCategories();
  const { data: products } = useProducts();
  const { brandName, announcement } = useSettings();
  const { user } = useSession();
  const { data: userProfile } = useProfile(user?.id);
  const { isAdmin, adminMode, toggleAdminMode } = useAdminMode();
  const saveProfile = useSaveProfile(user?.id);

  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;
    setUploadingAvatar(true);
    try {
      const url = await uploadMedia(file, "avatars");
      await saveProfile.mutateAsync({ avatar_url: url });
      toast.success("Profile picture updated!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to upload photo");
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };
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
    await qc.cancelQueries();
    qc.clear();
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

  const location = useLocation();

  const closeDrawer = () => {
    setOpen(false);
  };

  // Close drawer on route change
  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search]);

  // Handle browser back button (popstate) to dismiss mobile drawer if open
  useEffect(() => {
    if (!open) return;

    // Push dummy state so browser back button closes the drawer instead of leaving the page
    const stateObj = { zerahDrawerOpen: true };
    window.history.pushState(stateObj, "");

    const handlePopState = () => {
      setOpen(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const getPageTitle = () => {
    const path = location.pathname;
    const searchParams = new URLSearchParams(
      typeof location.search === "string" ? location.search : "",
    );
    const tab = searchParams.get("tab");
    if (path.startsWith("/profile")) {
      if (tab === "addresses") return "Saved Addresses";
      return "My Profile";
    }
    if (path.startsWith("/orders")) return "My Orders";
    if (path.startsWith("/wishlist")) return "Wishlist";
    if (path.startsWith("/cart")) return "Shopping Bag";
    if (path.startsWith("/checkout")) return "Checkout";
    if (path.startsWith("/about")) return "About Us";
    if (path.startsWith("/contact")) return "Contact Support";
    if (path.startsWith("/product/")) return "Product Details";
    if (path.startsWith("/shop")) return "Shop All";
    if (path.startsWith("/categories")) return "Categories";
    if (path.startsWith("/auth")) return "Sign In";
    if (path.startsWith("/returns")) return "Returns & Exchange";
    if (path.startsWith("/shipping-delivery")) return "Shipping Policy";
    if (path.startsWith("/terms-conditions")) return "Terms & Conditions";
    if (path.startsWith("/cancellation-refund")) return "Cancellation & Refund";
    if (path.startsWith("/privacy-policy")) return "Privacy Policy";
    if (path.startsWith("/admin")) return "Admin Dashboard";
    if (path !== "/") {
      const clean = path.replace(/^\//, "").replace(/-/g, " ");
      return clean.charAt(0).toUpperCase() + clean.slice(1);
    }
    return null;
  };

  const pageTitle = getPageTitle();
  const isSubPage = location.pathname !== "/";

  const router = useRouter();

  const handleBack = () => {
    // Check if TanStack router has internal history in this session
    const hasInternalHistory =
      typeof window !== "undefined" && window.history.state?.__TSR_index > 0;

    if (hasInternalHistory) {
      router.history.back();
    } else {
      // Logical fallbacks based on current route
      if (location.pathname.startsWith("/product/")) {
        navigate({ to: "/shop" });
      } else if (location.pathname.startsWith("/checkout")) {
        navigate({ to: "/cart" });
      } else if (location.pathname.startsWith("/admin")) {
        navigate({ to: "/admin" });
      } else {
        navigate({ to: "/" });
      }
    }
  };

  return (
    <>
      <header className="sticky top-0 z-50 w-full">
        <a
          href="#main"
          className="focus-ring sr-only z-[70] focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
        >
          Skip to main content
        </a>
        {/* AnnouncementBanner */}
        <AnnouncementBanner />
        <div className="glass-header border-b border-border/50 shadow-premium-sm">
          <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-1.5 sm:gap-4 sm:px-4 sm:py-2 relative">
            {/* Mobile Menu or Back Button */}
            {isSubPage ? (
              <button
                type="button"
                className="focus-ring -ml-2 rounded-xl p-3 text-foreground transition hover:bg-muted md:hidden cursor-pointer"
                aria-label="Go back"
                onClick={handleBack}
              >
                <ChevronLeft className="size-6" />
              </button>
            ) : (
              <button
                type="button"
                className="focus-ring -ml-2 rounded-xl p-3 text-foreground transition hover:bg-muted md:hidden cursor-pointer"
                aria-label="Toggle menu"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
              >
                <Menu className="size-6" />
              </button>
            )}

            {/* Mobile Page Title */}
            {isSubPage && (
              <div className="flex items-center min-w-0 flex-1 ml-1 mr-3 md:hidden">
                <span className="font-display text-base sm:text-lg font-bold text-foreground truncate block w-full">
                  {pageTitle || "Back"}
                </span>
              </div>
            )}

            {/* Desktop Back Button */}
            {isSubPage && (
              <button
                type="button"
                onClick={handleBack}
                className="hidden md:inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-lg hover:bg-muted/80 transition-colors mr-1 cursor-pointer border border-border/50 shadow-2xs"
                aria-label="Go back"
              >
                <ChevronLeft className="size-4" /> Back
              </button>
            )}

            {/* Logo */}
            <Link
              to="/"
              onClick={() => {
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className={cn(
                "focus-ring press min-w-0 items-center gap-2 sm:gap-2.5 rounded-lg transition-transform duration-200 hover:-translate-y-0.5",
                isSubPage ? "hidden md:flex" : "flex",
              )}
            >
              <img
                src={logo}
                alt={`${brandName} logo`}
                className="h-10 sm:h-12 md:h-14 w-auto object-contain drop-shadow-sm flex-shrink-0"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.opacity = "0";
                }}
              />
            </Link>

            <div
              className="hidden flex-1 items-center mx-4 md:flex lg:mx-8 relative"
              ref={searchRef}
            >
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
                  className="w-full rounded-full border border-border/60 bg-muted/40 py-1.5 pl-10 pr-4 text-sm outline-none transition-all duration-300 focus:border-primary focus:bg-background focus:shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-primary)_15%,transparent)] hover:border-border/80"
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
                    <div className="hidden md:flex items-center gap-1.5">
                      <Link
                        to="/admin"
                        className="flex items-center gap-1.5 rounded-full bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 px-3 py-1.5 text-xs font-bold transition duration-200"
                        aria-label="Admin dashboard"
                      >
                        <LayoutDashboard className="size-4" />
                        <span>Admin</span>
                      </Link>
                      <button
                        type="button"
                        onClick={toggleAdminMode}
                        aria-pressed={adminMode}
                        title={
                          adminMode ? "Admin mode is on" : "Turn on admin mode to edit the site"
                        }
                        className={cn(
                          "flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold transition cursor-pointer",
                          adminMode
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border text-muted-foreground hover:bg-muted",
                        )}
                      >
                        <ShieldCheck className="size-3.5" />
                        <span>Edit {adminMode ? "ON" : "OFF"}</span>
                      </button>
                    </div>
                  )}

                  <div className="hidden md:block">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="focus-ring rounded-full p-1 text-foreground transition duration-300 hover:bg-muted hover:text-primary flex items-center justify-center cursor-pointer"
                          aria-label="User profile"
                        >
                          {userProfile?.avatar_url ? (
                            <img
                              src={userProfile.avatar_url}
                              alt={userProfile.full_name || "User profile"}
                              className="size-7 rounded-full object-cover border border-primary/30 shadow-2xs"
                            />
                          ) : (
                            <div className="size-8 rounded-full flex items-center justify-center hover:bg-muted">
                              <User className="size-5" />
                            </div>
                          )}
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
                  </div>
                </>
              ) : (
                <Link
                  to="/auth"
                  className="hidden md:flex focus-ring press rounded-full p-2.5 text-foreground transition duration-200 hover:bg-muted hover:text-primary"
                  aria-label="Sign in"
                >
                  <User className="size-5" />
                </Link>
              )}
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="md:hidden focus-ring press relative rounded-full p-2.5 text-foreground transition duration-200 hover:bg-muted hover:text-primary"
                aria-label="Search"
              >
                <Search className="size-5" />
              </button>
              {user && (
                <Link
                  to="/wishlist"
                  className="hidden sm:flex focus-ring press relative rounded-full p-2.5 text-foreground transition duration-200 hover:bg-muted hover:text-primary"
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

          {/* Desktop Category Row */}
          <div className="hidden md:block border-b border-border/50 bg-background/75 backdrop-blur-xl">
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
                  <div className="flex w-max items-center gap-1 sm:gap-1.5">
                    <Link
                      to="/shop"
                      search={{}}
                      className="focus-ring shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-300 bg-muted/60 text-foreground hover:bg-primary hover:text-primary-foreground hover:shadow-premium-sm"
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
                        className="focus-ring shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-300 bg-muted/60 text-foreground hover:bg-primary hover:text-primary-foreground hover:shadow-premium-sm"
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
                        className="focus-ring shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold transition-all duration-300 border border-dashed border-primary/60 text-primary bg-primary/5 hover:bg-primary hover:text-primary-foreground cursor-pointer"
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

              {/* Dedicated Age Filters */}
              <div className="shrink-0 flex flex-col bg-muted/20 px-3 py-1.5 md:flex-row md:items-center md:bg-transparent md:border-l md:border-border/60 md:pl-3 md:pr-1">
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground shrink-0">
                    Age:
                  </span>
                  <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5 shrink-0">
                    {ageGroups.map((a) => (
                      <Link
                        key={a}
                        to="/shop"
                        search={{ age: a }}
                        className="focus-ring whitespace-nowrap rounded-full border border-border px-2.5 py-1 text-[11px] font-bold transition-all duration-300 hover:border-primary hover:bg-primary hover:text-primary-foreground"
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
      </header>

      {/* Mobile Sidebar Drawer moved outside header to avoid stacking context issues from backdrop-blur */}
      <div
        className={cn(
          "fixed inset-0 z-[100] md:hidden transition-opacity duration-300",
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-pointer"
          onClick={closeDrawer}
        />
      </div>
      <div
        className="fixed inset-y-0 z-[110] flex w-full pointer-events-none md:hidden"
        style={{ pointerEvents: open ? "auto" : "none" }}
      >
        <div
          role="dialog"
          aria-modal="true"
          className={cn(
            "mobile-drawer-content relative flex w-full max-w-[85vw] sm:max-w-md flex-col bg-background shadow-2xl transition-transform duration-300 ease-out pointer-events-auto",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          {/* Drawer Top Dismiss Bar */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b border-border/50">
            <button
              type="button"
              onClick={closeDrawer}
              className="flex items-center gap-1 text-xs font-bold text-foreground/80 hover:text-foreground active:scale-95 transition-all py-1 px-2.5 rounded-lg hover:bg-muted cursor-pointer"
            >
              <ChevronLeft className="size-4 text-primary" /> Back
            </button>
            <button
              type="button"
              onClick={closeDrawer}
              className="size-7 flex items-center justify-center rounded-full bg-background border border-border text-foreground hover:bg-muted transition cursor-pointer shadow-2xs"
              aria-label="Close menu"
            >
              <X className="size-3.5" />
            </button>
          </div>

          {/* Profile Header */}
          <div className="flex items-center gap-3 bg-muted/20 p-4 border-b border-border/60">
            <div className="relative group size-12 shrink-0">
              <div className="size-full rounded-full overflow-hidden bg-background flex items-center justify-center border border-border/50 shadow-sm">
                {userProfile?.avatar_url ? (
                  <img
                    src={userProfile.avatar_url}
                    alt="Profile"
                    className="size-full object-cover"
                  />
                ) : (
                  <User className="size-6 text-muted-foreground" />
                )}
              </div>

              {user && (
                <>
                  <button
                    type="button"
                    disabled={uploadingAvatar}
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Upload profile picture"
                    className="absolute inset-0 rounded-full bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer disabled:opacity-100"
                  >
                    {uploadingAvatar ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Camera className="size-4" />
                    )}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={handleAvatarChange}
                  />
                </>
              )}
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-xs font-semibold text-muted-foreground truncate">
                Hello, {user ? user.user_metadata?.full_name || "Parent" : "Guest"} 👋
              </span>
              <span className="text-sm font-bold text-foreground truncate">
                {user ? "Welcome back!" : "Sign in to sync"}
              </span>
            </div>
          </div>

          {/* Links */}
          <div className="flex-1 overflow-y-auto py-2">
            {isAdmin && (
              <>
                <div className="bg-primary/5 rounded-2xl p-3 mx-4 my-2 border border-primary/15">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-primary flex items-center gap-1.5">
                      <ShieldCheck className="size-4" /> Admin Controls
                    </span>
                    <button
                      type="button"
                      onClick={toggleAdminMode}
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase transition cursor-pointer",
                        adminMode
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted-foreground/20",
                      )}
                    >
                      Edit {adminMode ? "ON" : "OFF"}
                    </button>
                  </div>
                  <Link
                    to="/admin"
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-center gap-2 w-full rounded-xl bg-primary py-2.5 text-xs font-bold text-primary-foreground shadow-xs hover:bg-primary/90 transition"
                  >
                    <LayoutDashboard className="size-4" /> Open Admin Dashboard
                  </Link>
                </div>
                <div className="h-px bg-border/60 mx-5 my-1" />
              </>
            )}

            {/* Customer Store Navigation */}
            <div className="px-4 py-2 space-y-1">
              <Link
                to="/shop"
                search={{}}
                onClick={() => setOpen(false)}
                className="flex items-center justify-between rounded-2xl bg-primary/10 px-4 py-3 text-sm font-bold text-primary hover:bg-primary/20 transition-all shadow-2xs"
              >
                <div className="flex items-center gap-3">
                  <Sparkle className="size-5" />
                  <span>Shop All Products</span>
                </div>
                <ChevronRight className="size-4" />
              </Link>

              <Link
                to="/categories"
                onClick={() => setOpen(false)}
                className="flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <LayoutGrid className="size-5 text-muted-foreground" />
                  <span>All Categories</span>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            </div>

            {/* Quick Category Chips in Mobile Drawer */}
            {categories && categories.length > 0 && (
              <div className="px-4 py-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-2 px-1">
                  Popular Categories
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {categories.slice(0, 6).map((c) => (
                    <Link
                      key={c.slug}
                      to="/shop"
                      search={{ category: c.slug }}
                      onClick={() => setOpen(false)}
                      className="rounded-full bg-muted/70 px-3 py-1 text-xs font-semibold text-foreground hover:bg-primary hover:text-primary-foreground transition-all"
                    >
                      {c.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Age Group Filter Chips in Mobile Drawer */}
            <div className="px-4 py-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-2 px-1">
                Shop by Age
              </span>
              <div className="flex flex-wrap gap-1.5">
                {ageGroups.map((age) => (
                  <Link
                    key={age}
                    to="/shop"
                    search={{ age }}
                    onClick={() => setOpen(false)}
                    className="rounded-full border border-border/80 bg-background px-2.5 py-1 text-[11px] font-bold text-muted-foreground hover:border-primary hover:text-primary transition-all"
                  >
                    {age}
                  </Link>
                ))}
              </div>
            </div>

            <div className="h-px bg-border/60 mx-5 my-2" />

            <Link
              to="/orders"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-5 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
            >
              <ShoppingBag className="size-5 text-muted-foreground" /> My Orders
            </Link>
            <Link
              to="/wishlist"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-5 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
            >
              <Heart className="size-5 text-muted-foreground" /> Wishlist
            </Link>
            <Link
              to="/profile"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-5 py-3.5 text-sm font-medium hover:bg-muted/50 transition-colors"
            >
              <User className="size-5 text-muted-foreground" /> My Account
            </Link>
            <Link
              to="/profile"
              search={{ tab: "addresses" }}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-5 py-3.5 text-sm font-medium hover:bg-muted/50 transition-colors"
            >
              <MapPin className="size-5 text-muted-foreground" /> Addresses
            </Link>

            <div className="h-px bg-border/60 mx-5 my-2" />

            <Link
              to="/contact"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-5 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
            >
              <LifeBuoy className="size-5 text-muted-foreground" /> Help & Support
            </Link>
            <Link
              to="/about"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-5 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
            >
              <Info className="size-5 text-muted-foreground" /> About Us
            </Link>

            {user ? (
              <button
                onClick={() => {
                  handleSignOut();
                  setOpen(false);
                }}
                className="w-full flex items-center gap-3 px-5 py-3 text-sm font-medium text-destructive hover:bg-muted/50 transition-colors mt-2"
              >
                <LogOut className="size-5" /> Logout
              </button>
            ) : (
              <Link
                to="/auth"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-5 py-3 text-sm font-medium text-primary hover:bg-muted/50 transition-colors mt-2"
              >
                <User className="size-5" /> Sign In
              </Link>
            )}
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
                aria-label="Close modal"
                className="rounded-full p-2 bg-muted hover:bg-muted-foreground/20 transition-colors"
              >
                <X className="size-5" />
              </button>
            </div>
            <CategoriesTab />
          </div>
        </div>
      )}

      {/* Mobile Full-Screen Search Modal */}
      <div
        className={cn(
          "fixed inset-0 z-[110] bg-background md:hidden transition-transform duration-300 ease-out flex flex-col",
          searchOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-center gap-2 p-3 border-b border-border/60">
          <button
            onClick={() => {
              setSearchOpen(false);
              setShowSuggestions(false);
            }}
            className="p-2 rounded-full hover:bg-muted transition"
            aria-label="Close search"
          >
            <ChevronLeft className="size-6 text-foreground" />
          </button>
          <form className="flex-1 relative" onSubmit={(e) => submitSearch(e)}>
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus={searchOpen}
              type="search"
              value={term}
              onChange={(e) => {
                setTerm(e.target.value);
                setShowSuggestions(true);
              }}
              placeholder="Search products..."
              className="w-full rounded-full bg-muted/50 py-2 pl-9 pr-4 text-sm outline-none focus:bg-background focus:ring-2 focus:ring-primary/20 transition-all border border-transparent focus:border-primary/50"
            />
            {term && (
              <button
                type="button"
                onClick={() => setTerm("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full bg-muted-foreground/20 hover:bg-muted-foreground/40 text-foreground transition"
              >
                <X className="size-3" />
              </button>
            )}
          </form>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-6">
          {!term.trim() && recent.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-foreground text-sm">Recent Searches</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {recent.map((r) => (
                  <button
                    key={r}
                    onClick={() => submitSearch({ preventDefault: () => {} } as React.FormEvent, r)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-border bg-muted/30 text-sm font-medium hover:bg-muted hover:border-border/80 transition"
                  >
                    <History className="size-3.5 text-muted-foreground" />
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}

          {term.trim() && suggestions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="size-12 rounded-full bg-muted flex items-center justify-center mb-4">
                <Search className="size-6 text-muted-foreground" />
              </div>
              <h3 className="font-bold text-lg">No results found</h3>
              <p className="text-muted-foreground text-sm mt-1">
                We couldn't find anything for "{term}"
              </p>
            </div>
          )}

          {term.trim() && suggestions.length > 0 && (
            <div>
              <h3 className="font-bold text-foreground text-sm mb-4">Suggested Products</h3>
              <ul className="space-y-4">
                {suggestions.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => handleSuggestionClick(p.id)}
                      className="flex w-full items-center gap-4 text-left group"
                    >
                      <ResponsiveMedia
                        src={p.image}
                        alt={p.name}
                        width={64}
                        height={64}
                        fit="cover"
                        aspect="1/1"
                        containerClassName="size-16 shrink-0 rounded-2xl bg-card border border-border/50 group-hover:border-primary/30 transition-colors"
                      />
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="font-semibold text-sm truncate group-hover:text-primary transition-colors">
                          {p.name}
                        </span>
                        <span className="text-xs text-muted-foreground mt-0.5">{p.brand}</span>
                        <span className="text-sm font-bold mt-1 text-primary">
                          ₹{p.price.toLocaleString("en-IN")}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={(e) => submitSearch(e as unknown as React.FormEvent)}
                className="mt-6 w-full rounded-2xl bg-primary/10 py-3.5 text-center text-sm font-bold text-primary hover:bg-primary/20 transition active:scale-[0.98]"
              >
                See all results
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
