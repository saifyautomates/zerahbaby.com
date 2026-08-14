import { Link } from "@tanstack/react-router";
import { Menu, Search, ShoppingCart, User, LayoutDashboard, ShieldCheck } from "lucide-react";
import { useState } from "react";
import logo from "@/assets/zerah-logo.png";
import { ageGroups, useCategories, useSettings } from "@/lib/store";
import { useCart } from "@/lib/cart";
import { useSession } from "@/lib/auth";
import { useAdminMode } from "@/lib/admin-mode";
import { cn } from "@/lib/utils";

export function Header() {
  const { count } = useCart();
  const [open, setOpen] = useState(false);
  const { data: categories } = useCategories();
  const { brandName, announcement } = useSettings();
  const { user } = useSession();
  const { isAdmin, adminMode, toggleAdminMode } = useAdminMode();


  return (
    <header className="sticky top-0 z-50 w-full">
      <a
        href="#main"
        className="focus-ring sr-only z-[70] focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      <div className="relative overflow-hidden border-b border-primary-foreground/10 bg-[linear-gradient(100deg,var(--color-primary)_0%,color-mix(in_oklab,var(--color-primary)_80%,black)_45%,var(--color-accent)_100%)] text-primary-foreground">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(115deg,transparent_0%,color-mix(in_oklab,var(--color-primary-foreground)_100%,transparent)_50%,transparent_100%)] [background-size:220%_100%] animate-marquee"
          aria-hidden
        />
        <div
          className="relative flex whitespace-nowrap py-2 animate-marquee"
          style={{
            maskImage:
              "linear-gradient(to right, transparent, black 6%, black 94%, transparent)",
            WebkitMaskImage:
              "linear-gradient(to right, transparent, black 6%, black 94%, transparent)",
          }}
        >
          {[0, 1].map((k) => (
            <div key={k} className="flex shrink-0 items-center gap-8 pr-8" aria-hidden={k === 1}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="flex items-center gap-3 font-display text-[11px] font-semibold uppercase tracking-[0.32em] sm:text-xs md:text-[13px]"
                >
                  {announcement}
                  <span className="text-[9px] opacity-60">✦</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>



      <div className="border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2.5 sm:gap-4 sm:px-4 sm:py-3">
          <button
            className="focus-ring -ml-1 rounded-md p-2 text-foreground transition hover:bg-muted md:hidden"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <Menu className="size-5" />
          </button>

          <Link to="/" className="focus-ring flex min-w-0 items-center gap-2 rounded-lg transition-transform duration-300 hover:-translate-y-0.5">
            <img
              src={logo}
              alt={`${brandName} logo`}
              width={40}
              height={40}
              className="size-8 object-contain sm:size-10"
            />
            <span className="font-display text-base font-bold leading-none tracking-tight text-foreground sm:text-xl">
              Zerah <span className="text-primary">Baby</span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-[11px]">
                And Kids
              </span>
            </span>
          </Link>

          <form
            className="ml-auto hidden flex-1 items-center md:flex"
            onSubmit={(e) => e.preventDefault()}
            role="search"
          >
            <div className="relative w-full max-w-xl">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                placeholder="Search for onesies, strollers, diapers…"
                aria-label="Search products"
                className="w-full rounded-full border border-border bg-muted/60 py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-primary focus:bg-background"
              />
            </div>
          </form>

          <nav className="ml-auto flex items-center gap-0.5 sm:gap-1 md:ml-0">
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
              </>
            ) : (
              <Link
                to="/auth"
                className="focus-ring rounded-full p-2.5 text-foreground transition duration-300 hover:bg-muted hover:text-primary"
                aria-label="Sign in"
              >
                <User className="size-5" />
              </Link>
            )}
            <Link
              to="/cart"
              className="focus-ring relative rounded-full p-2.5 text-foreground transition duration-300 hover:bg-muted hover:text-primary"
              aria-label={`Cart with ${count} items`}
            >
              <ShoppingCart className="size-5" />
              {count > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">
                  {count}
                </span>
              )}
            </Link>
          </nav>
        </div>

        <form
          className="mx-auto max-w-7xl px-3 pb-2.5 md:hidden"
          onSubmit={(e) => e.preventDefault()}
          role="search"
        >
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              placeholder="Search products…"
              aria-label="Search products"
              className="w-full rounded-full border border-border bg-muted/60 py-2 pl-10 pr-4 text-sm outline-none transition focus:border-primary focus:bg-background"
            />
          </div>
        </form>


        <div className={cn("border-t border-border md:block", open ? "block" : "hidden")}>
          <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-2 text-sm font-medium md:flex-row md:items-center md:gap-6">
            <Link to="/shop" className="focus-ring relative w-fit py-1.5 transition-colors duration-300 after:absolute after:inset-x-0 after:bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:bg-primary after:transition-transform after:duration-300 hover:text-primary hover:after:scale-x-100" onClick={() => setOpen(false)}>
              All Products
            </Link>
            {(categories ?? []).map((c) => (
              <Link
                key={c.slug}
                to="/shop"
                search={{ category: c.slug }}
                className="focus-ring relative w-fit py-1.5 transition-colors duration-300 after:absolute after:inset-x-0 after:bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:bg-primary after:transition-transform after:duration-300 hover:text-primary hover:after:scale-x-100"
                onClick={() => setOpen(false)}
              >
                {c.name}
              </Link>
            ))}
            <Link to="/about" className="focus-ring relative w-fit py-1.5 transition-colors duration-300 after:absolute after:inset-x-0 after:bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:bg-primary after:transition-transform after:duration-300 hover:text-primary hover:after:scale-x-100" onClick={() => setOpen(false)}>
              About
            </Link>
            <Link to="/contact" className="focus-ring relative w-fit py-1.5 transition-colors duration-300 after:absolute after:inset-x-0 after:bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:bg-primary after:transition-transform after:duration-300 hover:text-primary hover:after:scale-x-100" onClick={() => setOpen(false)}>
              Contact
            </Link>

            <div className="flex items-center gap-2 py-1.5 md:ml-auto">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Age</span>
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
