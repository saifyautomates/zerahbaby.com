import { Link, useLocation } from "@tanstack/react-router";
import { Home, LayoutGrid, ShoppingBag, Heart, User } from "lucide-react";
import { cn } from "@/lib/utils";

export function BottomNav() {
  const location = useLocation();
  const currentPath = location.pathname;

  // On Checkout page, hide BottomNav so it does not block the checkout flow or overlap payment buttons
  if (currentPath === "/checkout" || currentPath.startsWith("/checkout")) {
    return null;
  }

  const navItems = [
    { label: "Home", path: "/", icon: Home },
    { label: "Categories", path: "/categories", icon: LayoutGrid },
    { label: "Orders", path: "/orders", icon: ShoppingBag },
    { label: "Wishlist", path: "/wishlist", icon: Heart },
    { label: "Account", path: "/profile", icon: User },
  ];

  return (
    <>
      {/* Spacer to prevent content from hiding behind the fixed bottom nav */}
      <div className="h-[4.5rem] md:hidden w-full shrink-0" />
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border/60 shadow-[0_-4px_24px_-12px_rgba(0,0,0,0.1)] w-full max-w-full overflow-hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center justify-around h-[4.5rem] px-2">
          {navItems.map((item) => {
            const isActive =
              item.path === "/" ? currentPath === "/" : currentPath.startsWith(item.path);
            const Icon = item.icon;

            return (
              <Link
                key={item.label}
                to={item.path}
                onClick={() => {
                  if (item.path === "/") {
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }
                }}
                className={cn(
                  "flex flex-col items-center justify-center w-full h-full gap-1 transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon
                  className={cn("size-5", isActive && "fill-primary/20")}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                <span className="text-[10px] font-semibold tracking-tight">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
