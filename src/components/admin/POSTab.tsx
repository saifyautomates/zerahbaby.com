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
  Receipt,
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
import { type Product, mapProduct, formatPrice, imageFor, getColorSwatchImage } from "@/lib/store";
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
import { A4Invoice, type A4InvoiceItem } from "@/components/admin/A4Invoice";
import { PrintLabelsModal } from "@/components/admin/PrintLabelsModal";
import { useSession } from "@/lib/auth";
import { useOfflineSyncStatus } from "@/lib/offline-sync-engine";
import { POSTerminalSkeleton } from "@/components/ui/Skeletons";

type POSStep = "cart" | "checkout" | "success";

const POS_DRAFT_KEY = "zerah_pos_terminal_draft_v1";

type POSDraftState = {
  cart: POSCartItem[];
  step: POSStep;
  discountType: "none" | "percentage" | "fixed";
  discountValue: number;
  customerMode: "walkin" | "existing" | "new";
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerId: string | null;
  paymentMethod: string;
};

function loadPOSDraft(): POSDraftState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(POS_DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function POSTab() {
  const qc = useQueryClient();
  const { user } = useSession();
  const syncStatus = useOfflineSyncStatus();
  const scanInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<POSStep>(() => {
    const draft = loadPOSDraft();
    return draft?.step === "checkout" && (draft.cart?.length || 0) > 0 ? "checkout" : "cart";
  });

  // Persistent Cart state
  const [cart, setCart] = useState<POSCartItem[]>(() => {
    const draft = loadPOSDraft();
    return draft?.cart || [];
  });
  const [scanValue, setScanValue] = useState("");
  const [scanLoading, setScanLoading] = useState(false);
  const [productSearch, setProductSearch] = useState("");

  // Quick Order State
  const [quickOrderProduct, setQuickOrderProduct] = useState("");
  const [quickOrderPrice, setQuickOrderPrice] = useState("");

  // Discount state
  const [discountType, setDiscountType] = useState<"none" | "percentage" | "fixed">(() => {
    const draft = loadPOSDraft();
    return draft?.discountType || "none";
  });
  const [discountValue, setDiscountValue] = useState<number>(() => {
    const draft = loadPOSDraft();
    return draft?.discountValue || 0;
  });

  // Customer state
  const [customerMode, setCustomerMode] = useState<"walkin" | "existing" | "new">(() => {
    const draft = loadPOSDraft();
    return draft?.customerMode || "walkin";
  });
  const [customerName, setCustomerName] = useState(() => {
    const draft = loadPOSDraft();
    return draft?.customerName || "";
  });
  const [customerPhone, setCustomerPhone] = useState(() => {
    const draft = loadPOSDraft();
    return draft?.customerPhone || "";
  });
  const [customerEmail, setCustomerEmail] = useState(() => {
    const draft = loadPOSDraft();
    return draft?.customerEmail || "";
  });
  const [customerId, setCustomerId] = useState<string | null>(() => {
    const draft = loadPOSDraft();
    return draft?.customerId || null;
  });
  const [customerSearchQuery, setCustomerSearchQuery] = useState("");

  // Payment state
  const [paymentMethod, setPaymentMethod] = useState<string>(() => {
    const draft = loadPOSDraft();
    return draft?.paymentMethod || "cash";
  });
  const [cashTendered, setCashTendered] = useState<number | "">("");

  // Auto-save active POS cart and cashier state to localStorage
  useEffect(() => {
    if (cart.length > 0 && step !== "success") {
      const draft: POSDraftState = {
        cart,
        step,
        discountType,
        discountValue,
        customerMode,
        customerName,
        customerPhone,
        customerEmail,
        customerId,
        paymentMethod,
      };
      try {
        localStorage.setItem(POS_DRAFT_KEY, JSON.stringify(draft));
      } catch {
        // ignore storage quota errors
      }
    } else if (cart.length === 0) {
      try {
        localStorage.removeItem(POS_DRAFT_KEY);
      } catch {
        // ignore
      }
    }
  }, [
    cart,
    step,
    discountType,
    discountValue,
    customerMode,
    customerName,
    customerPhone,
    customerEmail,
    customerId,
    paymentMethod,
  ]);

  // Prevent accidental page unload / refresh when items are in POS cart
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (cart.length > 0 && step !== "success") {
        e.preventDefault();
        e.returnValue = "You have active unbilled items in your POS cart.";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [cart.length, step]);

  // Sale result
  const [saleResult, setSaleResult] = useState<SaleResult | null>(null);
  // Frozen snapshot of cart items at sale commit time — used for receipt/invoice
  // (cart may be cleared before modal opens on a new sale)
  const [saleItems, setSaleItems] = useState<A4InvoiceItem[]>([]);
  const [showLabels, setShowLabels] = useState(false);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [isA4InvoiceOpen, setIsA4InvoiceOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(generateIdempotencyKey());

  // Print Format Target: "thermal" (80mm Thermal Slip) or "a4" (A4 Tax Invoice on Laser/Desktop Printer)
  const [printFormat, setPrintFormatState] = useState<"thermal" | "a4">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("zerah_pos_print_format") as "thermal" | "a4" | null;
      if (saved && ["thermal", "a4"].includes(saved)) return saved;
    }
    return "thermal";
  });

  const setPrintFormat = (fmt: "thermal" | "a4") => {
    setPrintFormatState(fmt);
    if (typeof window !== "undefined") {
      localStorage.setItem("zerah_pos_print_format", fmt);
    }
  };

  // Product detail drawer
  const [selectedPOSItem, setSelectedPOSItem] = useState<POSCartItem | null>(null);

  // Calculations
  const subtotal = useMemo(
    () => cart.reduce((acc, item) => acc + item.price * item.qty, 0),
    [cart],
  );

  const totalItems = useMemo(() => cart.reduce((acc, item) => acc + item.qty, 0), [cart]);

  const discountAmount = useMemo(() => {
    if (discountType === "none" || !discountValue || discountValue <= 0) return 0;
    if (discountType === "percentage") {
      return Math.round((subtotal * Math.min(100, discountValue)) / 100);
    }
    return Math.min(subtotal, discountValue);
  }, [subtotal, discountType, discountValue]);

  const total = useMemo(() => Math.max(0, subtotal - discountAmount), [subtotal, discountAmount]);

  const changeDue = useMemo(() => {
    if (typeof cashTendered !== "number" || cashTendered < total) return 0;
    return cashTendered - total;
  }, [cashTendered, total]);

  // Products for manual search (active only, including offline-only items and all variants)
  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: ["pos-products"],
    staleTime: 1000 * 60 * 5, // 5 minutes caching
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "*, product_images(public_url, is_primary, sort_order, color, alt_text), product_variants(id, name, sku, stock, price_override, mrp_override, color, size, barcode, image_url)",
        )
        .eq("is_active", true);
      if (error) throw error;
      const mapped = (data as never[]).map((r) => mapProduct(r as never));
      import("@/lib/offline-sync-engine")
        .then((m) => {
          m.cacheFullCatalog(mapped as unknown as Array<Record<string, unknown>>).catch(() => null);
        })
        .catch(() => null);
      return mapped;
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
        variant_id: `00000000-0000-0000-0000-000000000000`, // dummy variant for custom item
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
  const handleScan = useCallback(
    async (code: string) => {
      const cleanCode = code.trim();
      if (!cleanCode) return;
      setScanValue("");
      setScanLoading(true);
      try {
        const result = await lookupBarcode(cleanCode);

        if (result && result.found) {
          if (result.archived) {
            playScanError();
            toast.error(`"${result.name}" is archived and unavailable for sale`, {
              duration: 5000,
            });
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
            variant_id: result.variant_id || "",
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
            sales_channel: (result.sales_channel || "ONLINE_AND_OFFLINE") as
              "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY",
          });

          if (added) {
            playScanSuccess();
            const isOfflineOnly = result.sales_channel === "OFFLINE_ONLY";
            toast.success(`Scanned: ${result.name}`, {
              description: `₹${result.price} • ${isOfflineOnly ? "🏪 Offline Only" : "🌐 Online + Store"} • SKU: ${result.sku || "N/A"} • Stock: ${result.stock}`,
            });
          }
          return;
        }

        // Fallback: search in loaded local products catalog
        const q = cleanCode.toLowerCase();
        const localMatches = products.filter((p) => {
          return (
            p.sku.toLowerCase() === q ||
            p.barcode?.toLowerCase() === q ||
            p.id.toLowerCase() === q ||
            p.name.toLowerCase().includes(q) ||
            p.variants?.some((v) => v.sku?.toLowerCase() === q || v.barcode?.toLowerCase() === q)
          );
        });

        if (localMatches.length === 1) {
          const p = localMatches[0];
          const matchedVar = p.variants?.find(
            (v) => v.sku?.toLowerCase() === q || v.barcode?.toLowerCase() === q,
          );
          addProductManually(p, matchedVar);
          playScanSuccess();
          return;
        }

        if (localMatches.length > 1) {
          setProductSearch(cleanCode);
          toast.info(`Found ${localMatches.length} products matching "${cleanCode}"`);
          return;
        }

        playScanError();
        toast.error(`Product not found for barcode/SKU: ${cleanCode}`, {
          description: "Check if the barcode is assigned or search product catalogue manually.",
        });
      } catch (e) {
        playScanError();
        toast.error(e instanceof Error ? e.message : "Scan failed");
      } finally {
        setScanLoading(false);
      }
    },
    [products],
  );

  // Hook into centralized hardware scanner events (also drains queued scans on mount)
  useGlobalBarcodeScanner(handleScan);

  function addToCart(item: POSCartItem): boolean {
    let added = true;
    setCart((prev) => {
      const existing = prev.find(
        (p) => p.product_id === item.product_id && (p.variant_id || "") === (item.variant_id || ""),
      );
      if (existing) {
        if (existing.qty >= item.stock) {
          playScanError();
          toast.error(`Cannot add more "${item.name}". Only ${item.stock} in stock.`);
          added = false;
          return prev;
        }
        return prev.map((p) =>
          p.product_id === item.product_id && (p.variant_id || "") === (item.variant_id || "")
            ? { ...p, qty: p.qty + 1 }
            : p,
        );
      }
      return [...prev, { ...item, qty: 1 }];
    });
    return added;
  }

  function addProductManually(product: Product, variant?: (typeof product.variants)[0]) {
    const inStockVar = product.variants?.find((v) => (v.stock ?? 0) > 0);
    const selectedVar =
      variant || inStockVar || (product.variants?.length ? product.variants[0] : undefined);
    const stock =
      selectedVar && selectedVar.stock > 0
        ? selectedVar.stock
        : Math.max(selectedVar?.stock || 0, product.stock || 0);

    if (stock <= 0) {
      toast.error(
        `"${product.name}${selectedVar?.name && selectedVar.name !== "Default" ? ` (${selectedVar.name})` : ""}" is out of stock`,
      );
      return;
    }

    const varName = selectedVar && selectedVar.name !== "Default" ? ` - ${selectedVar.name}` : "";
    const color = selectedVar?.color || null;
    const size = selectedVar?.size || null;
    const swatchImg = color ? getColorSwatchImage(product, color) : null;

    addToCart({
      product_id: product.uuid,
      variant_id: selectedVar?.id || "",
      slug: product.id,
      name: `${product.name}${varName}`,
      brand: product.brand,
      category: product.category,
      price: selectedVar?.priceOverride || product.price,
      mrp: selectedVar?.mrpOverride || product.mrp,
      stock: stock,
      sku: selectedVar?.sku || product.sku,
      barcode: selectedVar?.barcode || product.barcode,
      image_url: swatchImg || product.imageUrl || product.image,
      age_group: product.ageGroup,
      qty: 1,
      sales_channel: (product.sales_channel || product.salesChannel || "ONLINE_AND_OFFLINE") as
        "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY",
    });
    setProductSearch("");
    const isOfflineOnly = (product.sales_channel || product.salesChannel) === "OFFLINE_ONLY";
    toast.success(`Added: ${product.name}${varName}`, {
      description: `${isOfflineOnly ? "🏪 Offline Only" : "🌐 Online + Store"} • ₹${selectedVar?.priceOverride || product.price}`,
    });
    setTimeout(() => scanInputRef.current?.focus(), 50);
  }

  function updateQty(productId: string, newQty: number, variantId?: string) {
    setCart((prev) =>
      prev.map((p) => {
        if (p.product_id === productId && (p.variant_id || "") === (variantId || "")) {
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

  function removeFromCart(productId: string, variantId?: string) {
    setCart((prev) =>
      prev.filter(
        (p) => !(p.product_id === productId && (p.variant_id || "") === (variantId || "")),
      ),
    );
  }

  // Complete sale
  async function completeSale() {
    if (cart.length === 0) {
      toast.error("Cart is empty");
      return;
    }

    const rpcItems = cart.map((item) => ({
      product_id: item.isCustom ? undefined : item.product_id,
      variant_id: item.variant_id || "",
      product_slug: item.isCustom ? `custom-${Date.now()}` : item.slug,
      name: item.name,
      sku: item.sku,
      qty: item.qty,
      custom_price: item.isCustom ? item.price : undefined,
      price: item.price,
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

      // Snapshot cart items NOW before any reset for printing
      setSaleItems(
        cart.map((c) => ({ name: c.name, sku: c.sku, price: c.price, mrp: c.mrp, qty: c.qty })),
      );
      setSaleResult(result);

      // Instantly clear cart, draft storage & customer states so everything is 100% fresh
      setCart([]);
      setDiscountType("none");
      setDiscountValue(0);
      setCustomerMode("walkin");
      setCustomerName("");
      setCustomerPhone("");
      setCustomerEmail("");
      setCustomerId(null);
      setCustomerSearchQuery("");
      setProductSearch("");
      setScanValue("");
      setCashTendered("");
      setIdempotencyKey(generateIdempotencyKey());
      try {
        localStorage.removeItem(POS_DRAFT_KEY);
      } catch {
        // ignore
      }

      // Open receipt or invoice modal based on user's printer format selection (with autoPrint)
      if (printFormat === "a4") {
        setIsA4InvoiceOpen(true);
        setIsReceiptModalOpen(false);
      } else {
        setIsReceiptModalOpen(true);
        setIsA4InvoiceOpen(false);
      }
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
    setCashTendered("");
    setSaleResult(null);
    setSaleItems([]);
    setStep("cart");
    setIdempotencyKey(generateIdempotencyKey());
    setProductSearch("");
    setScanValue("");
    setCustomerSearchQuery("");
    try {
      localStorage.removeItem(POS_DRAFT_KEY);
    } catch {
      // ignore
    }
    setTimeout(() => scanInputRef.current?.focus(), 80);
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

  if (productsLoading && products.length === 0) {
    return <POSTerminalSkeleton />;
  }

  return (
    <div className="flex min-h-full flex-col rounded-2xl border border-border/50 bg-background relative">
      {/* ====== LEFT PANEL: Cart & Scanning ====== */}
      <div className="flex flex-1 flex-col min-w-0 min-h-0">
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
                  {syncStatus.pendingCount} offline sale{syncStatus.pendingCount > 1 ? "s" : ""}{" "}
                  pending • Sync now
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
          <div className="p-4 border-b border-border/50 bg-card space-y-3">
            {/* Top Primary Input: Barcode / SKU Scanner */}
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Scan className="absolute left-4 top-3.5 size-5 text-muted-foreground" />
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
                  aria-label="Scan barcode or SKU"
                  className="focus-ring w-full rounded-2xl border border-border/80 bg-card pl-12 pr-10 py-3.5 text-base sm:text-lg font-bold outline-none focus:border-primary focus:ring-4 focus:ring-primary/20 shadow-premium-sm hover:shadow-premium-md transition-all"
                  autoFocus
                />
                {scanValue && (
                  <button
                    type="button"
                    onClick={() => {
                      setScanValue("");
                      scanInputRef.current?.focus();
                    }}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded-full hover:bg-muted transition-colors cursor-pointer"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
              {scanLoading && (
                <div className="flex items-center px-3">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              )}
            </div>

            {/* Bottom Secondary Input: Manual Product Search */}
            <div className="relative">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <input
                  type="text"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && filteredProducts.length > 0) {
                      e.preventDefault();
                      addProductManually(filteredProducts[0]);
                    } else if (e.key === "Escape") {
                      setProductSearch("");
                      scanInputRef.current?.focus();
                    }
                  }}
                  placeholder="Search products manually (or press Enter to select first result)…"
                  className="w-full rounded-xl border border-border bg-background pl-10 pr-9 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                />
                {productSearch && (
                  <button
                    type="button"
                    onClick={() => {
                      setProductSearch("");
                      scanInputRef.current?.focus();
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded-full hover:bg-muted transition-colors cursor-pointer"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
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
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-semibold truncate text-foreground">{p.name}</p>
                          {p.salesChannel === "OFFLINE_ONLY" ? (
                            <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.2 text-[9px] font-extrabold bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/25">
                              🏪 Offline Only
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.2 text-[9px] font-extrabold bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/25">
                              🌐 Online + Store
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {p.sku} • {formatPrice(p.price)} • Stock: {p.stock}
                        </p>
                      </div>
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          p.stock > 0
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-red-100 text-red-700"
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
              <div className="overflow-x-auto pb-4">
                <table className="w-full min-w-[600px] md:min-w-[800px] text-sm">
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
                        key={`${item.product_id}-${item.variant_id || "def"}`}
                        className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                      >
                        <td className="py-3 pr-4">
                          <button
                            type="button"
                            onClick={() => setSelectedPOSItem(item)}
                            className="flex items-center gap-3 text-left cursor-pointer group w-full"
                            title="Click to view product details"
                          >
                            <img
                              src={imageFor(item.category || "clothing", item.image_url)}
                              alt={item.name}
                              loading="lazy"
                              decoding="async"
                              className="size-10 rounded-lg object-cover border border-border shrink-0 group-hover:ring-2 group-hover:ring-primary/40 transition-all"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = clothing;
                              }}
                            />
                            <div className="min-w-0">
                              <p className="font-semibold text-foreground text-sm group-hover:text-primary transition-colors line-clamp-2">
                                {item.name}
                              </p>
                              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                {item.sales_channel === "OFFLINE_ONLY" ? (
                                  <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-extrabold bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/25">
                                    <span>🏪</span> Offline Only
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-extrabold bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/25">
                                    <span>🌐</span> Online + Offline
                                  </span>
                                )}
                                {item.isCustom && (
                                  <span className="text-[10px] text-amber-600 font-bold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                    Custom Price
                                  </span>
                                )}
                                <span className="text-[10px] text-muted-foreground">
                                  {item.brand}
                                </span>
                              </div>
                            </div>
                          </button>
                        </td>
                        <td className="py-3 font-mono text-xs text-muted-foreground">
                          {item.sku || "—"}
                        </td>
                        <td className="py-3 text-right font-semibold">{formatPrice(item.price)}</td>
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
                              onClick={() =>
                                updateQty(item.product_id, item.qty - 1, item.variant_id)
                              }
                              className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                            >
                              <Minus className="size-3" />
                            </button>
                            <span className="w-8 text-center text-xs font-bold">{item.qty}</span>
                            <button
                              onClick={() =>
                                updateQty(item.product_id, item.qty + 1, item.variant_id)
                              }
                              disabled={item.qty >= item.stock}
                              className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
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
                            onClick={() => removeFromCart(item.product_id, item.variant_id)}
                            className="text-muted-foreground hover:text-destructive p-1 rounded hover:bg-red-50 cursor-pointer"
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
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Are you sure you want to cancel and clear all items from this POS cart?",
                      )
                    ) {
                      resetPOS();
                    }
                  }}
                  className="rounded-xl border border-red-200 bg-red-50/70 px-4 py-3 text-xs font-bold text-red-700 hover:bg-red-100 transition-all cursor-pointer flex items-center gap-1.5"
                  title="Cancel and clear active POS cart"
                >
                  <Trash2 className="size-3.5" />
                  <span>Cancel Cart</span>
                </button>

                <button
                  onClick={() => setStep("checkout")}
                  className="focus-ring press rounded-xl bg-primary px-8 py-3 text-sm font-bold text-primary-foreground shadow-premium-sm hover:bg-primary/90 hover:shadow-premium-md hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  Proceed to Checkout
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ====== Checkout Step — World-Class 2-Column Cashier Layout ====== */}
        {step === "checkout" && (
          <div className="flex-1 overflow-y-auto bg-muted/20 p-4 sm:p-6">
            <div className="max-w-5xl mx-auto space-y-5">
              {/* Top Navigation & Status Bar */}
              <div className="flex items-center justify-between bg-card p-4 rounded-2xl border border-border shadow-2xs">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setStep("cart")}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3.5 py-2 text-xs font-bold text-foreground hover:bg-muted hover:text-primary transition-all cursor-pointer shadow-2xs"
                  >
                    ← Back to Cart ({totalItems} items)
                  </button>
                  <div className="hidden sm:block">
                    <h2 className="text-base font-bold text-foreground">Checkout &amp; Billing</h2>
                    <p className="text-[11px] text-muted-foreground">
                      Select discount, customer profile, and payment tender
                    </p>
                  </div>
                </div>
                <div className="text-right flex items-center gap-3">
                  <div className="text-right">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground block">
                      Net Payable
                    </span>
                    <span className="font-black text-xl text-primary">{formatPrice(total)}</span>
                  </div>
                </div>
              </div>

              {/* 2-Column Responsive Layout */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* Left Column (7 cols): Discount, Customer, Payment Tender */}
                <div className="lg:col-span-7 space-y-4">
                  {/* 1. Discount Section with Presets */}
                  <div className="rounded-2xl bg-card p-4 sm:p-5 shadow-2xs border border-border">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-foreground">
                          1. Discount &amp; Offers
                        </h3>
                        {discountAmount > 0 && (
                          <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                            −{formatPrice(discountAmount)} OFF
                          </span>
                        )}
                      </div>
                      {discountType !== "none" && (
                        <button
                          type="button"
                          onClick={() => {
                            setDiscountType("none");
                            setDiscountValue(0);
                          }}
                          className="text-[11px] font-bold text-destructive hover:underline cursor-pointer"
                        >
                          Clear discount
                        </button>
                      )}
                    </div>

                    {/* Discount Type Pills */}
                    <div className="flex gap-2 mb-3">
                      {(
                        [
                          ["none", "No Discount"],
                          ["percentage", "Percent (%)"],
                          ["fixed", "Flat Amount (₹)"],
                        ] as const
                      ).map(([type, label]) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => {
                            setDiscountType(type);
                            if (type === "none") setDiscountValue(0);
                          }}
                          className={`flex-1 rounded-xl py-2.5 text-xs font-bold transition-all cursor-pointer ${
                            discountType === type
                              ? "bg-primary text-primary-foreground shadow-2xs"
                              : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {/* Discount Presets & Input */}
                    {discountType !== "none" && (
                      <div className="space-y-3 pt-1">
                        {/* Quick Presets */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] font-bold text-muted-foreground mr-1">
                            Quick:
                          </span>
                          {discountType === "percentage"
                            ? [5, 10, 15, 20, 25, 50].map((pct) => (
                                <button
                                  key={pct}
                                  type="button"
                                  onClick={() => setDiscountValue(pct)}
                                  className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all cursor-pointer ${
                                    discountValue === pct
                                      ? "bg-emerald-600 text-white shadow-2xs"
                                      : "bg-muted text-foreground hover:bg-muted/80"
                                  }`}
                                >
                                  {pct}%
                                </button>
                              ))
                            : [50, 100, 200, 500, 1000].map((amt) => (
                                <button
                                  key={amt}
                                  type="button"
                                  onClick={() => setDiscountValue(amt)}
                                  className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all cursor-pointer ${
                                    discountValue === amt
                                      ? "bg-emerald-600 text-white shadow-2xs"
                                      : "bg-muted text-foreground hover:bg-muted/80"
                                  }`}
                                >
                                  ₹{amt}
                                </button>
                              ))}
                        </div>

                        {/* Direct Custom Input */}
                        <div className="flex items-center gap-3">
                          <div className="relative flex-1">
                            <input
                              type="number"
                              value={discountValue || ""}
                              onChange={(e) =>
                                setDiscountValue(Math.max(0, Number(e.target.value)))
                              }
                              placeholder={
                                discountType === "percentage"
                                  ? "Enter discount % (e.g. 10)"
                                  : "Enter ₹ discount amount"
                              }
                              min={0}
                              max={discountType === "percentage" ? 100 : subtotal}
                              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all font-bold"
                            />
                          </div>
                          {discountAmount > 0 && (
                            <span className="text-sm font-black text-emerald-700 whitespace-nowrap shrink-0 bg-emerald-50 px-3 py-2 rounded-xl border border-emerald-200">
                              −{formatPrice(discountAmount)}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 2. Customer Section */}
                  <div className="rounded-2xl bg-card p-4 sm:p-5 shadow-2xs border border-border">
                    <h3 className="text-sm font-bold text-foreground mb-3">
                      2. Customer Assignment
                    </h3>
                    <div className="flex gap-2 mb-3">
                      {(
                        [
                          ["walkin", "Walk-in (Default)", User],
                          ["existing", "Search Customer", Search],
                          ["new", "New Customer", UserPlus],
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
                          className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold transition-all cursor-pointer ${
                            customerMode === mode
                              ? "bg-primary text-primary-foreground shadow-2xs"
                              : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                          }`}
                        >
                          <Icon className="size-3.5" />
                          {label}
                        </button>
                      ))}
                    </div>

                    {customerMode === "walkin" && (
                      <div className="flex items-center gap-2 p-3 bg-muted/40 rounded-xl border border-border/50 text-xs text-muted-foreground">
                        <Check className="size-4 text-emerald-600" />
                        <span>
                          Sale will be billed as{" "}
                          <strong className="text-foreground">Walk-in Customer</strong> with instant
                          token generation.
                        </span>
                      </div>
                    )}

                    {customerMode === "existing" && (
                      <div className="space-y-2">
                        <div className="relative">
                          <Phone className="absolute left-3 top-3 size-3.5 text-muted-foreground" />
                          <input
                            type="text"
                            value={customerSearchQuery}
                            onChange={(e) => setCustomerSearchQuery(e.target.value)}
                            placeholder="Type customer mobile number or name..."
                            className="w-full rounded-xl border border-border bg-background pl-9 pr-9 py-2.5 text-sm outline-none focus:border-primary transition-all font-medium"
                          />
                          {customerSearchQuery && (
                            <button
                              type="button"
                              onClick={() => {
                                setCustomerSearchQuery("");
                                searchCustomers.reset();
                              }}
                              className="absolute right-3 top-3 text-muted-foreground hover:text-foreground cursor-pointer"
                            >
                              <X className="size-3.5" />
                            </button>
                          )}
                        </div>
                        {customerSearchQuery.trim().length > 0 &&
                          (searchCustomers.data ?? []).length > 0 && (
                            <div className="max-h-36 overflow-y-auto rounded-xl border border-border bg-card shadow-lg divide-y divide-border">
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
                                    toast.success(`Selected customer: ${c.name}`);
                                  }}
                                  className="flex w-full items-center justify-between px-3 py-2.5 text-sm hover:bg-muted cursor-pointer text-left transition-colors"
                                >
                                  <div>
                                    <p className="font-semibold text-foreground">
                                      {c.name || "Unnamed Customer"}
                                    </p>
                                    <p className="text-xs text-muted-foreground font-mono">
                                      {c.phone}
                                    </p>
                                  </div>
                                  <span className="text-[11px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                                    {c.total_purchases} orders
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        {customerId && (
                          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-xs border border-emerald-200">
                            <Check className="size-4 text-emerald-700 shrink-0" />
                            <div className="flex-1">
                              <p className="font-bold text-emerald-900">{customerName}</p>
                              <p className="text-[11px] text-emerald-700 font-mono">
                                {customerPhone}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setCustomerId(null);
                                setCustomerName("");
                                setCustomerPhone("");
                              }}
                              className="text-emerald-700 hover:text-emerald-900 font-bold text-xs p-1 cursor-pointer"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {customerMode === "new" && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <input
                          value={customerName}
                          onChange={(e) => setCustomerName(e.target.value)}
                          placeholder="Customer Full Name"
                          className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary transition-all font-medium"
                        />
                        <input
                          value={customerPhone}
                          onChange={(e) => setCustomerPhone(e.target.value)}
                          placeholder="Mobile Number (10 digits)"
                          className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary transition-all font-medium"
                        />
                      </div>
                    )}
                  </div>

                  {/* 3. Payment Method & Cash Tender Calculator */}
                  <div className="rounded-2xl bg-card p-4 sm:p-5 shadow-2xs border border-border space-y-4">
                    <h3 className="text-sm font-bold text-foreground">3. Payment Tender</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {(
                        [
                          ["cash", "Cash", Banknote],
                          ["upi", "UPI / QR", Smartphone],
                          ["card", "Card / POS", CreditCard],
                          ["other", "Other Tender", Wallet],
                        ] as const
                      ).map(([method, label, Icon]) => (
                        <button
                          key={method}
                          type="button"
                          onClick={() => {
                            setPaymentMethod(method);
                            if (method === "cash") {
                              setCashTendered(total);
                            }
                          }}
                          className={`flex flex-col items-center justify-center gap-1.5 rounded-xl py-3 px-2 text-xs font-bold transition-all cursor-pointer ${
                            paymentMethod === method
                              ? "bg-primary text-primary-foreground shadow-2xs ring-2 ring-primary/30"
                              : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                          }`}
                        >
                          <Icon className="size-5" />
                          <span>{label}</span>
                        </button>
                      ))}
                    </div>

                    {/* Cash Tender & Change Due Calculator */}
                    {paymentMethod === "cash" && (
                      <div className="rounded-xl bg-muted/40 p-3.5 border border-border/80 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-foreground">Cash Received:</span>
                          {/* Quick tender chips */}
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setCashTendered(total)}
                              className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-background border border-border hover:bg-muted text-foreground cursor-pointer"
                            >
                              Exact ({formatPrice(total)})
                            </button>
                            {[500, 1000, 2000, 5000]
                              .filter((amt) => amt >= total)
                              .slice(0, 3)
                              .map((amt) => (
                                <button
                                  key={amt}
                                  type="button"
                                  onClick={() => setCashTendered(amt)}
                                  className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-background border border-border hover:bg-muted text-foreground cursor-pointer"
                                >
                                  ₹{amt}
                                </button>
                              ))}
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="relative flex-1">
                            <span className="absolute left-3 top-2.5 font-bold text-muted-foreground text-sm">
                              ₹
                            </span>
                            <input
                              type="number"
                              value={cashTendered}
                              onChange={(e) =>
                                setCashTendered(e.target.value === "" ? "" : Number(e.target.value))
                              }
                              placeholder={`Enter cash amount (min ${total})`}
                              min={0}
                              className="w-full rounded-xl border border-border bg-background pl-8 pr-3 py-2 text-sm font-bold outline-none focus:border-primary transition-all"
                            />
                          </div>
                        </div>

                        {typeof cashTendered === "number" && cashTendered > 0 && (
                          <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                            <span className="text-xs font-bold text-emerald-900">
                              Change Due to Customer:
                            </span>
                            <span className="text-base font-black text-emerald-700">
                              {formatPrice(changeDue)}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column (5 cols): Order Summary & Complete Action */}
                <div className="lg:col-span-5 space-y-4">
                  <div className="rounded-2xl bg-card p-5 shadow-2xs border border-border space-y-4 sticky top-4">
                    <div className="flex items-center justify-between border-b border-border pb-3">
                      <h3 className="text-sm font-bold text-foreground">Order Summary</h3>
                      <span className="text-xs font-bold text-muted-foreground">
                        {totalItems} items
                      </span>
                    </div>

                    {/* Items List Snapshot */}
                    <div className="max-h-48 overflow-y-auto space-y-2 pr-1 divide-y divide-border/40 text-xs">
                      {cart.map((item) => (
                        <div
                          key={item.product_id}
                          className="pt-2 first:pt-0 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="font-semibold truncate text-foreground text-xs">
                                {item.name}
                              </p>
                              {item.sales_channel === "OFFLINE_ONLY" ? (
                                <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.2 text-[9px] font-bold bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/25">
                                  🏪 Offline Only
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.2 text-[9px] font-bold bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/25">
                                  🌐 Online + POS
                                </span>
                              )}
                            </div>
                            <p className="text-muted-foreground text-[10px] mt-0.5">
                              {item.qty} × {formatPrice(item.price)}
                              {item.isCustom && (
                                <span className="ml-1 text-amber-600 font-bold">(Custom)</span>
                              )}
                            </p>
                          </div>
                          <span className="font-bold text-foreground shrink-0 text-xs">
                            {formatPrice(item.price * item.qty)}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Breakdown */}
                    <div className="space-y-2 text-xs pt-3 border-t border-border">
                      <div className="flex justify-between text-muted-foreground">
                        <span>Items Subtotal</span>
                        <span className="font-semibold text-foreground">
                          {formatPrice(subtotal)}
                        </span>
                      </div>
                      {discountAmount > 0 && (
                        <div className="flex justify-between text-emerald-700 font-bold">
                          <span>
                            Discount {discountType === "percentage" ? `(${discountValue}%)` : ""}
                          </span>
                          <span>−{formatPrice(discountAmount)}</span>
                        </div>
                      )}
                      <div className="flex items-baseline justify-between border-t border-border pt-3 text-base">
                        <span className="font-bold text-foreground">Total Payable</span>
                        <span className="font-black text-2xl text-primary">
                          {formatPrice(total)}
                        </span>
                      </div>
                    </div>

                    {/* Printer Output Target Selector */}
                    <div className="space-y-2 pt-2 border-t border-border/80">
                      <div className="flex items-center justify-between text-xs font-bold text-foreground">
                        <span>Automatic Printer Target</span>
                        <span className="text-[10px] text-muted-foreground font-normal">
                          {printFormat === "a4" ? "📄 A4 Laser / Desktop" : "🧾 80mm Thermal Slip"}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setPrintFormat("thermal")}
                          className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                            printFormat === "thermal"
                              ? "bg-primary text-primary-foreground border-primary shadow-2xs ring-2 ring-primary/20"
                              : "bg-muted/40 text-muted-foreground border-border hover:bg-muted hover:text-foreground"
                          }`}
                        >
                          <Receipt className="size-3.5" />
                          <span>Thermal Slip (80mm)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPrintFormat("a4")}
                          className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                            printFormat === "a4"
                              ? "bg-primary text-primary-foreground border-primary shadow-2xs ring-2 ring-primary/20"
                              : "bg-muted/40 text-muted-foreground border-border hover:bg-muted hover:text-foreground"
                          }`}
                        >
                          <ReceiptText className="size-3.5" />
                          <span>A4 Tax Invoice</span>
                        </button>
                      </div>
                    </div>

                    {/* Action Button */}
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
                      disabled={
                        placeSale.isPending || createCustomer.isPending || cart.length === 0
                      }
                      className="w-full rounded-xl bg-primary py-4 text-sm font-bold text-primary-foreground shadow-premium-sm hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {placeSale.isPending || createCustomer.isPending ? (
                        <>
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          <span>Processing Sale &amp; Printing…</span>
                        </>
                      ) : (
                        <>
                          <Check className="size-5" />
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
                  onClick={() => setIsA4InvoiceOpen(true)}
                  className="w-full rounded-xl border-2 border-[#8B2020] text-[#8B2020] bg-card py-3 text-sm font-bold shadow-sm hover:bg-[#8B2020]/5 transition-all flex items-center justify-center gap-2"
                >
                  <ReceiptText className="size-4" />
                  Print A4 Invoice
                </button>
                <button
                  onClick={() => setShowLabels(true)}
                  className="w-full rounded-xl border border-border bg-card py-3 text-sm font-bold text-muted-foreground shadow-sm hover:bg-muted transition-all flex items-center justify-center gap-2"
                >
                  <Package className="size-4" />
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

      {/* Thermal Receipt Modal */}
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
            // Pass duplicate flag so autoPrint is correctly guarded
            duplicate: saleResult.duplicate,
          }}
          items={
            saleItems.length > 0
              ? saleItems
              : cart.map((c) => ({
                  name: c.name,
                  sku: c.sku,
                  price: c.price,
                  mrp: c.mrp,
                  qty: c.qty,
                }))
          }
          autoPrint={true}
          onClose={() => {
            setIsReceiptModalOpen(false);
            resetPOS();
          }}
        />
      )}

      {/* A4 Invoice Modal */}
      {isA4InvoiceOpen && saleResult && (
        <A4Invoice
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
          }}
          items={
            saleItems.length > 0
              ? saleItems
              : cart.map((c) => ({
                  name: c.name,
                  sku: c.sku,
                  price: c.price,
                  mrp: c.mrp,
                  qty: c.qty,
                }))
          }
          autoPrint={true}
          onClose={() => {
            setIsA4InvoiceOpen(false);
            resetPOS();
          }}
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
            salesChannel: item.sales_channel || "ONLINE_AND_OFFLINE",
            sales_channel: item.sales_channel || "ONLINE_AND_OFFLINE",
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
            variants: [],
          }))}
          onClose={() => setShowLabels(false)}
        />
      )}
      {/* ====== Product Detail Drawer ====== */}
      {selectedPOSItem &&
        createPortal(
          <div className="fixed inset-0 z-[200] flex" onClick={() => setSelectedPOSItem(null)}>
            {/* Backdrop */}
            <div className="flex-1 bg-black/40 backdrop-blur-xs animate-in fade-in duration-200" />

            {/* Drawer Panel */}
            <div
              className="w-full max-w-sm bg-card h-full overflow-y-auto shadow-2xl border-l border-border animate-in slide-in-from-right duration-250 flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30 shrink-0">
                <div>
                  <h3 className="font-display text-sm font-bold text-foreground">
                    Product Details
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">POS Item Preview</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPOSItem(null)}
                  className="grid size-8 place-items-center rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Product Image */}
              <div className="relative bg-muted/20 p-6 flex items-center justify-center shrink-0 border-b border-border">
                <img
                  src={imageFor(selectedPOSItem.category || "clothing", selectedPOSItem.image_url)}
                  alt={selectedPOSItem.name}
                  className="w-48 h-48 object-contain rounded-2xl border border-border bg-white shadow-sm"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = clothing;
                  }}
                />
                {selectedPOSItem.isCustom && (
                  <span className="absolute top-3 right-3 text-[10px] font-bold bg-amber-500 text-white px-2 py-0.5 rounded-full">
                    Custom Price
                  </span>
                )}
                {selectedPOSItem.mrp > selectedPOSItem.price && (
                  <span className="absolute bottom-3 left-3 text-[10px] font-bold bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
                    {Math.round(
                      ((selectedPOSItem.mrp - selectedPOSItem.price) / selectedPOSItem.mrp) * 100,
                    )}
                    % OFF
                  </span>
                )}
              </div>

              {/* Product Info */}
              <div className="flex-1 p-5 space-y-4">
                {/* Name & Brand */}
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                    {selectedPOSItem.brand || "Brand"}
                  </p>
                  <h2 className="mt-1 font-display text-base font-bold text-foreground leading-snug">
                    {selectedPOSItem.name}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    {selectedPOSItem.category}
                    {selectedPOSItem.age_group && ` • ${selectedPOSItem.age_group}`}
                  </p>
                </div>

                {/* Sales Channel Status Card */}
                <div className="rounded-2xl border border-border bg-muted/20 p-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-xl shrink-0">
                      {selectedPOSItem.sales_channel === "OFFLINE_ONLY" ? "🏪" : "🌐"}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-foreground truncate">
                        {selectedPOSItem.sales_channel === "OFFLINE_ONLY"
                          ? "Physical Store Exclusive"
                          : "Omnichannel Product"}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {selectedPOSItem.sales_channel === "OFFLINE_ONLY"
                          ? "Offline counter sale only"
                          : "Sold on website & POS"}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${
                      selectedPOSItem.sales_channel === "OFFLINE_ONLY"
                        ? "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30"
                        : "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30"
                    }`}
                  >
                    {selectedPOSItem.sales_channel === "OFFLINE_ONLY"
                      ? "Offline Only"
                      : "Online + Store"}
                  </span>
                </div>

                {/* Pricing */}
                <div className="rounded-2xl border border-border bg-muted/20 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Selling Price</span>
                    <span className="text-lg font-black text-primary">
                      {formatPrice(selectedPOSItem.price)}
                    </span>
                  </div>
                  {selectedPOSItem.mrp > selectedPOSItem.price && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">MRP</span>
                        <span className="text-sm line-through text-muted-foreground">
                          {formatPrice(selectedPOSItem.mrp)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-emerald-700">You Save</span>
                        <span className="text-sm font-bold text-emerald-600">
                          {formatPrice(selectedPOSItem.mrp - selectedPOSItem.price)} per unit
                        </span>
                      </div>
                    </>
                  )}
                  <div className="flex items-center justify-between border-t border-border/60 pt-2">
                    <span className="text-xs font-bold text-foreground">Cart Total</span>
                    <span className="text-base font-black text-foreground">
                      {formatPrice(selectedPOSItem.price * selectedPOSItem.qty)}
                    </span>
                  </div>
                </div>

                {/* Identifiers */}
                <div className="rounded-2xl border border-border bg-muted/10 p-4 space-y-3 text-xs">
                  <p className="font-bold text-foreground text-[11px] uppercase tracking-wider">
                    Identifiers
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-muted-foreground block text-[10px] uppercase tracking-wider font-semibold">
                        SKU
                      </span>
                      <span className="font-mono font-bold text-foreground">
                        {selectedPOSItem.sku || "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[10px] uppercase tracking-wider font-semibold">
                        Barcode
                      </span>
                      <span className="font-mono font-bold text-foreground truncate block">
                        {selectedPOSItem.barcode || "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[10px] uppercase tracking-wider font-semibold">
                        Stock
                      </span>
                      <span
                        className={`font-bold ${selectedPOSItem.stock <= 5 ? "text-amber-600" : "text-emerald-600"}`}
                      >
                        {selectedPOSItem.stock} units
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[10px] uppercase tracking-wider font-semibold">
                        In Cart
                      </span>
                      <span className="font-bold text-primary">{selectedPOSItem.qty} × added</span>
                    </div>
                  </div>
                </div>

                {/* Quick Quantity Controls */}
                <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-primary mb-3">
                    Quick Adjust Qty
                  </p>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center rounded-xl border border-border bg-background overflow-hidden shadow-2xs">
                      <button
                        type="button"
                        onClick={() => {
                          updateQty(selectedPOSItem.product_id, selectedPOSItem.qty - 1);
                          setSelectedPOSItem((prev) =>
                            prev ? { ...prev, qty: Math.max(1, prev.qty - 1) } : prev,
                          );
                        }}
                        className="px-3 py-2 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      >
                        <Minus className="size-4" />
                      </button>
                      <span className="w-10 text-center text-sm font-black text-foreground">
                        {selectedPOSItem.qty}
                      </span>
                      <button
                        type="button"
                        disabled={selectedPOSItem.qty >= selectedPOSItem.stock}
                        onClick={() => {
                          updateQty(selectedPOSItem.product_id, selectedPOSItem.qty + 1);
                          setSelectedPOSItem((prev) =>
                            prev && prev.qty < prev.stock ? { ...prev, qty: prev.qty + 1 } : prev,
                          );
                        }}
                        className="px-3 py-2 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                      >
                        <Plus className="size-4" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        removeFromCart(selectedPOSItem.product_id);
                        setSelectedPOSItem(null);
                        toast.success(`"${selectedPOSItem.name}" removed from cart`);
                      }}
                      className="flex items-center gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-bold text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                    >
                      <Trash2 className="size-3.5" />
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
