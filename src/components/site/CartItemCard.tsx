import { Link } from "@tanstack/react-router";
import { Trash2, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { formatPrice, imageFor } from "@/lib/store";
import type { CartItem } from "@/lib/cart";

export interface CartItemCardProps {
  item: CartItem;
  onSetQty: (id: string, qty: number, variantId?: string) => void;
  onRemove: (id: string, variantId?: string) => void;
  isHighlighted?: boolean;
  compact?: boolean;
}

export function CartItemCard({
  item,
  onSetQty,
  onRemove,
  isHighlighted = false,
  compact = false,
}: CartItemCardProps) {
  const { product, qty, variantId, variant, price, mrp, stock, color, size, image, sku } = item;

  const hasDiscount = mrp > price;
  const savingsAmount = hasDiscount ? mrp - price : 0;
  const savingsPct = hasDiscount && mrp > 0 ? Math.round((savingsAmount / mrp) * 100) : 0;

  return (
    <li
      id={`cart-item-${product.id}-${variantId || "default"}`}
      data-testid={`cart-item-${product.id}-${variantId || "default"}`}
      className={`flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4 rounded-2xl border bg-card p-3 sm:p-4 transition-all duration-300 ${
        isHighlighted
          ? "border-primary ring-2 ring-primary/20 shadow-premium-md"
          : "border-border/60 shadow-premium-sm hover:shadow-premium-md"
      }`}
    >
      <div className="flex flex-1 gap-3 sm:gap-4 min-w-0">
        <Link
          to="/product/$id"
          params={{ id: product.id }}
          className={`${
            compact ? "size-16 sm:size-20" : "size-20 sm:size-24"
          } shrink-0 rounded-xl overflow-hidden bg-muted hover:opacity-90 transition block border border-border/60`}
          title={`View ${product.name}`}
        >
          <img
            src={image || product.image}
            alt={product.name}
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).src = imageFor(product.category, null, product);
            }}
            className="w-full h-full object-cover object-center"
          />
        </Link>

        <div className="flex-1 min-w-0">
          <p className="text-[10px] sm:text-xs uppercase tracking-wide text-muted-foreground truncate">
            {product.brand}
          </p>
          <h2 className="text-sm font-semibold text-foreground line-clamp-1 sm:line-clamp-2">
            <Link to="/product/$id" params={{ id: product.id }} className="hover:text-primary">
              {product.name}
            </Link>
          </h2>

          {/* Variant Badges (Color, Size, or Custom Variant Name) */}
          {(color || size || (variant && variant.name !== "Default")) && (
            <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
              {color && (
                <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary px-2 py-0.5 font-semibold text-[11px]">
                  Color: {color}
                </span>
              )}
              {size && (
                <span className="inline-flex items-center rounded-md bg-muted text-foreground px-2 py-0.5 font-semibold text-[11px]">
                  Size: {size}
                </span>
              )}
              {!color && !size && variant && variant.name !== "Default" && (
                <span className="inline-flex items-center rounded-md bg-muted text-foreground px-2 py-0.5 font-semibold text-[11px]">
                  {variant.name}
                </span>
              )}
            </div>
          )}

          {sku && <p className="text-xs font-mono text-muted-foreground mt-0.5">SKU: {sku}</p>}

          {/* Price, MRP, and Savings */}
          <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-bold text-foreground">{formatPrice(price)}</span>
            {hasDiscount && (
              <span className="text-xs text-muted-foreground line-through">{formatPrice(mrp)}</span>
            )}
            {hasDiscount && (
              <span className="text-[10px] font-bold text-green-600 bg-green-50 dark:bg-green-950/40 dark:text-green-400 px-1.5 py-0.5 rounded">
                Save {formatPrice(savingsAmount)} ({savingsPct}% OFF)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Quantity & Actions Bar */}
      <div className="flex items-center justify-between sm:flex-col sm:items-end gap-3 sm:gap-4 mt-2 sm:mt-0 pt-2 sm:pt-0 border-t sm:border-0 border-border/40">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 rounded-full border border-border px-3 py-1.5 bg-background shadow-xs">
            <button
              type="button"
              onClick={() => onSetQty(product.id, qty - 1, variantId)}
              aria-label="Decrease quantity"
              className="hover:text-primary transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
            >
              <Minus className="size-3.5" />
            </button>
            <span className="w-5 text-center text-sm font-semibold tabular-nums">{qty}</span>
            <button
              type="button"
              disabled={qty >= stock}
              onClick={() => {
                if (qty >= stock) {
                  toast.error("Max stock reached for this item");
                  return;
                }
                onSetQty(product.id, qty + 1, variantId);
              }}
              aria-label="Increase quantity"
              className="hover:text-primary transition-colors disabled:cursor-not-allowed disabled:opacity-30 cursor-pointer text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => onRemove(product.id, variantId)}
            className="flex items-center gap-1 text-xs text-muted-foreground transition hover:text-destructive cursor-pointer"
            aria-label="Remove item from bag"
          >
            <Trash2 className="size-3.5" />
            <span className="hidden sm:inline">Remove</span>
          </button>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground sm:hidden mb-0.5">Total</p>
          <p className="text-sm font-bold sm:text-base tabular-nums text-foreground">
            {formatPrice(price * qty)}
          </p>
        </div>
      </div>
    </li>
  );
}
