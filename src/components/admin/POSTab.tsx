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
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { type Product, mapProduct, formatPrice } from "@/lib/store";
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
import { POSReceipt } from "@/components/admin/POSReceipt";
import { PrintLabelsModal } from "@/components/admin/PrintLabelsModal";
import { useSession } from "@/lib/auth";

type POSStep = "cart" | "checkout" | "success";

export function POSTab() {
  const qc = useQueryClient();
  const { user } = useSession();
  const scanInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<POSStep>("cart");

  // Cart state
  const [cart, setCart] = useState<POSCartItem[]>([]);
  const [scanValue, setScanValue] = useState("");
  const [scanLoading, setScanLoading] = useState(false);
  const [productSearch, setProductSearch] = useState("");

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
  const [showReceipt, setShowReceipt] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
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

  // Cart calculations
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const discountAmount = calculateDiscount(subtotal, discountType, discountValue);
  const total = Math.max(0, subtotal - discountAmount);
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

  // Hardware barcode scanner: captures rapid keystrokes globally
  useEffect(() => {
    let buffer = "";
    let timeoutId: ReturnType<typeof setTimeout>;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only capture when step is cart and no input is focused (except scan input)
      if (step !== "cart") return;
      const target = e.target as HTMLElement;
      const isScanInput = target === scanInputRef.current;
      const isOtherInput =
        (target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement) &&
        !isScanInput;
      if (isOtherInput) return;

      if (e.key === "Enter" && buffer.trim().length > 0) {
        e.preventDefault();
        const code = buffer.trim();
        buffer = "";
        setScanValue("");
        handleScan(code);
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        buffer += e.key;
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          buffer = "";
        }, 150);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      clearTimeout(timeoutId);
    };
  }, [step, cart]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scan handler
  const handleScan = useCallback(
    async (code: string) => {
      if (!code.trim()) return;
      setScanLoading(true);
      try {
        const result = await lookupBarcode(code);

        if (!result.found) {
          toast.error(`Product not found: ${code}`);
          return;
        }

        if (result.archived) {
          toast.error(`"${result.name}" is archived and unavailable for sale`, { duration: 5000 });
          return;
        }

        if ((result.stock ?? 0) <= 0) {
          toast.error(`"${result.name}" is out of stock!`);
          return;
        }

        addToCart({
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

        toast.success(`Added: ${result.name}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Scan failed");
      } finally {
        setScanLoading(false);
      }
    },
    [cart], // eslint-disable-line react-hooks/exhaustive-deps
  );

  function addToCart(item: POSCartItem) {
    setCart((prev) => {
      const existing = prev.find((p) => p.product_id === item.product_id);
      if (existing) {
        if (existing.qty >= item.stock) {
          toast.error(`Cannot add more "${item.name}". Only ${item.stock} in stock.`);
          return prev;
        }
        return prev.map((p) => (p.product_id === item.product_id ? { ...p, qty: p.qty + 1 } : p));
      }
      return [...prev, { ...item, qty: 1 }];
    });
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
      image_url: product.imageUrl,
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
    }
  }, [customerSearchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-h-[80dvh] flex-col rounded-2xl border border-border/50 bg-background lg:flex-row">
      {/* ====== LEFT PANEL: Cart & Scanning ====== */}
      <div className="flex flex-1 flex-col border-r border-border/50 min-w-0">
        {/* Scanner Header */}
        <div className="flex items-center justify-between border-b border-border/50 bg-muted/30 p-4 gap-3">
          <h2 className="font-display text-lg font-bold shrink-0">POS Terminal</h2>
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Scan className="size-4 text-primary animate-pulse" />
            Scanner Active
          </div>
        </div>

        {/* Scan Input */}
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
                disabled={step !== "cart"}
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
                disabled={step !== "cart"}
              />
            </div>
            {filteredProducts.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 z-20 max-h-64 overflow-y-auto rounded-xl border border-border bg-card shadow-xl">
                {filteredProducts.map((p) => (
                  <button
                    key={p.uuid}
                    onClick={() => addProductManually(p)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted transition-colors border-b border-border/30 last:border-0"
                  >
                    <img
                      src={p.image}
                      alt=""
                      className="size-8 rounded-lg object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.opacity = "0";
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{p.name}</p>
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

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto p-4">
          {cart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-muted-foreground py-16">
              <ShoppingBag className="size-12 opacity-20 mb-4" />
              <p className="font-semibold">Cart is empty</p>
              <p className="text-xs mt-1">Scan a barcode or search products to add items</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
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
                      className="border-b border-border/50 hover:bg-muted/30"
                    >
                      <td className="py-3">
                        <p className="font-semibold text-sm leading-tight">{item.name}</p>
                        <p className="text-[10px] text-muted-foreground">{item.brand}</p>
                      </td>
                      <td className="py-3 font-mono text-xs text-muted-foreground">{item.sku}</td>
                      <td className="py-3 text-right font-semibold">{formatPrice(item.price)}</td>
                      <td className="py-3 text-center">
                        <span
                          className={`text-xs font-bold ${
                            item.stock <= 5 ? "text-amber-600" : "text-muted-foreground"
                          }`}
                        >
                          {item.stock}
                        </span>
                      </td>
                      <td className="py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => updateQty(item.product_id, item.qty - 1)}
                            className="p-1 rounded-md hover:bg-muted border border-border"
                          >
                            <Minus className="size-3" />
                          </button>
                          <input
                            type="number"
                            value={item.qty}
                            onChange={(e) =>
                              updateQty(item.product_id, parseInt(e.target.value) || 1)
                            }
                            className="w-10 text-center text-sm font-bold rounded-md border border-border bg-background py-0.5"
                            min={1}
                            max={item.stock}
                          />
                          <button
                            onClick={() => updateQty(item.product_id, item.qty + 1)}
                            className="p-1 rounded-md hover:bg-muted border border-border"
                          >
                            <Plus className="size-3" />
                          </button>
                        </div>
                      </td>
                      <td className="py-3 text-right font-bold">
                        {formatPrice(item.price * item.qty)}
                      </td>
                      <td className="py-3 pl-2">
                        <button
                          onClick={() => removeFromCart(item.product_id)}
                          className="p-1.5 text-destructive hover:bg-destructive/10 rounded-lg"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Cart Footer */}
        {cart.length > 0 && step === "cart" && (
          <div className="border-t border-border/50 bg-card p-4">
            <div className="flex items-center justify-between text-sm mb-3">
              <span className="text-muted-foreground">
                {totalItems} item{totalItems !== 1 ? "s" : ""}
              </span>
              <span className="font-bold text-lg">{formatPrice(subtotal)}</span>
            </div>
            <button
              onClick={() => setStep("checkout")}
              className="w-full rounded-xl bg-[#8B2020] py-3 text-sm font-bold text-white shadow-sm hover:bg-[#7a1c1c] transition-colors flex items-center justify-center gap-2"
            >
              Proceed to Checkout
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}
      </div>

      {/* ====== RIGHT PANEL: Checkout / Success ====== */}
      <div className="flex w-full flex-col bg-gradient-to-b from-[#fdf2f7] to-white lg:w-[28rem] overflow-y-auto">
        {step === "cart" && (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center text-muted-foreground">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#fce4ef] mb-4">
              <span className="text-3xl">👶</span>
            </div>
            <h2 className="text-xl font-bold text-foreground">
              Zérah <span className="text-[#d85c88] font-serif italic">Baby & Kids</span>
            </h2>
            <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-muted-foreground mt-1">
              Point of Sale
            </p>
            <p className="mt-6 text-sm">
              Scan products or add them manually, then proceed to checkout.
            </p>
          </div>
        )}

        {step === "checkout" && (
          <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">Checkout</h2>
              <button
                onClick={() => setStep("cart")}
                className="text-sm font-semibold text-muted-foreground hover:text-foreground"
              >
                ← Back to Cart
              </button>
            </div>

            {/* Discount Section */}
            <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100">
              <h3 className="text-sm font-bold mb-3">Discount</h3>
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
                    onClick={() => {
                      setDiscountType(type);
                      if (type === "none") setDiscountValue(0);
                    }}
                    className={`flex-1 rounded-xl py-2 text-xs font-bold transition-all ${
                      discountType === type
                        ? "bg-[#8B2020] text-white shadow-sm"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {discountType !== "none" && (
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={discountValue || ""}
                    onChange={(e) => setDiscountValue(Math.max(0, Number(e.target.value)))}
                    placeholder={discountType === "percentage" ? "Enter %" : "Enter ₹ amount"}
                    min={0}
                    max={discountType === "percentage" ? 100 : subtotal}
                    className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-[#8B2020] transition-all"
                  />
                  {discountAmount > 0 && (
                    <span className="text-sm font-bold text-green-700">
                      −{formatPrice(discountAmount)}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Customer Section */}
            <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100">
              <h3 className="text-sm font-bold mb-3">Customer</h3>
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
                    onClick={() => {
                      setCustomerMode(mode);
                      if (mode === "walkin") {
                        setCustomerName("");
                        setCustomerPhone("");
                        setCustomerEmail("");
                        setCustomerId(null);
                      }
                    }}
                    className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition-all ${
                      customerMode === mode
                        ? "bg-[#8B2020] text-white shadow-sm"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    <Icon className="size-3" />
                    {label}
                  </button>
                ))}
              </div>

              {customerMode === "walkin" && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Sale will be recorded as <span className="font-bold">Walk-in Customer</span>
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
                      className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-9 pr-3 py-2 text-sm outline-none focus:border-[#8B2020] transition-all"
                    />
                  </div>
                  {(searchCustomers.data ?? []).length > 0 && (
                    <div className="max-h-32 overflow-y-auto rounded-xl border border-gray-200 bg-white">
                      {searchCustomers.data!.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            setCustomerName(c.name);
                            setCustomerPhone(c.phone);
                            setCustomerEmail(c.email);
                            setCustomerId(c.id);
                            setCustomerSearchQuery("");
                            toast.success(`Customer: ${c.name}`);
                          }}
                          className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                        >
                          <div>
                            <p className="font-semibold">{c.name || "—"}</p>
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
                        onClick={() => {
                          setCustomerId(null);
                          setCustomerName("");
                          setCustomerPhone("");
                        }}
                        className="ml-auto text-emerald-600 hover:text-emerald-800"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {customerMode === "new" && (
                <div className="space-y-2">
                  <input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Customer name"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-[#8B2020] transition-all"
                  />
                  <input
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="Phone number"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-[#8B2020] transition-all"
                  />
                </div>
              )}
            </div>

            {/* Payment Section */}
            <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100">
              <h3 className="text-sm font-bold mb-3">Payment Method</h3>
              <div className="grid grid-cols-2 gap-2">
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
                    onClick={() => setPaymentMethod(method)}
                    className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition-all ${
                      paymentMethod === method
                        ? "bg-[#8B2020] text-white shadow-sm"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    <Icon className="size-4" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Summary */}
            <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100">
              <h3 className="text-sm font-bold mb-3">Order Summary</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Items ({totalItems})</span>
                  <span className="font-semibold">{formatPrice(subtotal)}</span>
                </div>
                {discountAmount > 0 && (
                  <div className="flex justify-between text-green-700">
                    <span>
                      Discount
                      {discountType === "percentage" ? ` (${discountValue}%)` : ""}
                    </span>
                    <span className="font-semibold">−{formatPrice(discountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-gray-100 pt-2 text-lg">
                  <span className="font-bold">Total</span>
                  <span className="font-black text-[#8B2020]">{formatPrice(total)}</span>
                </div>
              </div>
            </div>

            {/* Complete Sale Button */}
            <button
              onClick={() => {
                if (customerMode === "new" && customerName && customerPhone) {
                  createCustomer.mutate(
                    { name: customerName, phone: customerPhone, email: customerEmail },
                    {
                      onSuccess: (newCustomer) => {
                        setCustomerId(newCustomer.id);
                        // Proceed with sale after customer creation
                        setTimeout(() => completeSale(), 100);
                      },
                      onError: (e) => {
                        // Customer may already exist, proceed anyway
                        completeSale();
                      },
                    },
                  );
                } else {
                  completeSale();
                }
              }}
              disabled={placeSale.isPending || cart.length === 0}
              className="w-full rounded-xl bg-slate-900 py-4 text-sm font-bold text-white shadow-lg hover:bg-slate-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {placeSale.isPending ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Processing...
                </>
              ) : (
                <>
                  <Check className="size-4" />
                  Complete Sale — {formatPrice(total)}
                </>
              )}
            </button>
          </div>
        )}

        {step === "success" && saleResult && (
          <div className="p-6 space-y-6">
            {/* Success Header */}
            <div className="text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 mb-4">
                <Check className="size-8 text-emerald-600" />
              </div>
              <h2 className="text-2xl font-bold text-emerald-800">Sale Complete!</h2>
              <p className="text-lg font-bold text-foreground mt-1">{saleResult.sale_number}</p>
            </div>

            {/* Sale Details */}
            <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100 space-y-3">
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

            {/* Action Buttons */}
            <div className="space-y-3">
              <button
                onClick={() => setShowReceipt(true)}
                className="w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white shadow-sm hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
              >
                <Printer className="size-4" />
                Print Receipt / Invoice
              </button>
              <button
                onClick={() => setShowLabels(true)}
                className="w-full rounded-xl border border-gray-200 bg-white py-3 text-sm font-bold text-gray-700 shadow-sm hover:bg-gray-50 transition-all flex items-center justify-center gap-2"
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
        )}
      </div>

      {/* Receipt Modal */}
      {showReceipt && saleResult && (
        <POSReceipt
          sale={saleResult}
          items={cart}
          onClose={() => setShowReceipt(false)}
          staffEmail={user?.email}
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
