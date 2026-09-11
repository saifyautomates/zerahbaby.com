import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useProducts, formatPrice } from "@/lib/store";
import { useCart } from "@/lib/cart";
import { useSession, useIsAdmin } from "@/lib/auth";
import {
  useMyOrders,
  useCancelCustomerOrder,
  isOrderCancellable,
  isOrderReturnable,
  isOpenBoxEligible,
  type Order,
} from "@/lib/orders";
import {
  useMyReturns,
  type OnlineReturn,
  RETURN_STATUS_BADGES,
  REFUND_STATUS_BADGES,
} from "@/lib/online-returns";
import { OnlineReturnModal } from "@/components/site/OnlineReturnModal";
import { OnlineReturnDetailsModal } from "@/components/site/OnlineReturnDetailsModal";
import { OpenBoxActionModal } from "@/components/site/OpenBoxActionModal";
import { InvoiceBox } from "@/components/site/Invoice";
import { ReviewModal } from "@/components/site/ReviewModal";
import {
  Star,
  RotateCcw,
  PackageCheck,
  Eye,
  Package,
  Truck,
  CheckCircle2,
  Clock,
  XCircle,
  Copy,
  Check,
  Search,
  RefreshCw,
  ShoppingBag,
  ChevronDown,
  ChevronUp,
  MapPin,
  ExternalLink,
  CreditCard,
  Banknote,
  ShieldCheck,
  HelpCircle,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { OrdersSkeleton } from "@/components/ui/Skeletons";
import clothing from "@/assets/cat-clothing.jpg";

export const Route = createFileRoute("/_authenticated/orders")({
  head: () => ({
    meta: [
      { title: "Your Orders — Zérah Baby & Kids" },
      { name: "description", content: "Track, manage, reorder, and review your Zérah Baby & Kids purchases." },
      { property: "og:title", content: "Your Orders — Zérah Baby & Kids" },
      { property: "og:description", content: "Track your orders, view invoices, and manage returns." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: OrdersPage,
});

const CANCELLATION_REASONS = [
  "Changed my mind",
  "Ordered by mistake",
  "Found a different product / cheaper alternative",
  "Delivery taking too long",
  "Incorrect shipping address",
  "Other",
];

type FilterTab = "all" | "active" | "delivered" | "cancelled";

const TRACKING_STEPS = [
  { key: "ordered", label: "Ordered" },
  { key: "processing", label: "Confirmed & Packed" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
];

function getOrderStepIndex(status: string): number {
  const s = (status || "").toLowerCase();
  if (s === "cancelled" || s === "returned") return -1;
  if (s === "delivered" || s === "open_box_accepted") return 3;
  if (s === "out_for_delivery" || s === "open_box_inspection") return 2.5;
  if (s === "shipped") return 2;
  if (s === "processing" || s === "packed" || s === "confirmed") return 1;
  return 0; // placed / pending
}

function OrdersPage() {
  const { user } = useSession();
  const qc = useQueryClient();
  const { add: addToCart } = useCart();
  const { data: orders, isLoading, isRefetching, refetch } = useMyOrders(user?.id);
  const { data: returns } = useMyReturns(user?.id);
  const { data: products } = useProducts();
  const { data: isAdmin } = useIsAdmin(user?.id);

  // Filter and search state
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Modals state
  const [cancellingOrder, setCancellingOrder] = useState<Order | null>(null);
  const [returningOrder, setReturningOrder] = useState<Order | null>(null);
  const [viewingReturn, setViewingReturn] = useState<OnlineReturn | null>(null);
  const [openBoxOrder, setOpenBoxOrder] = useState<Order | null>(null);
  const [trackingOrder, setTrackingOrder] = useState<Order | null>(null);
  const [reviewingProduct, setReviewingProduct] = useState<{
    product: { id: string; uuid: string; name: string; image?: string; brand?: string };
    orderId: string;
  } | null>(null);

  // Address popover open states
  const [openAddressId, setOpenAddressId] = useState<string | null>(null);

  // Real-time synchronization: subscribe to public.orders for instant status updates
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`customer-orders-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["my-orders", user.id] });
          qc.invalidateQueries({ queryKey: ["order-history"] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, qc]);

  const returnsByOrderId = useMemo(() => {
    const map: Record<string, OnlineReturn[]> = {};
    for (const ret of returns || []) {
      if (!map[ret.order_id]) map[ret.order_id] = [];
      map[ret.order_id].push(ret);
    }
    return map;
  }, [returns]);

  // Tab counts
  const tabCounts = useMemo(() => {
    const all = orders ?? [];
    return {
      all: all.length,
      active: all.filter((o) =>
        [
          "placed",
          "pending",
          "confirmed",
          "processing",
          "packed",
          "shipped",
          "out_for_delivery",
          "open_box_inspection",
        ].includes(o.status.toLowerCase()),
      ).length,
      delivered: all.filter((o) =>
        ["delivered", "open_box_accepted"].includes(o.status.toLowerCase()),
      ).length,
      cancelled: all.filter((o) =>
        [
          "cancelled",
          "returned",
          "return_in_transit",
          "return_received",
          "open_box_rejected",
        ].includes(o.status.toLowerCase()),
      ).length,
    };
  }, [orders]);

  // Filtered and searched orders
  const filteredOrders = useMemo(() => {
    let list = orders ?? [];

    // Tab filter
    if (activeTab === "active") {
      list = list.filter((o) =>
        [
          "placed",
          "pending",
          "confirmed",
          "processing",
          "packed",
          "shipped",
          "out_for_delivery",
          "open_box_inspection",
        ].includes(o.status.toLowerCase()),
      );
    } else if (activeTab === "delivered") {
      list = list.filter((o) =>
        ["delivered", "open_box_accepted"].includes(o.status.toLowerCase()),
      );
    } else if (activeTab === "cancelled") {
      list = list.filter((o) =>
        [
          "cancelled",
          "returned",
          "return_in_transit",
          "return_received",
          "open_box_rejected",
        ].includes(o.status.toLowerCase()),
      );
    }

    // Search query filter
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((o) => {
        const orderNum = (o.order_number || o.id || "").toLowerCase();
        const invoiceNum = (o.invoice_no || "").toLowerCase();
        const customerName = (o.full_name || "").toLowerCase();
        const itemMatch = o.order_items?.some((it) =>
          (it.name || it.product_slug || "").toLowerCase().includes(q),
        );
        return (
          orderNum.includes(q) ||
          invoiceNum.includes(q) ||
          customerName.includes(q) ||
          itemMatch
        );
      });
    }

    return list;
  }, [orders, activeTab, searchQuery]);

  const handleBuyAgain = useCallback(
    (productSlug: string, variantId?: string | null, productName?: string) => {
      addToCart(productSlug, 1, variantId || undefined);
      toast.success(
        `Added “${productName || "Item"}” to bag!`,
        {
          description: "Ready to checkout whenever you are.",
          action: {
            label: "View Bag",
            onClick: () => {
              if (typeof window !== "undefined") {
                window.location.href = "/cart";
              }
            },
          },
        },
      );
    },
    [addToCart],
  );

  if (isLoading) {
    return <OrdersSkeleton />;
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 sm:py-12">
      {/* ── HEADER / AMAZON BREADCRUMB + TITLE ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border/80">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Link to="/" className="hover:text-foreground transition">Home</Link>
            <span>/</span>
            <Link to="/profile" className="hover:text-foreground transition">Your Account</Link>
            <span>/</span>
            <span className="text-foreground font-semibold">Your Orders</span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Your Orders
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Track shipments, reorder favorites, download invoices, or manage returns.
          </p>
        </div>

        {/* Sync / Refresh Action */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isRefetching}
            aria-label="Refresh orders"
            className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background hover:bg-muted px-3.5 py-1.5 text-xs font-semibold text-foreground transition shadow-2xs cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`size-3.5 text-muted-foreground ${isRefetching ? "animate-spin text-primary" : ""}`} />
            <span>{isRefetching ? "Updating…" : "Refresh"}</span>
          </button>
        </div>
      </div>

      {/* ── AMAZON-STYLE SEARCH & FILTER BAR ── */}
      <div className="mt-6 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Filter Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none border-b md:border-b-0 border-border/60">
          <button
            type="button"
            onClick={() => setActiveTab("all")}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-xl transition cursor-pointer whitespace-nowrap ${
              activeTab === "all"
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            }`}
          >
            <span>All Orders</span>
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                activeTab === "all" ? "bg-background/20 text-background" : "bg-muted text-muted-foreground"
              }`}
            >
              {tabCounts.all}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("active")}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-xl transition cursor-pointer whitespace-nowrap ${
              activeTab === "active"
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            }`}
          >
            <span>In Transit / Active</span>
            {tabCounts.active > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                  activeTab === "active" ? "bg-amber-400 text-stone-900" : "bg-amber-100 text-amber-800"
                }`}
              >
                {tabCounts.active}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("delivered")}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-xl transition cursor-pointer whitespace-nowrap ${
              activeTab === "delivered"
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            }`}
          >
            <span>Delivered</span>
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                activeTab === "delivered" ? "bg-background/20 text-background" : "bg-muted text-muted-foreground"
              }`}
            >
              {tabCounts.delivered}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("cancelled")}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-xl transition cursor-pointer whitespace-nowrap ${
              activeTab === "cancelled"
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            }`}
          >
            <span>Cancelled &amp; Returns</span>
            {tabCounts.cancelled > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                  activeTab === "cancelled" ? "bg-background/20 text-background" : "bg-muted text-muted-foreground"
                }`}
              >
                {tabCounts.cancelled}
              </span>
            )}
          </button>
        </div>

        {/* Amazon-style Search Bar */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search all orders by product or order #"
            className="w-full rounded-full border border-border/80 bg-background pl-10 pr-9 py-2 text-xs sm:text-sm font-medium placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground p-1"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ── EMPTY STATE ── */}
      {(orders ?? []).length === 0 ? (
        <div className="mt-12 rounded-3xl border border-dashed border-border/80 bg-card p-12 text-center shadow-xs">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary mb-4">
            <ShoppingBag className="size-8 stroke-[1.5]" />
          </div>
          <h2 className="font-display text-xl font-bold text-foreground">You haven't placed an order yet</h2>
          <p className="mt-1.5 text-sm text-muted-foreground max-w-md mx-auto">
            When you purchase handcrafted baby essentials, clothing, or nursery gear, your tracking and order history will appear here.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/shop"
              className="rounded-full bg-primary px-6 py-3 text-sm font-bold text-primary-foreground shadow-md transition hover:bg-primary/90 hover:shadow-lg"
            >
              Explore Best Sellers
            </Link>
          </div>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-border bg-card p-10 text-center">
          <Package className="mx-auto size-10 text-muted-foreground/60 mb-2" />
          <p className="text-sm font-semibold text-foreground">
            No orders found {searchQuery ? `matching “${searchQuery}”` : "in this category"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Try searching for a different product name or order ID.</p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setActiveTab("all");
            }}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted transition"
          >
            <span>Clear Filter</span>
          </button>
        </div>
      ) : (
        /* ── AMAZON & FLIPKART STYLE ORDERS LIST ── */
        <div className="mt-6 space-y-6">
          {filteredOrders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              products={products}
              isAdmin={Boolean(isAdmin)}
              returns={returnsByOrderId[order.id] ?? []}
              openAddressId={openAddressId}
              setOpenAddressId={setOpenAddressId}
              onBuyAgain={handleBuyAgain}
              onTrackPackage={() => setTrackingOrder(order)}
              onCancel={() => setCancellingOrder(order)}
              onReturn={() => setReturningOrder(order)}
              onViewReturn={(ret) => setViewingReturn(ret)}
              onOpenBox={() => setOpenBoxOrder(order)}
              onReview={(prodObj) => setReviewingProduct({ product: prodObj, orderId: order.id })}
            />
          ))}
        </div>
      )}

      {/* ── MODALS ── */}
      {cancellingOrder && (
        <CancelOrderModal order={cancellingOrder} onClose={() => setCancellingOrder(null)} />
      )}

      {returningOrder && (
        <OnlineReturnModal order={returningOrder} onClose={() => setReturningOrder(null)} />
      )}

      {viewingReturn && (
        <OnlineReturnDetailsModal
          onlineReturn={viewingReturn}
          onClose={() => setViewingReturn(null)}
        />
      )}

      {openBoxOrder && (
        <OpenBoxActionModal order={openBoxOrder} onClose={() => setOpenBoxOrder(null)} />
      )}

      {trackingOrder && (
        <ShipmentTrackingModal order={trackingOrder} onClose={() => setTrackingOrder(null)} />
      )}

      {reviewingProduct && (
        <ReviewModal
          product={reviewingProduct.product}
          user={user}
          orderId={reviewingProduct.orderId}
          onClose={() => setReviewingProduct(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AMAZON / FLIPKART STYLE ORDER CARD COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

interface OrderCardProps {
  order: Order;
  products: any[] | undefined;
  isAdmin: boolean;
  returns: OnlineReturn[];
  openAddressId: string | null;
  setOpenAddressId: (id: string | null) => void;
  onBuyAgain: (productSlug: string, variantId?: string | null, productName?: string) => void;
  onTrackPackage: () => void;
  onCancel: () => void;
  onReturn: () => void;
  onViewReturn: (ret: OnlineReturn) => void;
  onOpenBox: () => void;
  onReview: (product: { id: string; uuid: string; name: string; image?: string; brand?: string }) => void;
}

function OrderCard({
  order,
  products,
  isAdmin,
  returns,
  openAddressId,
  setOpenAddressId,
  onBuyAgain,
  onTrackPackage,
  onCancel,
  onReturn,
  onViewReturn,
  onOpenBox,
  onReview,
}: OrderCardProps) {
  const [copied, setCopied] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);

  const orderNum = order.order_number || order.invoice_no || order.id.slice(0, 8).toUpperCase();
  const cancellable = isOrderCancellable(order.status);
  const returnable = isOrderReturnable(order);
  const openBoxEligible = isOpenBoxEligible(order);
  const isCancelled = order.status === "cancelled";
  const isDelivered = order.status === "delivered" || order.status === "open_box_accepted";
  const isShipped = ["shipped", "out_for_delivery", "open_box_inspection"].includes(order.status);

  const stepIndex = getOrderStepIndex(order.status);
  const isAddressOpen = openAddressId === order.id;

  const copyOrderId = () => {
    navigator.clipboard.writeText(orderNum);
    setCopied(true);
    toast.success("Order ID copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  const formattedDate = useMemo(() => {
    try {
      return new Intl.DateTimeFormat("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(order.created_at));
    } catch {
      return new Date(order.created_at).toLocaleDateString("en-IN");
    }
  }, [order.created_at]);

  return (
    <article className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm transition-all hover:shadow-md">
      {/* ── 1. AMAZON-STYLE ORDER HEADER BAR ── */}
      <div className="flex flex-wrap items-center justify-between gap-y-3 gap-x-6 border-b border-border/80 bg-stone-100/70 dark:bg-stone-900/60 px-4 py-3 sm:px-6 sm:py-3.5 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-y-2 gap-x-6 sm:gap-x-8">
          {/* Order Placed */}
          <div>
            <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
              Order Placed
            </span>
            <span className="font-semibold text-foreground text-xs">{formattedDate}</span>
          </div>

          {/* Total Amount */}
          <div>
            <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
              Total
            </span>
            <span className="font-bold text-foreground text-xs">{formatPrice(Number(order.total))}</span>
          </div>

          {/* Ship To with Popover */}
          <div className="relative">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
              Ship To
            </span>
            <button
              type="button"
              onClick={() => setOpenAddressId(isAddressOpen ? null : order.id)}
              className="inline-flex items-center gap-1 font-semibold text-primary hover:underline cursor-pointer focus:outline-none"
            >
              <span className="truncate max-w-[130px] sm:max-w-[180px]">{order.full_name || "Customer"}</span>
              <ChevronDown className="size-3 text-muted-foreground" />
            </button>

            {/* Address Popover */}
            {isAddressOpen && (
              <div className="absolute left-0 top-full mt-2 z-30 w-72 rounded-2xl border border-border bg-card p-4 shadow-xl text-xs text-foreground animate-in fade-in zoom-in-95">
                <div className="flex items-start justify-between gap-2 border-b border-border pb-2 mb-2">
                  <p className="font-bold flex items-center gap-1.5">
                    <MapPin className="size-3.5 text-primary" />
                    <span>Shipping Address</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => setOpenAddressId(null)}
                    className="text-muted-foreground hover:text-foreground text-xs"
                  >
                    ✕
                  </button>
                </div>
                <p className="font-semibold">{order.full_name}</p>
                <p className="text-muted-foreground mt-0.5 leading-relaxed">
                  {order.address}
                  {order.address_line2 ? `, ${order.address_line2}` : ""}
                  {order.landmark ? ` (Near ${order.landmark})` : ""}
                </p>
                <p className="text-muted-foreground">
                  {order.city}, {order.state} – {order.pincode}
                </p>
                <p className="mt-2 text-[11px] font-medium text-foreground">
                  Phone: {order.phone} {order.alt_phone ? `· Alt: ${order.alt_phone}` : ""}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right side: Order # & Invoices */}
        <div className="flex flex-wrap items-center gap-3 sm:gap-4 ml-auto">
          <div className="text-right">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
              Order #{orderNum}
            </span>
            <div className="flex items-center gap-2 justify-end mt-0.5">
              <button
                type="button"
                onClick={copyOrderId}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition cursor-pointer"
                title="Copy Order ID"
              >
                {copied ? (
                  <>
                    <Check className="size-3 text-emerald-600" />
                    <span className="text-emerald-600 font-semibold">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="size-3" />
                    <span>Copy ID</span>
                  </>
                )}
              </button>

              <span className="text-muted-foreground/40">·</span>

              <span className="inline-flex items-center gap-1 text-[11px] uppercase font-bold text-muted-foreground">
                {order.payment_method === "cod" ? (
                  <>
                    <Banknote className="size-3 text-amber-600" />
                    <span>COD</span>
                  </>
                ) : (
                  <>
                    <CreditCard className="size-3 text-emerald-600" />
                    <span className="text-emerald-700">Prepaid</span>
                  </>
                )}
              </span>
            </div>
          </div>

          {/* Print/View Invoice */}
          <InvoiceBox order={order} variant="button" requireAdmin={false} />
        </div>
      </div>

      {/* ── 2. AMAZON-STYLE PROMINENT STATUS BANNER ── */}
      <div className="p-4 sm:p-6 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {isDelivered ? (
              <span className="flex size-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="size-5" />
              </span>
            ) : isCancelled ? (
              <span className="flex size-9 items-center justify-center rounded-full bg-rose-100 text-rose-700">
                <XCircle className="size-5" />
              </span>
            ) : isShipped ? (
              <span className="flex size-9 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                <Truck className="size-5" />
              </span>
            ) : (
              <span className="flex size-9 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                <Clock className="size-5" />
              </span>
            )}

            <div>
              <h2 className="text-sm sm:text-base font-bold text-foreground">
                {isDelivered
                  ? "Delivered"
                  : isCancelled
                  ? "Cancelled"
                  : order.status === "out_for_delivery"
                  ? "Out for Delivery Today"
                  : isShipped
                  ? `Shipped ${order.courier_name ? `via ${order.courier_name}` : ""}`
                  : "Order Confirmed & Processing"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {isDelivered
                  ? "Package was delivered directly to your delivery address."
                  : isCancelled
                  ? order.cancellation_reason
                    ? `Reason: “${order.cancellation_reason}”`
                    : "This order was cancelled."
                  : order.status === "out_for_delivery"
                  ? "Our delivery executive will contact you for drop-off."
                  : isShipped
                  ? order.awb_code
                    ? `Tracking No: ${order.awb_code}`
                    : "In transit with courier partner."
                  : "Estimated delivery within 3–5 business days across India."}
              </p>
            </div>
          </div>

          {/* Quick Tracking or Cancellation Action */}
          <div className="flex items-center gap-2">
            {!isCancelled && (
              <button
                type="button"
                onClick={onTrackPackage}
                className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 hover:bg-primary hover:text-primary-foreground px-3.5 py-1.5 text-xs font-semibold text-primary transition cursor-pointer shadow-2xs"
              >
                <Truck className="size-3.5" />
                <span>Track Package</span>
              </button>
            )}

            {cancellable && (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-full border border-destructive/30 bg-destructive/5 hover:bg-destructive hover:text-destructive-foreground px-3 py-1.5 text-xs font-semibold text-destructive transition cursor-pointer"
              >
                Cancel Order
              </button>
            )}
          </div>
        </div>

        {/* ── 3. AMAZON-STYLE PROGRESS STEPPER BAR ── */}
        {!isCancelled && (
          <div className="mt-5 pt-4 border-t border-border/50">
            <div className="relative flex items-center justify-between">
              {/* Connecting Background Line */}
              <div className="absolute left-4 right-4 top-3.5 -translate-y-1/2 h-1 bg-muted rounded-full" />
              {/* Connecting Active Line */}
              <div
                className="absolute left-4 top-3.5 -translate-y-1/2 h-1 bg-emerald-500 rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, Math.max(0, (stepIndex / (TRACKING_STEPS.length - 1)) * 100))}%`,
                }}
              />

              {TRACKING_STEPS.map((step, idx) => {
                const isPassed = stepIndex >= idx;
                const isCurrent = Math.floor(stepIndex) === idx;

                return (
                  <div key={step.key} className="relative z-10 flex flex-col items-center">
                    <div
                      className={`flex size-7 items-center justify-center rounded-full border-2 transition-all ${
                        isPassed
                          ? "border-emerald-500 bg-emerald-500 text-white shadow-xs"
                          : "border-border bg-card text-muted-foreground"
                      }`}
                    >
                      {isPassed ? (
                        <Check className="size-3.5 stroke-[3]" />
                      ) : (
                        <span className="size-2 rounded-full bg-muted-foreground/40" />
                      )}
                    </div>
                    <span
                      className={`mt-1.5 text-[11px] font-semibold text-center whitespace-nowrap ${
                        isCurrent
                          ? "text-primary font-bold"
                          : isPassed
                          ? "text-foreground"
                          : "text-muted-foreground/70"
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Cancellation / Refund Alert if Cancelled */}
        {isCancelled && (
          <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3.5 text-xs text-destructive">
            <p className="font-semibold flex items-center gap-1.5">
              <AlertTriangle className="size-3.5" />
              <span>
                Order Cancelled
                {order.cancelled_at && ` on ${new Date(order.cancelled_at).toLocaleDateString("en-IN")}`}
              </span>
            </p>
            {(order.payment_status === "paid" || order.payment_status === "refunded") && (
              <p className="mt-1 font-medium text-amber-800 dark:text-amber-300">
                {order.payment_status === "refunded"
                  ? "Refund processed. The amount has been returned to your original payment method."
                  : "Online payment was received. Your refund of the full amount will be credited to your account within 5–7 business days."}
              </p>
            )}
          </div>
        )}

        {/* Open Box Delivery Notice if active */}
        {openBoxEligible && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50/60 dark:bg-indigo-950/30 p-3.5 text-xs text-indigo-950 dark:text-indigo-200">
            <div className="flex items-center gap-2.5">
              <span className="flex size-7 items-center justify-center rounded-full bg-indigo-200/70 text-indigo-900 shrink-0">
                <PackageCheck className="size-4" />
              </span>
              <div>
                <p className="font-bold">Open Box Delivery Active</p>
                <p className="text-[11px] text-indigo-800/90 dark:text-indigo-300">
                  Inspect your item inside the box alongside the delivery executive before verifying OTP.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onOpenBox}
              className="inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-indigo-700 transition cursor-pointer"
            >
              <span>Inspect &amp; Verify</span>
            </button>
          </div>
        )}

        {/* Associated Online Returns Banner */}
        {returns.map((ret) => {
          const rBadge = RETURN_STATUS_BADGES[ret.return_status] || {
            label: ret.return_status,
            bg: "bg-muted",
            text: "text-muted-foreground",
            border: "border-border",
          };
          return (
            <div
              key={ret.id}
              className="mt-3 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 p-3 text-xs"
            >
              <div className="flex items-center gap-2">
                <RotateCcw className="size-4 text-amber-800 dark:text-amber-300 shrink-0" />
                <div>
                  <span className="font-bold text-foreground">Return #{ret.return_number}</span>
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold border ${rBadge.bg} ${rBadge.text} ${rBadge.border}`}>
                    {rBadge.label}
                  </span>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {ret.reason_label} · Refund: <strong>{formatPrice(Number(ret.final_refund_amount))}</strong>
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onViewReturn(ret)}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-foreground hover:bg-muted transition"
              >
                <Eye className="size-3" />
                <span>View Details</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* ── 4. AMAZON-STYLE ORDER ITEMS LIST ── */}
      <div className="px-4 sm:px-6 py-4 border-t border-border/80">
        <ul className="divide-y divide-border/60">
          {order.order_items.map((item) => {
            const product = products?.find(
              (p) =>
                (item.product_id && p.uuid === item.product_id) ||
                p.id === item.product_slug ||
                p.uuid === item.product_slug,
            );

            const itemImage = item.image_url || product?.image;

            return (
              <li
                key={item.id}
                className="py-4 first:pt-0 last:pb-0 flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                {/* Left: Product Media + Name */}
                <div className="flex items-start gap-4 flex-1 min-w-0">
                  <Link
                    to="/product/$id"
                    params={{ id: item.product_slug }}
                    className="group relative size-20 sm:size-24 rounded-2xl overflow-hidden border border-border/80 bg-muted shrink-0 shadow-2xs"
                  >
                    {itemImage ? (
                      <img
                        src={itemImage}
                        alt={item.name}
                        className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = clothing;
                        }}
                      />
                    ) : (
                      <div className="size-full flex items-center justify-center text-muted-foreground/40">
                        <Package className="size-8" />
                      </div>
                    )}
                  </Link>

                  <div className="flex-1 min-w-0">
                    <Link
                      to="/product/$id"
                      params={{ id: item.product_slug }}
                      className="text-sm sm:text-base font-bold text-foreground hover:text-primary transition line-clamp-2"
                    >
                      {item.name}
                    </Link>

                    {/* Specs Pills (Size, Color) */}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {item.size && (
                        <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
                          Size: {item.size}
                        </span>
                      )}
                      {item.color && (
                        <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
                          Color: {item.color}
                        </span>
                      )}
                      <span className="text-xs">
                        Qty: <strong className="text-foreground">{item.qty}</strong>
                      </span>
                      <span>·</span>
                      <span className="text-xs text-foreground font-semibold">
                        {formatPrice(Number(item.price))} each
                      </span>
                    </div>

                    {/* Return eligibility status */}
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {isDelivered ? (
                        returnable ? (
                          <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                            Eligible for return / exchange (7-day window)
                          </span>
                        ) : (
                          <span>Return window closed</span>
                        )
                      ) : (
                        <span>7-day easy returns upon delivery</span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Right: Amazon-style Action Buttons Stack */}
                <div className="flex flex-wrap md:flex-col items-center md:items-end gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-border/40">
                  {/* Total price for line */}
                  <div className="text-sm sm:text-base font-bold text-foreground mb-1">
                    {formatPrice(Number(item.price) * item.qty)}
                  </div>

                  {/* Amazon Signature: "Buy It Again" */}
                  <button
                    type="button"
                    onClick={() => onBuyAgain(item.product_slug, item.variant_id, item.name)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground shadow-xs hover:bg-primary/90 hover:shadow-sm transition cursor-pointer w-full sm:w-auto"
                  >
                    <ShoppingBag className="size-3.5" />
                    <span>Buy it again</span>
                  </button>

                  {/* Review Button */}
                  {!isCancelled && (
                    <button
                      type="button"
                      onClick={() => {
                        const UUID_REGEX =
                          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
                        let canonicalUuid = product?.uuid;
                        if (!canonicalUuid && item.product_id && UUID_REGEX.test(item.product_id)) {
                          canonicalUuid = item.product_id;
                        }
                        onReview({
                          id: product?.id || item.product_slug,
                          uuid: canonicalUuid || item.product_id || item.product_slug,
                          name: product?.name || item.name,
                          image: itemImage,
                          brand: product?.brand,
                        });
                      }}
                      className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-background hover:bg-muted px-3 py-1.5 text-xs font-semibold text-foreground transition cursor-pointer w-full sm:w-auto"
                    >
                      <Star className="size-3 text-amber-500 fill-amber-500" />
                      <span>Write Review</span>
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* ── 5. CARD FOOTER: RETURN & DETAILED TIMELINE ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/80 bg-stone-50/50 dark:bg-stone-900/40 px-4 sm:px-6 py-3 text-xs">
        <div className="flex items-center gap-2">
          {returnable && (
            <button
              type="button"
              onClick={onReturn}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3.5 py-1.5 text-xs font-bold text-primary transition hover:bg-primary hover:text-primary-foreground cursor-pointer shadow-2xs"
            >
              <RotateCcw className="size-3.5" />
              <span>Return or Replace Items</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowTimeline(!showTimeline)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition cursor-pointer"
          >
            <span>Timeline Updates</span>
            {showTimeline ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </button>
        </div>

        <Link
          to="/contact"
          search={{ subject: `Help with Order #${orderNum}` }}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition ml-auto"
        >
          <HelpCircle className="size-3.5" />
          <span>Need help with this order?</span>
        </Link>
      </div>

      {/* Expandable Order Timeline */}
      {showTimeline && (
        <div className="border-t border-border/60 bg-muted/20 px-6 py-4 animate-in fade-in">
          <OrderTimeline orderId={order.id} />
        </div>
      )}
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SHIPMENT TRACKING MODAL (AMAZON / SHIPROCKET GRADE)
// ─────────────────────────────────────────────────────────────────────────────

function ShipmentTrackingModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const stepIndex = getOrderStepIndex(order.status);
  const orderNum = order.order_number || order.invoice_no || order.id.slice(0, 8).toUpperCase();
  const awb = order.awb_code;
  const courier = order.courier_name || "Shiprocket Express";

  const trackingUrl = awb
    ? `https://shiprocket.co//tracking/${awb}`
    : undefined;

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in"
    >
      <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 sm:p-8">
        <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary mb-1">
              <Truck className="size-3.5" />
              <span>Live Shipment Tracking</span>
            </div>
            <h2 className="font-display text-lg font-bold text-foreground">
              Order #{orderNum}
            </h2>
            <p className="text-xs text-muted-foreground">
              Courier: <strong className="text-foreground">{courier}</strong>
              {awb && ` · Tracking No: ${awb}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>

        {/* Stepper Inside Modal */}
        <div className="my-6 space-y-4">
          <div className="rounded-2xl border border-border/80 bg-muted/20 p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
              Delivery Progress
            </h3>
            <div className="space-y-3">
              {TRACKING_STEPS.map((step, idx) => {
                const isPassed = stepIndex >= idx;
                const isCurrent = Math.floor(stepIndex) === idx;

                return (
                  <div key={step.key} className="flex items-start gap-3">
                    <div
                      className={`flex size-6 items-center justify-center rounded-full text-xs font-bold shrink-0 mt-0.5 ${
                        isPassed
                          ? "bg-emerald-600 text-white"
                          : "border border-border bg-card text-muted-foreground"
                      }`}
                    >
                      {isPassed ? <Check className="size-3.5 stroke-[3]" /> : idx + 1}
                    </div>
                    <div>
                      <p
                        className={`text-xs font-semibold ${
                          isCurrent ? "text-primary font-bold" : isPassed ? "text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {step.label}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {idx === 0
                          ? `Placed on ${new Date(order.created_at).toLocaleString("en-IN")}`
                          : idx === 2 && awb
                          ? `Handed over to ${courier}`
                          : idx === 3 && order.status === "delivered"
                          ? "Delivered successfully"
                          : "Pending fulfillment"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Direct Shiprocket courier link */}
          {trackingUrl && (
            <a
              href={trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full rounded-2xl bg-foreground px-4 py-3 text-xs font-bold text-background shadow-sm hover:opacity-90 transition"
            >
              <span>Track directly on {courier}</span>
              <ExternalLink className="size-3.5" />
            </a>
          )}

          {/* Delivery Address Snapshot */}
          <div className="rounded-2xl border border-border/60 p-3.5 text-xs text-muted-foreground bg-card">
            <p className="font-bold text-foreground mb-1 flex items-center gap-1.5">
              <MapPin className="size-3.5 text-primary" />
              <span>Delivering To</span>
            </p>
            <p>{order.full_name} · {order.phone}</p>
            <p className="truncate">{order.address}, {order.city}, {order.state} – {order.pincode}</p>
          </div>
        </div>

        <div className="flex justify-end pt-2 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-border bg-background px-5 py-2 text-xs font-semibold text-foreground hover:bg-muted transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modalContent, document.body) : modalContent;
}

// ─────────────────────────────────────────────────────────────────────────────
// CANCELLATION MODAL
// ─────────────────────────────────────────────────────────────────────────────

function CancelOrderModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const [selectedReason, setSelectedReason] = useState(CANCELLATION_REASONS[0]);
  const [customReason, setCustomReason] = useState("");
  const cancelOrder = useCancelCustomerOrder();

  const isOther = selectedReason === "Other";
  const finalReason = isOther
    ? customReason.trim() || "Other reason specified by customer"
    : selectedReason;

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (cancelOrder.isPending) return;

    try {
      await cancelOrder.mutateAsync({
        orderId: order.id,
        reason: finalReason,
      });
      toast.success("Your order has been cancelled.");
      onClose();
    } catch (err: unknown) {
      const msg = (err as Error).message || "Failed to cancel order";
      toast.error(msg);
    }
  }

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-modal-title"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in"
    >
      <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 sm:p-8">
        <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <h2 id="cancel-modal-title" className="font-display text-xl font-bold text-foreground">
              Cancel Order #{order.order_number || order.invoice_no || order.id.slice(0, 8).toUpperCase()}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Orders can be cancelled before shipment. Items will be returned to store stock.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={cancelOrder.isPending}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleConfirm} className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="cancel-reason-select"
              className="block text-xs font-semibold text-foreground"
            >
              Reason for cancellation
            </label>
            <select
              id="cancel-reason-select"
              value={selectedReason}
              onChange={(e) => setSelectedReason(e.target.value)}
              disabled={cancelOrder.isPending}
              className="mt-2 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm font-medium outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            >
              {CANCELLATION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {isOther && (
            <div>
              <label
                htmlFor="custom-reason-input"
                className="block text-xs font-semibold text-foreground"
              >
                Please tell us more
              </label>
              <textarea
                id="custom-reason-input"
                rows={2}
                required
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Why would you like to cancel?"
                className="mt-1.5 w-full rounded-xl border border-border bg-background px-3.5 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
          )}

          {order.payment_status === "paid" && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <strong>Refund Notice:</strong> Since this order was paid online, your full payment of{" "}
              {formatPrice(Number(order.total))} will be automatically refunded to your original payment method within 5–7 business days.
            </div>
          )}

          <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={cancelOrder.isPending}
              className="rounded-full border border-border bg-background px-5 py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
            >
              Keep Order
            </button>
            <button
              type="submit"
              disabled={cancelOrder.isPending}
              className="inline-flex items-center justify-center rounded-full bg-destructive px-5 py-2.5 text-sm font-semibold text-destructive-foreground transition hover:bg-destructive/90 disabled:opacity-50"
            >
              {cancelOrder.isPending ? "Cancelling…" : "Confirm Cancellation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modalContent, document.body) : modalContent;
}

// ─────────────────────────────────────────────────────────────────────────────
// DETAILED ORDER TIMELINE
// ─────────────────────────────────────────────────────────────────────────────

function OrderTimeline({ orderId }: { orderId: string }) {
  const { data: history } = useQuery({
    queryKey: ["order-history", orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_status_history")
        .select("*")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!history || history.length === 0) {
    return <p className="text-xs text-muted-foreground">No tracking logs recorded yet.</p>;
  }

  return (
    <div>
      <h3 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2">
        Activity Log ({history.length} update{history.length > 1 ? "s" : ""})
      </h3>
      <ol className="relative ml-2 space-y-2.5 border-l-2 border-border pl-4">
        {history.map((h) => (
          <li key={h.id} className="relative">
            <span className="absolute -left-[1.35rem] top-1 size-2 rounded-full bg-primary" />
            <p className="text-xs font-bold capitalize text-foreground">
              {h.new_status?.replace(/_/g, " ")}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {new Date(h.created_at).toLocaleString("en-IN")}
              {h.note ? ` — ${h.note}` : ""}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
