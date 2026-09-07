import { useState, useMemo } from "react";
import { Package, ChevronDown, ChevronUp, Tag, Layers, Archive, Info } from "lucide-react";
import { formatPrice } from "@/lib/store";
import type { Order, OrderItem } from "@/lib/orders";
import type { Product } from "@/lib/store";
import defaultPlaceholder from "@/assets/cat-clothing.jpg";

interface AdminOrderItemsListProps {
  order: Order & {
    _type?: "online" | "offline";
    offline_sale_items?: Array<{
      id: string;
      product_id?: string | null;
      product_name?: string;
      product_name_snapshot?: string;
      product_slug?: string;
      variant_id?: string | null;
      variant_sku?: string | null;
      sku_snapshot?: string | null;
      variant_color?: string | null;
      variant_size?: string | null;
      color?: string | null;
      size?: string | null;
      price: number;
      qty: number;
      quantity?: number;
      line_subtotal?: number;
      subtotal?: number;
      image_url?: string | null;
      image_url_snapshot?: string | null;
    }>;
  };
  products?: Product[];
  defaultExpanded?: boolean;
}

export function AdminOrderItemsList({
  order,
  products = [],
  defaultExpanded = false,
}: AdminOrderItemsListProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Normalize order items (supports both online order_items and offline_sale_items)
  const items = useMemo(() => {
    if (order.order_items && order.order_items.length > 0) {
      return order.order_items.map((oi) => ({
        id: oi.id,
        productId: oi.product_id,
        variantId: oi.variant_id,
        name: oi.product_name_snapshot || oi.name || "Product",
        sku: oi.sku_snapshot || "N/A",
        barcode: oi.barcode_snapshot || null,
        color: oi.color_snapshot || oi.color || null,
        size: oi.size_snapshot || oi.size || null,
        pack: oi.pack_snapshot || oi.pack || null,
        image: oi.image_url_snapshot || oi.image_url || null,
        price: Number(oi.price || oi.price_at_time || 0),
        mrp: oi.mrp !== undefined && oi.mrp !== null ? Number(oi.mrp) : null,
        qty: Number(oi.qty || oi.quantity || 1),
        subtotal: Number(oi.subtotal || oi.price * (oi.qty || oi.quantity || 1)),
      }));
    }

    if (order.offline_sale_items && order.offline_sale_items.length > 0) {
      return order.offline_sale_items.map((osi) => ({
        id: osi.id,
        productId: osi.product_id,
        variantId: osi.variant_id,
        name: osi.product_name_snapshot || osi.product_name || "In-store Item",
        sku: osi.sku_snapshot || osi.variant_sku || "N/A",
        barcode: null,
        color: osi.color || osi.variant_color || null,
        size: osi.size || osi.variant_size || null,
        pack: null,
        image: osi.image_url_snapshot || osi.image_url || null,
        price: Number(osi.price || 0),
        mrp: null,
        qty: Number(osi.qty || osi.quantity || 1),
        subtotal: Number(
          osi.line_subtotal || osi.subtotal || osi.price * (osi.qty || osi.quantity || 1),
        ),
      }));
    }

    return [];
  }, [order.order_items, order.offline_sale_items]);

  const totalQuantity = useMemo(() => items.reduce((acc, it) => acc + it.qty, 0), [items]);

  const orderSubtotal = Number(order.subtotal || items.reduce((acc, it) => acc + it.subtotal, 0));
  const orderDiscount = Number(order.discount || 0);
  const orderShipping = Number(order.shipping || 0);
  const orderGrandTotal = Number(order.total || 0);

  if (items.length === 0) {
    return (
      <div className="mt-4 rounded-2xl border border-dashed border-border/70 p-3.5 text-xs text-muted-foreground bg-muted/20 flex items-center gap-2">
        <Info className="size-4 shrink-0 text-muted-foreground/60" />
        <span>No line item details recorded for this transaction.</span>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border border-border/80 bg-muted/15 overflow-hidden transition-all duration-200">
      {/* ─── EXPANDABLE HEADER / COMPACT PREVIEW BAR ─── */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsExpanded((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsExpanded((prev) => !prev);
          }
        }}
        className="w-full flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 hover:bg-muted/30 transition cursor-pointer select-none"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 border border-primary/20">
            <Package className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm text-foreground">
                Products ({items.length} {items.length === 1 ? "item" : "items"} · {totalQuantity}{" "}
                units)
              </span>
              {order.coupon_code && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                  <Tag className="size-2.5" />
                  {order.coupon_code} (-{formatPrice(orderDiscount)})
                </span>
              )}
            </div>

            {/* Thumbnail previews when collapsed */}
            {!isExpanded && (
              <div className="flex items-center gap-1.5 mt-2 overflow-x-auto py-0.5">
                {items.slice(0, 5).map((it) => (
                  <div
                    key={it.id}
                    title={`${it.name} (Qty: ${it.qty})`}
                    className="size-7 rounded-md border border-border bg-background overflow-hidden shrink-0 relative"
                  >
                    <img
                      src={it.image || defaultPlaceholder}
                      alt={it.name}
                      className="size-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = defaultPlaceholder;
                      }}
                    />
                    {it.qty > 1 && (
                      <span className="absolute bottom-0 right-0 bg-foreground/90 text-background text-[9px] font-bold px-1 rounded-tl">
                        ×{it.qty}
                      </span>
                    )}
                  </div>
                ))}
                {items.length > 5 && (
                  <span className="text-[10px] font-bold text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
                    +{items.length - 5} more
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
          <span className="text-xs font-bold text-primary">
            {isExpanded ? "Hide Details" : "View Details"}
          </span>
          <div className="p-1 rounded-full bg-muted text-muted-foreground">
            {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </div>
        </div>
      </div>

      {/* ─── DETAILED PRODUCT LIST & ORDER BREAKDOWN ─── */}
      {isExpanded && (
        <div className="border-t border-border/70 p-4 sm:p-5 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <ul className="divide-y divide-border/60">
            {items.map((item, idx) => {
              // Lookup live product for stock reference (never overwriting historical prices/names)
              const catalogProduct = products.find(
                (p) =>
                  (item.productId && p.uuid === item.productId) ||
                  p.id === item.productId ||
                  (item.name && p.name.toLowerCase() === item.name.toLowerCase()),
              );

              const catalogVariant = catalogProduct?.variants?.find(
                (v) =>
                  (item.variantId && v.id === item.variantId) ||
                  (item.sku && v.sku && v.sku.toLowerCase() === item.sku.toLowerCase()) ||
                  (item.color &&
                    v.color &&
                    v.color.toLowerCase() === item.color.toLowerCase() &&
                    item.size &&
                    v.size &&
                    v.size.toLowerCase() === item.size.toLowerCase()),
              );

              // 1. MRP calculation
              const effectiveMrp =
                item.mrp || catalogVariant?.mrpOverride || catalogProduct?.mrp || item.price;

              // 2. Product-level discount (MRP vs Original Selling Price)
              const productDiscountPerUnit = Math.max(0, effectiveMrp - item.price);
              const totalProductDiscount = productDiscountPerUnit * item.qty;

              // 3. Allocated bill/coupon discount (proportional to item share of order subtotal)
              let allocatedDiscount = 0;
              if (orderDiscount > 0 && orderSubtotal > 0) {
                const ratio = item.subtotal / orderSubtotal;
                allocatedDiscount = Math.round(orderDiscount * ratio);
              }
              const allocatedDiscountPerUnit = item.qty > 0 ? allocatedDiscount / item.qty : 0;

              // 4. Final paid unit price & line total
              const finalPaidUnitPrice = Math.max(0, item.price - allocatedDiscountPerUnit);
              const lineTotal = Math.max(0, item.subtotal - allocatedDiscount);

              return (
                <li
                  key={item.id || idx}
                  className={`py-4 first:pt-0 last:pb-0 flex flex-col md:flex-row md:items-start justify-between gap-4`}
                >
                  {/* Left: Product Image & Attributes */}
                  <div className="flex items-start gap-3.5 min-w-0 flex-1">
                    <div className="size-16 sm:size-20 rounded-xl border border-border bg-background overflow-hidden shrink-0 shadow-2xs">
                      <img
                        src={
                          item.image ||
                          catalogVariant?.imageUrl ||
                          catalogProduct?.image ||
                          defaultPlaceholder
                        }
                        alt={item.name}
                        className="size-full object-cover object-center"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = defaultPlaceholder;
                        }}
                      />
                    </div>

                    <div className="space-y-1.5 min-w-0 flex-1">
                      <h4 className="font-bold text-sm sm:text-base text-foreground leading-snug break-words">
                        {item.name}
                      </h4>

                      {/* Variant Attributes Pills */}
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        {item.color && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-muted/80 px-2 py-0.5 text-xs font-semibold text-foreground border border-border/70">
                            <span className="text-muted-foreground font-normal">Colour:</span>
                            <span>{item.color}</span>
                          </span>
                        )}

                        {item.size && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-muted/80 px-2 py-0.5 text-xs font-semibold text-foreground border border-border/70">
                            <span className="text-muted-foreground font-normal">Size:</span>
                            <span>{item.size}</span>
                          </span>
                        )}

                        {item.pack && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-muted/80 px-2 py-0.5 text-xs font-semibold text-foreground border border-border/70">
                            <span className="text-muted-foreground font-normal">Pack:</span>
                            <span>{item.pack}</span>
                          </span>
                        )}

                        {/* SKU Reference */}
                        <span className="inline-flex items-center gap-1 rounded-md bg-background px-2 py-0.5 text-xs font-mono font-medium text-muted-foreground border border-border/70">
                          SKU: {item.sku}
                        </span>

                        {/* Live Catalog Stock Reference (if variant exists) */}
                        {catalogVariant ? (
                          <span
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold border ${
                              catalogVariant.stock > 0
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
                                : "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20"
                            }`}
                          >
                            <Layers className="size-3" />
                            Stock: {catalogVariant.stock} in store
                          </span>
                        ) : catalogProduct ? (
                          <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium bg-muted text-muted-foreground border border-border/60">
                            Product active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium bg-amber-500/10 text-amber-800 dark:text-amber-400 border border-amber-500/20">
                            <Archive className="size-3" />
                            Archived / Deleted
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Detailed Price & Discount Matrix */}
                  <div className="bg-background sm:bg-transparent p-3 sm:p-0 rounded-xl border sm:border-0 border-border/60 flex flex-col sm:items-end justify-between text-xs space-y-1.5 shrink-0 sm:min-w-[210px]">
                    <div className="flex items-center justify-between sm:justify-end gap-3 w-full">
                      <span className="text-muted-foreground font-medium sm:hidden">Quantity:</span>
                      <span className="font-bold text-sm bg-primary/10 text-primary px-2.5 py-0.5 rounded-full border border-primary/20">
                        Qty: {item.qty}
                      </span>
                    </div>

                    {/* Price Breakdown */}
                    <div className="w-full space-y-1 pt-1 border-t sm:border-t-0 border-border/40">
                      {effectiveMrp > item.price && (
                        <div className="flex items-center justify-between sm:justify-end gap-2 text-muted-foreground">
                          <span>MRP:</span>
                          <span className="line-through">
                            {formatPrice(effectiveMrp * item.qty)}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            ({formatPrice(effectiveMrp)}/u)
                          </span>
                        </div>
                      )}

                      <div className="flex items-center justify-between sm:justify-end gap-2">
                        <span className="text-muted-foreground">Original Selling:</span>
                        <span className="font-semibold text-foreground">
                          {formatPrice(item.subtotal)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          ({formatPrice(item.price)}/u)
                        </span>
                      </div>

                      {totalProductDiscount > 0 && (
                        <div className="flex items-center justify-between sm:justify-end gap-2 text-emerald-600 dark:text-emerald-400">
                          <span>Product Discount:</span>
                          <span>-{formatPrice(totalProductDiscount)}</span>
                        </div>
                      )}

                      {allocatedDiscount > 0 && (
                        <div className="flex items-center justify-between sm:justify-end gap-2 text-emerald-600 dark:text-emerald-400 font-medium">
                          <span>Allocated Coupon:</span>
                          <span>-{formatPrice(allocatedDiscount)}</span>
                        </div>
                      )}

                      <div className="flex items-center justify-between sm:justify-end gap-2 font-bold pt-1 border-t border-border/60">
                        <span className="text-foreground">Paid:</span>
                        <span className="text-primary font-bold">
                          {formatPrice(finalPaidUnitPrice)}/unit
                        </span>
                        <span className="text-muted-foreground text-[10px] font-normal">
                          · Line:
                        </span>
                        <span className="text-foreground text-sm font-extrabold">
                          {formatPrice(lineTotal)}
                        </span>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* ─── ORDER SUMMARY BOX ─── */}
          <div className="mt-4 pt-4 border-t border-border/80 bg-background/80 rounded-xl p-4 border border-border/60">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Order Financial Summary
              </span>
              <span className="text-[11px] text-muted-foreground">
                Authoritative transaction ledger
              </span>
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Subtotal (Items Total):</span>
                <span className="font-semibold text-foreground">{formatPrice(orderSubtotal)}</span>
              </div>

              {orderDiscount > 0 && (
                <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400 font-medium">
                  <span className="flex items-center gap-1.5">
                    <Tag className="size-3" />
                    <span>Discount {order.coupon_code ? `(${order.coupon_code})` : ""}:</span>
                  </span>
                  <span>-{formatPrice(orderDiscount)}</span>
                </div>
              )}

              <div className="flex items-center justify-between text-muted-foreground">
                <span>Shipping / Delivery:</span>
                <span>{orderShipping > 0 ? formatPrice(orderShipping) : "FREE"}</span>
              </div>

              {order.payment_method?.toLowerCase() === "cod" && (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>COD Handling Fee:</span>
                  <span>
                    {orderGrandTotal > orderSubtotal - orderDiscount + orderShipping
                      ? formatPrice(
                          orderGrandTotal - (orderSubtotal - orderDiscount + orderShipping),
                        )
                      : "Included"}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between text-muted-foreground">
                <span>Tax / GST:</span>
                <span className="text-[11px]">Included in prices</span>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-border/70 text-sm font-extrabold text-foreground">
                <span>Grand Total:</span>
                <span className="text-base text-primary font-black">
                  {formatPrice(orderGrandTotal)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
