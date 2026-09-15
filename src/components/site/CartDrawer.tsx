import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  X,
  ChevronLeft,
  Trash2,
  Minus,
  Plus,
  ShoppingBag,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  Tag,
} from "lucide-react";
import { useCart } from "@/lib/cart";
import { formatPrice, imageFor } from "@/lib/store";

export function CartDrawer() {
  const {
    items,
    count,
    subtotal,
    savings,
    total,
    shipping,
    isFreeDelivery,
    freeDeliveryMessage,
    amountToFreeDelivery,
    setQty,
    remove,
    isDrawerOpen,
    closeDrawer,
  } = useCart();

  const navigate = useNavigate();
  const [isMounted, setIsMounted] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Client-side mount check for portal
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Lock background scroll when drawer is open
  useEffect(() => {
    if (!isDrawerOpen) return;

    const originalOverflow = document.body.style.overflow;
    const originalTouchAction = document.body.style.touchAction;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.touchAction = originalTouchAction;
      document.body.style.paddingRight = "";
    };
  }, [isDrawerOpen]);

  // Handle ESC key to dismiss drawer
  useEffect(() => {
    if (!isDrawerOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeDrawer();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDrawerOpen, closeDrawer]);

  // Handle browser back button (popstate) to dismiss mobile drawer gracefully
  useEffect(() => {
    if (!isDrawerOpen) return;

    // Push state so back button closes drawer instead of exiting page
    window.history.pushState({ zerahCartDrawer: true }, "");

    const handlePopState = () => {
      closeDrawer();
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [isDrawerOpen, closeDrawer]);

  if (!isMounted || typeof document === "undefined") {
    return null;
  }

  const handleCheckoutClick = () => {
    closeDrawer();
    navigate({ to: "/checkout" });
  };

  const handleViewFullCart = () => {
    closeDrawer();
    navigate({ to: "/cart" });
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Your Shopping Bag"
      className={`fixed inset-0 z-[120] transition-visibility duration-300 ${
        isDrawerOpen ? "visible pointer-events-auto" : "invisible pointer-events-none"
      }`}
    >
      {/* 1. Backdrop Dim Overlay */}
      <div
        onClick={closeDrawer}
        aria-hidden="true"
        className={`fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity duration-300 ease-out ${
          isDrawerOpen ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* 2. Slide-In Right Drawer Container */}
      <aside
        ref={drawerRef}
        className={`fixed inset-y-0 right-0 flex w-full max-w-[420px] sm:max-w-md flex-col bg-background shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] pointer-events-auto border-l border-border/60 ${
          isDrawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
        style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        {/* Drawer Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border/70 bg-background/95 backdrop-blur-md shrink-0 z-10">
          <button
            type="button"
            onClick={closeDrawer}
            className="flex items-center gap-1.5 text-foreground hover:text-primary transition-colors cursor-pointer py-1 pr-2 -ml-1 rounded-lg focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Back to shopping"
          >
            <ChevronLeft className="size-5 shrink-0" />
            <h2 className="font-display text-base sm:text-lg font-bold tracking-tight">
              Your Shopping Bag {count > 0 && <span className="text-primary font-bold">({count})</span>}
            </h2>
          </button>

          <button
            type="button"
            onClick={closeDrawer}
            className="size-9 rounded-full bg-muted/70 hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Close cart drawer"
          >
            <X className="size-4.5" />
          </button>
        </div>

        {/* Promotional Delivery / Savings Banner */}
        <div className="bg-stone-900 text-white dark:bg-stone-950 dark:border-b dark:border-border/60 px-4 py-2.5 text-xs font-semibold shrink-0 flex items-center justify-between gap-2 shadow-inner">
          <div className="flex items-center gap-2 truncate">
            <Sparkles className="size-4 text-amber-400 shrink-0 animate-pulse" />
            <span className="truncate">
              {isFreeDelivery
                ? "🎉 You have unlocked FREE DELIVERY!"
                : freeDeliveryMessage
                  ? freeDeliveryMessage.replace("{amount}", String(amountToFreeDelivery))
                  : `Add ₹${amountToFreeDelivery} more for FREE DELIVERY 🎉`}
            </span>
          </div>
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider bg-amber-400 text-stone-950 px-1.5 py-0.5 rounded-full">
            Special
          </span>
        </div>

        {/* Drawer Body — Independently Scrollable */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-3 focus:outline-none">
          {items.length === 0 ? (
            /* Empty State */
            <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-center p-6 space-y-4">
              <div className="size-20 rounded-3xl bg-muted/60 flex items-center justify-center text-muted-foreground/80 shadow-inner">
                <ShoppingBag className="size-10 stroke-[1.5]" />
              </div>
              <div className="space-y-1.5">
                <h3 className="font-display text-lg font-bold text-foreground">
                  Oops! Your Bag is Empty
                </h3>
                <p className="text-xs text-muted-foreground max-w-[240px]">
                  Looks like you haven't added anything to your shopping bag yet.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  closeDrawer();
                  navigate({ to: "/shop" });
                }}
                className="rounded-full bg-primary px-6 py-2.5 text-xs font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition-all cursor-pointer"
              >
                Start Shopping
              </button>
            </div>
          ) : (
            /* Cart Items List */
            <ul className="space-y-3" role="list">
              {items.map((cartItem) => {
                const { product, qty, variantId, variant, price, mrp, stock, color, size, image } =
                  cartItem;
                const hasDiscount = mrp > price;
                const itemKey = `${product.id}-${variantId || "default"}`;

                return (
                  <li
                    key={itemKey}
                    className="relative flex gap-3 rounded-2xl border border-border/80 bg-card p-3 shadow-2xs transition-all hover:border-primary/40"
                  >
                    {/* Thumbnail Image */}
                    <Link
                      to="/product/$id"
                      params={{ id: product.id }}
                      onClick={closeDrawer}
                      className="size-20 shrink-0 rounded-xl overflow-hidden bg-muted border border-border/60 block hover:opacity-90 transition-opacity"
                    >
                      <img
                        src={image || product.image}
                        alt={product.name}
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = imageFor(
                            product.category,
                            null,
                            product,
                          );
                        }}
                        className="size-full object-cover object-center"
                      />
                    </Link>

                    {/* Content Details */}
                    <div className="flex-1 min-w-0 flex flex-col justify-between">
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <Link
                            to="/product/$id"
                            params={{ id: product.id }}
                            onClick={closeDrawer}
                            className="font-medium text-xs sm:text-sm text-foreground line-clamp-2 hover:text-primary transition-colors leading-tight"
                          >
                            {product.name}
                          </Link>

                          {/* Quick Remove Icon */}
                          <button
                            type="button"
                            onClick={() => remove(product.id, variantId)}
                            className="text-muted-foreground/60 hover:text-destructive p-1 -mr-1 -mt-1 transition-colors cursor-pointer rounded-md"
                            aria-label={`Remove ${product.name} from bag`}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>

                        {/* Variant Chips */}
                        {(color || size || (variant && variant.name !== "Default")) && (
                          <div className="mt-1 flex flex-wrap gap-1 items-center">
                            {color && (
                              <span className="text-[10px] font-semibold bg-muted/80 text-foreground px-1.5 py-0.5 rounded">
                                {color}
                              </span>
                            )}
                            {size && (
                              <span className="text-[10px] font-semibold bg-muted/80 text-foreground px-1.5 py-0.5 rounded">
                                {size}
                              </span>
                            )}
                            {!color && !size && variant && variant.name !== "Default" && (
                              <span className="text-[10px] font-semibold bg-muted/80 text-foreground px-1.5 py-0.5 rounded">
                                {variant.name}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Price & Quantity Controls */}
                      <div className="mt-2.5 flex items-center justify-between gap-2 pt-1 border-t border-border/40">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-sm font-bold text-foreground">
                            {formatPrice(price * qty)}
                          </span>
                          {hasDiscount && (
                            <span className="text-[11px] text-muted-foreground/70 line-through">
                              {formatPrice(mrp * qty)}
                            </span>
                          )}
                        </div>

                        {/* Modern Rounded Stepper */}
                        <div className="flex items-center gap-1 rounded-full border border-border/80 bg-background px-1.5 py-0.5 shadow-2xs">
                          <button
                            type="button"
                            onClick={() => {
                              if (qty <= 1) {
                                remove(product.id, variantId);
                              } else {
                                setQty(product.id, qty - 1, variantId);
                              }
                            }}
                            aria-label="Decrease quantity"
                            className="size-6 rounded-full flex items-center justify-center hover:bg-muted text-foreground transition-colors cursor-pointer"
                          >
                            {qty === 1 ? (
                              <Trash2 className="size-3 text-destructive" />
                            ) : (
                              <Minus className="size-3" />
                            )}
                          </button>
                          <span className="w-5 text-center text-xs font-bold tabular-nums">
                            {qty}
                          </span>
                          <button
                            type="button"
                            disabled={qty >= stock}
                            onClick={() => setQty(product.id, qty + 1, variantId)}
                            aria-label="Increase quantity"
                            className="size-6 rounded-full flex items-center justify-center hover:bg-muted text-foreground transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <Plus className="size-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Savings Highlight Badge */}
          {savings > 0 && items.length > 0 && (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 p-2.5 text-xs text-emerald-800 dark:text-emerald-300 font-medium">
              <Tag className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>
                You are saving <strong className="font-bold">{formatPrice(savings)}</strong> on this order!
              </span>
            </div>
          )}
        </div>

        {/* Drawer Footer — Fixed Bottom with Safe Area */}
        {items.length > 0 && (
          <div className="border-t border-border/80 bg-card p-4 space-y-3 shrink-0 shadow-lg">
            {/* Price Breakdown */}
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Subtotal ({count} items)</span>
                <span className="font-medium text-foreground">{formatPrice(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>Delivery Charge</span>
                <span>
                  {isFreeDelivery ? (
                    <strong className="text-emerald-600 font-bold uppercase tracking-wider">
                      FREE
                    </strong>
                  ) : (
                    formatPrice(shipping)
                  )}
                </span>
              </div>
              <div className="flex justify-between text-sm font-bold text-foreground pt-1.5 border-t border-border/50">
                <span>Estimated Total</span>
                <span className="text-base text-primary font-black">{formatPrice(total)}</span>
              </div>
            </div>

            {/* Prominent Checkout / Pay Online CTA */}
            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={handleCheckoutClick}
                className="w-full flex items-center justify-center gap-2 rounded-full bg-primary hover:bg-primary/95 text-primary-foreground py-3.5 px-6 font-bold text-sm shadow-premium-sm transition-all cursor-pointer active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span>Continue to Checkout</span>
                <ArrowRight className="size-4" />
              </button>

              <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
                <span className="flex items-center gap-1">
                  <ShieldCheck className="size-3.5 text-emerald-600" />
                  100% Secure Checkout
                </span>
                <button
                  type="button"
                  onClick={handleViewFullCart}
                  className="font-bold text-primary hover:underline cursor-pointer"
                >
                  View Full Cart →
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>,
    document.body,
  );
}
