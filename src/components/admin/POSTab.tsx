/**
 * POSTab — Production-grade Point of Sale interface.
 *
 * Flow: Scan → Cart → Discount → Customer → Payment → Success → Receipt
 *
 * Supports:
 * - Hardware barcode scanner (keyboard input with Enter suffix)
 * - Manual barcode entry
 * - Manual product search
 * - Multiple products, re-scan qty+1
 * - Stock validation
 * - Walk-in customer (default) or named POS customer
 * - Percentage / Fixed discount
 * - Cash / UPI / Card / Other payment
 * - Sequential invoice numbering
 * - Printable receipt
 * - Double-submit prevention
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Barcode from "react-barcode";
import { playScanSuccess, playScanError } from "@/lib/audio";
import { useGlobalBarcodeScanner } from "@/lib/barcode-scanner";
import {
  Plus,
  Minus,
  Trash2,
  ShoppingBag,
  CreditCard,
  Banknote,
  Scan,
  Package,
  Search,
  User,
  Check,
  AlertTriangle,
  Printer,
  ReceiptText,
  Smartphone,
  Wallet,
  ChevronRight,
  X,
  UserPlus,
  Phone,
  Send,
  Star,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { type Product, mapProduct, formatPrice, imageFor } from "@/lib/store";
import clothing from "@/assets/cat-clothing.jpg";
import {
  type POSCartItem,
  type SaleResult,
  lookupBarcode,
  usePlaceOfflineSale,
  useSearchPOSCustomers,
  useCreatePOSCustomer,
  calculateDiscount,
  generateIdempotencyKey,
} from "@/lib/pos";
import { ThermalReceipt } from "@/components/admin/ThermalReceipt";
import { PrintLabelsModal } from "@/components/admin/PrintLabelsModal";
import { useSession } from "@/lib/auth";
import { useOfflineSyncStatus } from "@/lib/offline-sync-engine";

type POSStep = "cart" | "checkout" | "success";

export function POSTab() {
  const qc = useQueryClient();
  const { user } = useSession();
  const syncStatus = useOfflineSyncStatus();
  const scanInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<POSStep>("cart");

  // Cart state
  const [cart, setCart] = useState<POSCartItem[]>([]);
  const [scanValue, setScanValue] = useState("");
  const [scanLoading, setScanLoading] = useState(false);
  const [productSearch, setProductSearch] = useState("");

  // Quick Order State
  const [quickOrderProduct, setQuickOrderProduct] = useState("");
  const [quickOrderPrice, setQuickOrderPrice] = useState("");

  // Discount state
  const [discountType, setDiscountType] = useState<"none" | "percentage" | "fixed">("none");
  const [discountValue, setDiscountValue] = useState<number>(0);

  // Customer state
  const [customerMode, setCustomerMode] = useState<"walkin" | "existing" | "new">("walkin");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerSearchQuery, setCustomerSearchQuery] = useState("");

  // Payment state
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");

  // Sale result
  const [saleResult, setSaleResult] = useState<SaleResult | null>(null);
  const [showLabels, setShowLabels] = useState(false);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(generateIdempotencyKey());

  // Products for manual search
  const { data: products = [] } = useQuery({
    queryKey: ["admin-products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").eq("is_active", true);
      if (error) throw error;
      return (data as never[]).map((r) => mapProduct(r as never));
    },
  });

  // POS customer search
  const searchCustomers = useSearchPOSCustomers();
  const createCustomer = useCreatePOSCustomer();
  const placeSale = usePlaceOfflineSale();

  const handleAddCustomToCart = () => {
    if (!quickOrderProduct || !quickOrderPrice) {
      toast.error("Please provide product name and price");
      return false;
    }
    const price = parseFloat(quickOrderPrice);
    if (isNaN(price) || price <= 0) {
      toast.error("Invalid price");
      return false;
    }

    setCart((prev) => [
      ...prev,
      {
        product_id: `custom-${Date.now()}`,
        slug: "custom",
        name: quickOrderProduct,
        brand: "Custom Item",
        category: "Custom",
        price: price,
        mrp: price,
        stock: 1,
        sku: "CUSTOM",
        barcode: "",
        image_url: null,
        age_group: "All",
        qty: 1,
        isCustom: true,
      },
    ]);

    setQuickOrderProduct("");
    setQuickOrderPrice("");
    toast.success("Custom item added to cart");
    return true;
  };

  const handleQuickCheckout = () => {
    if (quickOrderProduct || quickOrderPrice) {
      const added = handleAddCustomToCart();
      if (!added) return;
    }

    if (cart.length === 0 && !quickOrderProduct) {
      toast.error("Cart is empty");
      return;
    }

    setCustomerMode("walkin");
    setStep("checkout");
  };

  // Cart calculations
  const subtotalRaw = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const subtotal = Math.round(subtotalRaw * 100) / 100;
  const discountAmount = calculateDiscount(subtotal, discountType, discountValue);
  const total = Math.round(Math.max(0, subtotal - discountAmount) * 100) / 100;
  const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);

  // Keep scan input focused when on cart step
  useEffect(() => {
    if (step === "cart" && scanInputRef.current) {
      const focusTimer = setInterval(() => {
        if (
          document.activeElement !== scanInputRef.current &&
          !(document.activeElement instanceof HTMLInputElement) &&
          !(document.activeElement instanceof HTMLTextAreaElement) &&
          !(document.activeElement instanceof HTMLSelectElement)
        ) {
          scanInputRef.current?.focus();
        }
      }, 500);
      return () => clearInterval(focusTimer);
    }
    return undefined;
  }, [step]);

  // Scan handler
  const handleScan = useCallback(async (code: string) => {
    const cleanCode = code.trim();
    if (!cleanCode) return;
    setScanValue("");
    setScanLoading(true);
    try {
      const result = await lookupBarcode(cleanCode);

      if (!result || !result.found) {
        playScanError();
        toast.error(`Product not found for barcode: ${cleanCode}`, {
          description: "Check if the barcode is assigned or search product catalogue manually.",
        });
        return;
      }

      if (result.archived) {
        playScanError();
        toast.error(`"${result.name}" is archived and unavailable for sale`, { duration: 5000 });
        return;
      }

      if ((result.stock ?? 0) <= 0) {
        playScanError();
        toast.error(`"${result.name}" is out of stock!`, {
          description: "Cannot add out-of-stock items to a new POS sale.",
        });
        return;
      }

      const added = addToCart({
        product_id: result.product_id!,
        slug: result.slug!,
        name: result.name!,
        brand: result.brand ?? "",
        category: result.category ?? "",
        price: result.price!,
        mrp: result.mrp ?? result.price!,
        stock: result.stock!,
        sku: result.sku ?? "",
        barcode: result.barcode ?? "",
        image_url: result.image_url ?? null,
        age_group: result.age_group ?? "",
        qty: 1,
      });

      if (added) {
        playScanSuccess();
        toast.success(`Scanned: ${result.name}`, {
          description: `₹${result.price} • SKU: ${result.sku || "N/A"} • Stock: ${result.stock}`,
        });
      }
    } catch (e) {
      playScanError();
      toast.error(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanLoading(false);
    }
  }, []);

  // Hook into centralized hardware scanner events (also drains queued scans on mount)
  useGlobalBarcodeScanner(handleScan);

  function addToCart(item: POSCartItem): boolean {
    let added = true;
    setCart((prev) => {
      const existing = prev.find((p) => p.product_id === item.product_id);
      if (existing) {
        if (existing.qty >= item.stock) {
          playScanError();
          toast.error(`Cannot add more "${item.name}". Only ${item.stock} in stock.`);
          added = false;
          return prev;
        }
        return prev.map((p) => (p.product_id === item.product_id ? { ...p, qty: p.qty + 1 } : p));
      }
      return [...prev, { ...item, qty: 1 }];
    });
    return added;
  }

  function addProductManually(product: Product) {
    if (product.stock <= 0) {
      toast.error(`"${product.name}" is out of stock`);
      return;
    }
    addToCart({
      product_id: product.uuid,
      slug: product.id,
      name: product.name,
      brand: product.brand,
      category: product.category,
      price: product.price,
      mrp: product.mrp,
      stock: product.stock,
      sku: product.sku,
      barcode: product.barcode,
      image_url: product.imageUrl || product.image,
      age_group: product.ageGroup,
      qty: 1,
    });
    setProductSearch("");
    toast.success(`Added: ${product.name}`);
  }

  function updateQty(productId: string, newQty: number) {
    setCart((prev) =>
      prev.map((p) => {
        if (p.product_id === productId) {
          const clamped = Math.max(1, Math.min(p.stock, newQty));
          if (newQty > p.stock) {
            toast.error(`Only ${p.stock} available for "${p.name}"`);
          }
          return { ...p, qty: clamped };
        }
        return p;
      }),
    );
  }

  function removeFromCart(productId: string) {
    setCart((prev) => prev.filter((p) => p.product_id !== productId));
  }

  // Complete sale
  async function completeSale() {
    if (cart.length === 0) {
      toast.error("Cart is empty");
      return;
    }

    const rpcItems = cart.map((item) => ({
      product_id: item.isCustom ? undefined : item.product_id,
      product_slug: item.isCustom ? `custom-${Date.now()}` : item.slug,
      name: item.name,
      sku: item.sku,
      qty: item.qty,
      custom_price: item.isCustom ? item.price : undefined,
    }));

    try {
      const result = await placeSale.mutateAsync({
        customer_name:
          customerMode === "walkin" ? "Walk-in Customer" : customerName || "Walk-in Customer",
        customer_phone: customerPhone,
        customer_email: customerEmail,
        payment_method: paymentMethod,
        notes: "",
        discount_type: discountType,
        discount_value: discountValue,
        customer_id: customerId,
        items: rpcItems,
        idempotency_key: idempotencyKey,
      });

      if (result.duplicate) {
        toast.warning("This sale was already processed (duplicate prevented)");
      }

      setSaleResult(result);
      setIsReceiptModalOpen(true);
      setStep("success");
      toast.success(`Sale completed! ${result.sale_number}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sale failed");
    }
  }

  // Reset for new sale
  function resetPOS() {
    setCart([]);
    setDiscountType("none");
    setDiscountValue(0);
    setCustomerMode("walkin");
    setCustomerName("");
    setCustomerPhone("");
    setCustomerEmail("");
    setCustomerId(null);
    setPaymentMethod("cash");
    setSaleResult(null);
    setStep("cart");
    setIdempotencyKey(generateIdempotencyKey());
    setProductSearch("");
    setScanValue("");
    setCustomerSearchQuery("");
  }

  // Filtered products for manual search
  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return [];
    const q = productSearch.toLowerCase();
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.barcode?.toLowerCase().includes(q) ||
          p.brand.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [products, productSearch]);

  // Customer search results
  useEffect(() => {
    if (customerSearchQuery.trim().length >= 2) {
      searchCustomers.mutate(customerSearchQuery);
    } else {
      searchCustomers.reset();
    }
  }, [customerSearchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full flex-col rounded-2xl border border-border/50 bg-background overflow-hidden relative">
      {/* ====== LEFT PANEL: Cart & Scanning ====== */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Scanner Header with Realtime / Offline Sync Status */}
        <div className="flex flex-wrap items-center justify-between border-b border-border/50 bg-muted/30 p-4 gap-3">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-lg font-bold shrink-0">POS Terminal</h2>
            <div className="flex items-center gap-1.5">
              {!syncStatus.isOnline ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-700 border border-amber-500/20">
                  <span className="size-2 rounded-full bg-amber-500 animate-ping" />
                  Offline Mode (Local Queue Active)
                </span>
              ) : syncStatus.isSyncing ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2.5 py-0.5 text-xs font-semibold text-blue-700 border border-blue-500/20">
                  <span className="size-2 rounded-full bg-blue-500 animate-pulse" />
                  Syncing offline sales…
                </span>
              ) : syncStatus.pendingCount > 0 ? (
                <button
                  onClick={() => syncStatus.triggerSync()}
                  className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-700 hover:bg-amber-500/25 border border-amber-500/20 transition-all"
                  title="Click to sync now"
                >
                  <span className="size-2 rounded-full bg-amber-500" />
                  {syncStatus.pendingCount} offline sale{syncStatus.pendingCount > 1 ? "s" : ""} pending • Sync now
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-500/20">
                  <span className="size-2 rounded-full bg-emerald-500" />
                  Realtime Cloud Synced
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Scan className="size-4 text-primary animate-pulse" />
            Scanner Active
          </div>
        </div>

        {/* Scan Input - Only displayed during Cart scanning */}
        {step === "cart" && (
          <div className="p-4 border-b border-border/50 bg-card">
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Scan className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <input
                  ref={scanInputRef}
                  type="text"
                  value={scanValue}
                  onChange={(e) => setScanValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && scanValue.trim()) {
                      handleScan(scanValue.trim());
                      setScanValue("");
                    }
                  }}
                  placeholder="Scan barcode or type SKU and press Enter..."
                  className="w-full rounded-xl border border-border bg-background pl-10 pr-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  autoFocus
                />
              </div>
              {scanLoading && (
                <div className="flex items-center px-3">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              )}
            </div>

            {/* Manual Product Search */}
            <div className="mt-3 relative">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <input
                  type="text"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Search products manually..."
                  className="w-full rounded-xl border border-border bg-background pl-10 pr-4 py-2 text-sm outline-none focus:border-primary transition-all"
                />
              </div>
              {filteredProducts.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 z-20 max-h-64 overflow-y-auto rounded-xl border border-border bg-card shadow-xl">
                  {filteredProducts.map((p) => (
                    <button
                      key={p.uuid}
                      onClick={() => addProductManually(p)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted transition-colors border-b border-border/30 last:border-0 cursor-pointer"
                    >
                      <img
                        src={imageFor(p.category, p.imageUrl || p.image)}
                        alt={p.name}
                        loading="lazy"
                        decoding="async"
                        className="size-9 rounded-lg object-cover border border-border shrink-0"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = clothing;
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate text-foreground">{p.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.sku} • {formatPrice(p.price)} • Stock: {p.stock}
                        </p>
                      </div>
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          p.stock > 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                        }`}
                      >
                        {p.stock > 0 ? `${p.stock}` : "OOS"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Cart Items */}
        {step === "cart" && (
          <div className="flex-1 overflow-y-auto bg-[#f8fafc]/50 p-4">
            {cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-muted-foreground py-16">
                <ShoppingBag className="size-12 opacity-20 mb-4" />
                <p className="font-semibold">Cart is empty</p>
                <p className="text-xs mt-1">Scan a barcode or search products to add items</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <th className="py-2 text-left">Product</th>
                      <th className="py-2 text-left">SKU</th>
                      <th className="py-2 text-right">Price</th>
                      <th className="py-2 text-center">Stock</th>
                      <th className="py-2 text-center">Qty</th>
                      <th className="py-2 text-right">Subtotal</th>
                      <th className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((item) => (
                      <tr
                        key={item.product_id}
                        className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                      >
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-3">
                            <img
                              src={imageFor(item.category || "clothing", item.image_url)}
                              alt={item.name}
                              loading="lazy"
                              decoding="async"
                              className="size-10 rounded-lg object-cover border border-border shrink-0"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = clothing;
                              }}
                            />
                            <div>
                              <p className="font-semibold text-foreground text-sm">{item.name}</p>
                              {item.isCustom && (
                                <span className="text-[10px] text-amber-600 font-bold bg-amber-50 px-1.5 py-0.5 rounded">
                                  Custom Price
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 font-mono text-xs text-muted-foreground">{item.sku || "—"}</td>
                        <td className="py-3 text-right">
                          <input
                            type="number"
                            value={item.price}
                            onChange={(e) =>
                              updateQty(item.product_id, item.qty) // simplified placeholder for custom logic
                            }
                            className="w-20 rounded-lg border border-border bg-background px-2 py-1 text-right text-xs font-semibold outline-none focus:border-primary"
                            min={0}
                          />
                        </td>
                        <td className="py-3 text-center">
                          <span
                            className={`text-xs font-semibold ${
                              item.stock <= 5 ? "text-amber-600" : "text-muted-foreground"
                            }`}
                          >
                            {item.stock}
                          </span>
                        </td>
                        <td className="py-3 text-center">
                          <div className="inline-flex items-center rounded-lg border border-border bg-background">
                            <button
                              onClick={() => updateQty(item.product_id, item.qty - 1)}
                              className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground"
                            >
                              <Minus className="size-3" />
                            </button>
                            <span className="w-8 text-center text-xs font-bold">{item.qty}</span>
                            <button
                              onClick={() => updateQty(item.product_id, item.qty + 1)}
                              disabled={item.qty >= item.stock}
                              className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-30"
                            >
                              <Plus className="size-3" />
                            </button>
                          </div>
                        </td>
                        <td className="py-3 text-right font-bold text-foreground">
                          {formatPrice(item.price * item.qty)}
                        </td>
                        <td className="py-3 text-right pl-2">
                          <button
                            onClick={() => removeFromCart(item.product_id)}
                            className="text-muted-foreground hover:text-destructive p-1 rounded hover:bg-red-50"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Cart Footer */}
        {cart.length > 0 && step === "cart" && (
          <div className="border-t border-border bg-card p-4 shadow-[0_-4px_10px_rgba(0,0,0,0.05)] mt-auto shrink-0 z-10 relative">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-muted-foreground block text-xs">
                  Total Items: {totalItems}
                </span>
                <span className="font-bold text-2xl text-primary">{formatPrice(subtotal)}</span>
              </div>
              <button
                onClick={() => setStep("checkout")}
                className="rounded-xl bg-primary px-8 py-3 text-sm font-bold text-primary-foreground shadow-premium-sm hover:bg-primary/90 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                Proceed to Checkout
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        )}

        {/* ====== Checkout Step — 2-Column Responsive Layout ====== */}
        {step === "checkout" && (
          <div className="flex-1 overflow-y-auto bg-muted/20 p-4 sm:p-6">
            <div className="max-w-4xl mx-auto space-y-5">
              {/* Header */}
              <div className="flex items-center justify-between bg-card p-4 rounded-2xl border border-border shadow-2xs">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setStep("cart")}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-bold text-foreground hover:bg-muted transition cursor-pointer"
                  >
                    ← Back to Cart
                  </button>
                  <h2 className="text-lg font-bold text-foreground">POS Checkout</h2>
                </div>
                <div className="text-right">
                  <span className="text-xs text-muted-foreground mr-2">Total Amount:</span>
                  <span className="font-bold text-lg text-primary">{formatPrice(total)}</span>
                </div>
              </div>

              {/* 2-Column Layout */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* Left Column (7 cols): Discount, Customer, Payment Method */}
                <div className="lg:col-span-7 space-y-4">
                  {/* Discount Section */}
                  <div className="rounded-2xl bg-card p-4 shadow-2xs border border-border">
                    <div className="flex items-center justify-between mb-2.5">
                      <h3 className="text-sm font-bold">Discount</h3>
                      {discountAmount > 0 && (
                        <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                          −{formatPrice(discountAmount)} applied
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2 mb-3">
                      {(
                        [
                          ["none", "None"],
                          ["percentage", "%"],
                          ["fixed", "₹"],
                        ] as const
                      ).map(([type, label]) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => {
                            setDiscountType(type);
                            if (type === "none") setDiscountValue(0);
                          }}
                          className={`flex-1 rounded-xl py-2 text-xs font-bold transition-all cursor-pointer ${
                            discountType === type
                              ? "bg-primary text-primary-foreground shadow-2xs"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {discountType !== "none" && (
                      <div className="flex items-center gap-3">
                        <div className="relative flex-1">
                          <input
                            type="number"
                            value={discountValue || ""}
                            onChange={(e) => setDiscountValue(Math.max(0, Number(e.target.value)))}
                            placeholder={discountType === "percentage" ? "Enter %" : "Enter ₹ amount"}
                            min={0}
                            max={discountType === "percentage" ? 100 : subtotal}
                            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all font-semibold"
                          />
                        </div>
                        {discountAmount > 0 && (
                          <span className="text-sm font-bold text-emerald-700 whitespace-nowrap shrink-0">
                            −{formatPrice(discountAmount)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Customer Section */}
                  <div className="rounded-2xl bg-card p-4 shadow-2xs border border-border">
                    <h3 className="text-sm font-bold mb-2.5">Customer</h3>
                    <div className="flex gap-2 mb-3">
                      {(
                        [
                          ["walkin", "Walk-in", User],
                          ["existing", "Search", Search],
                          ["new", "New", UserPlus],
                        ] as const
                      ).map(([mode, label, Icon]) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => {
                            setCustomerMode(mode);
                            if (mode === "walkin") {
                              setCustomerName("");
                              setCustomerPhone("");
                              setCustomerEmail("");
                              setCustomerId(null);
                            }
                          }}
                          className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition-all cursor-pointer ${
                            customerMode === mode
                              ? "bg-primary text-primary-foreground shadow-2xs"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          }`}
                        >
                          <Icon className="size-3.5" />
                          {label}
                        </button>
                      ))}
                    </div>

                    {customerMode === "walkin" && (
                      <p className="text-xs text-muted-foreground text-center py-2 bg-muted/40 rounded-xl border border-border/50">
                        Sale will be recorded as <span className="font-bold text-foreground">Walk-in Customer</span>
                      </p>
                    )}

                    {customerMode === "existing" && (
                      <div className="space-y-2">
                        <div className="relative">
                          <Phone className="absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
                          <input
                            type="text"
                            value={customerSearchQuery}
                            onChange={(e) => setCustomerSearchQuery(e.target.value)}
                            placeholder="Search by phone or name..."
                            className="w-full rounded-xl border border-border bg-background pl-9 pr-9 py-2 text-sm outline-none focus:border-primary transition-all"
                          />
                          {customerSearchQuery && (
                            <button
                              type="button"
                              onClick={() => {
                                setCustomerSearchQuery("");
                                searchCustomers.reset();
                              }}
                              className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground cursor-pointer"
                            >
                              <X className="size-3.5" />
                            </button>
                          )}
                        </div>
                        {customerSearchQuery.trim().length > 0 &&
                          (searchCustomers.data ?? []).length > 0 && (
                            <div className="max-h-32 overflow-y-auto rounded-xl border border-border bg-card shadow-md divide-y divide-border">
                              {searchCustomers.data!.map((c) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() => {
                                    setCustomerName(c.name);
                                    setCustomerPhone(c.phone);
                                    setCustomerEmail(c.email);
                                    setCustomerId(c.id);
                                    setCustomerSearchQuery("");
                                    toast.success(`Customer: ${c.name}`);
                                  }}
                                  className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-muted cursor-pointer text-left"
                                >
                                  <div>
                                    <p className="font-semibold text-foreground">{c.name || "—"}</p>
                                    <p className="text-xs text-muted-foreground">{c.phone}</p>
                                  </div>
                                  <span className="text-xs text-muted-foreground">
                                    {c.total_purchases} orders
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        {customerId && (
                          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-2 text-xs border border-emerald-200">
                            <Check className="size-3.5 text-emerald-700" />
                            <span className="font-semibold text-emerald-800">
                              {customerName} • {customerPhone}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setCustomerId(null);
                                setCustomerName("");
                                setCustomerPhone("");
                              }}
                              className="ml-auto text-emerald-600 hover:text-emerald-800 cursor-pointer"
                            >
                              <X className="size-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {customerMode === "new" && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          value={customerName}
                          onChange={(e) => setCustomerName(e.target.value)}
                          placeholder="Customer name"
                          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary transition-all"
                        />
                        <input
                          value={customerPhone}
                          onChange={(e) => setCustomerPhone(e.target.value)}
                          placeholder="Phone number"
                          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary transition-all"
                        />
                      </div>
                    )}
                  </div>

                  {/* Payment Section */}
                  <div className="rounded-2xl bg-card p-4 shadow-2xs border border-border">
                    <h3 className="text-sm font-bold mb-2.5">Payment Method</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {(
                        [
                          ["cash", "Cash", Banknote],
                          ["upi", "UPI", Smartphone],
                          ["card", "Card", CreditCard],
                          ["other", "Other", Wallet],
                        ] as const
                      ).map(([method, label, Icon]) => (
                        <button
                          key={method}
                          type="button"
                          onClick={() => setPaymentMethod(method)}
                          className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition-all cursor-pointer ${
                            paymentMethod === method
                              ? "bg-primary text-primary-foreground shadow-2xs"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          }`}
                        >
                          <Icon className="size-4" />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right Column (5 cols): Order Summary & Complete Action */}
                <div className="lg:col-span-5 space-y-4">
                  <div className="rounded-2xl bg-card p-4 shadow-2xs border border-border space-y-3 sticky top-4">
                    <h3 className="text-sm font-bold border-b border-border pb-2">Order Summary</h3>
                    
                    {/* Items List Snapshot */}
                    <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1 divide-y divide-border/50 text-xs">
                      {cart.map((item) => (
                        <div key={item.product_id} className="pt-1.5 first:pt-0 flex items-center justify-between">
                          <div className="min-w-0 flex-1 pr-2">
                            <p className="font-semibold truncate text-foreground">{item.name}</p>
                            <p className="text-muted-foreground text-[10px]">{item.qty} × {formatPrice(item.price)}</p>
                          </div>
                          <span className="font-bold text-foreground shrink-0">{formatPrice(item.price * item.qty)}</span>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-1.5 text-xs pt-2 border-t border-border">
                      <div className="flex justify-between text-muted-foreground">
                        <span>Items Subtotal ({totalItems})</span>
                        <span className="font-semibold text-foreground">{formatPrice(subtotal)}</span>
                      </div>
                      {discountAmount > 0 && (
                        <div className="flex justify-between text-emerald-700 font-semibold">
                          <span>
                            Discount {discountType === "percentage" ? `(${discountValue}%)` : ""}
                          </span>
                          <span>−{formatPrice(discountAmount)}</span>
                        </div>
                      )}
                      <div className="flex items-baseline justify-between border-t border-border pt-2 text-base">
                        <span className="font-bold">Total Payable</span>
                        <span className="font-black text-xl text-primary">{formatPrice(total)}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        if (customerMode === "new" && customerName && customerPhone) {
                          createCustomer.mutate(
                            { name: customerName, phone: customerPhone, email: customerEmail },
                            {
                              onSuccess: (newCustomer) => {
                                setCustomerId(newCustomer.id);
                                setTimeout(() => completeSale(), 100);
                              },
                              onError: () => {
                                completeSale();
                              },
                            },
                          );
                        } else {
                          completeSale();
                        }
                      }}
                      disabled={placeSale.isPending || createCustomer.isPending || cart.length === 0}
                      className="w-full rounded-xl bg-primary py-3.5 text-sm font-bold text-primary-foreground shadow-premium-sm hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {placeSale.isPending || createCustomer.isPending ? (
                        <>
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          <span>Processing Sale…</span>
                        </>
                      ) : (
                        <>
                          <Check className="size-4" />
                          <span>Complete Sale — {formatPrice(total)}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === "success" && saleResult && (
          <div className="flex-1 overflow-y-auto bg-gradient-to-b from-emerald-50/50 to-white p-6 flex flex-col items-center justify-center">
            <div className="max-w-md w-full space-y-6">
              {/* Success Header */}
              <div className="text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 mb-4">
                  <Check className="size-8 text-emerald-600" />
                </div>
                <h2 className="text-2xl font-bold text-emerald-800">Sale Complete!</h2>
                <p className="text-lg font-bold text-foreground mt-1">{saleResult.sale_number}</p>
              </div>

              {/* Sale Details */}
              <div className="rounded-2xl bg-card p-5 shadow-sm border border-gray-100 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Customer</span>
                  <span className="font-semibold">{saleResult.customer_name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Payment</span>
                  <span className="font-semibold uppercase">{saleResult.payment_method}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Items</span>
                  <span className="font-semibold">{saleResult.items_count}</span>
                </div>
                {saleResult.discount > 0 && (
                  <div className="flex justify-between text-sm text-green-700">
                    <span>Discount</span>
                    <span className="font-semibold">−{formatPrice(saleResult.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg border-t border-gray-100 pt-3">
                  <span className="font-bold">Total Paid</span>
                  <span className="font-black text-[#8B2020]">{formatPrice(saleResult.total)}</span>
                </div>
              </div>

              {/* Token Number — prominently displayed for cashier/customer */}
              {saleResult.pos_token_number != null && (
                <div className="rounded-2xl border-2 border-slate-900 bg-slate-50 p-5 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500 mb-2">
                    Walk-in Token
                  </p>
                  <p className="text-7xl font-black text-slate-900 leading-none">
                    {saleResult.pos_token_number}
                  </p>
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mt-2">
                    Token Number
                  </p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="space-y-3">
                <button
                  onClick={() => setIsReceiptModalOpen(true)}
                  className="w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white shadow-sm hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
                >
                  <Printer className="size-4" />
                  Reprint Thermal Receipt
                </button>
                <button
                  onClick={() => setShowLabels(true)}
                  className="w-full rounded-xl border border-border bg-card py-3 text-sm font-bold text-muted-foreground shadow-sm hover:bg-muted transition-all flex items-center justify-center gap-2"
                >
                  <ReceiptText className="size-4" />
                  Print Barcode Labels
                </button>
                <button
                  onClick={resetPOS}
                  className="w-full rounded-xl bg-[#8B2020] py-3 text-sm font-bold text-white shadow-sm hover:bg-[#7a1c1c] transition-all flex items-center justify-center gap-2"
                >
                  <Plus className="size-4" />
                  New Sale
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Receipt Modal */}
      {isReceiptModalOpen && saleResult && (
        <ThermalReceipt
          sale={{
            sale_number: saleResult.sale_number,
            customer_name: saleResult.customer_name,
            customer_phone: saleResult.customer_phone,
            subtotal: saleResult.subtotal,
            discount: saleResult.discount,
            discount_type: saleResult.discount_type,
            discount_value: saleResult.discount_value,
            total: saleResult.total,
            payment_method: saleResult.payment_method,
            pos_token_number: saleResult.pos_token_number,
          }}
          items={cart.map((c) => ({
            name: c.name,
            sku: c.sku,
            price: c.price,
            qty: c.qty,
          }))}
          autoPrint={true}
          onClose={() => setIsReceiptModalOpen(false)}
        />
      )}

      {/* Labels Modal */}
      {showLabels && (
        <PrintLabelsModal
          products={cart.map((item) => ({
            uuid: item.product_id,
            id: item.slug,
            name: item.name,
            brand: item.brand,
            category: item.category,
            price: item.price,
            mrp: item.mrp,
            stock: item.stock,
            sku: item.sku,
            barcode: item.barcode,
            image: item.image_url ?? "",
            imageUrl: item.image_url,
            description: "",
            highlights: [],
            isFeatured: false,
            isActive: true,
            sortOrder: 0,
            lowStockAt: 5,
            rating: 0,
            reviews: 0,
            ageGroup: item.age_group,
            images: [],
          }))}
          onClose={() => setShowLabels(false)}
        />
      )}
    </div>
  );
}
