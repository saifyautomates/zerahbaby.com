/**
 * POSReturnsTab — Production-grade Offline POS Returns & Exchange System.
 *
 * Capabilities:
 * - Search past orders / customer purchases by Customer Name, Phone, or Receipt #
 * - 1-Click item selection for return directly from past purchase histories
 * - Global hardware barcode scanner integration with audio tones
 * - Return Cart with unit return value & line total calculations
 * - Exchange-First Policy: Default settlement as "Exchange Credit Voucher" (Store Credit)
 * - Restocks inventory atomically (+stock)
 * - Generates and prints 80mm thermal Exchange Credit Vouchers & A4 slips
 * - Return History view with search, inspection, and re-printing
 */
import React, { useState, useRef, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  RotateCcw,
  Scan,
  Search,
  Plus,
  Minus,
  Trash2,
  Package,
  User,
  Check,
  AlertTriangle,
  Printer,
  Banknote,
  Smartphone,
  CreditCard,
  ChevronRight,
  ChevronDown,
  X,
  History,
  FileText,
  Calendar,
  Sparkles,
  ShoppingBag,
  Tag,
  Receipt,
  Phone,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { mapProduct, formatPrice, imageFor, type Product } from "@/lib/store";
import { playScanSuccess, playScanError } from "@/lib/audio";
import { useGlobalBarcodeScanner } from "@/lib/barcode-scanner";
import { generateIdempotencyKey, useSearchPOSCustomers, useCreatePOSCustomer } from "@/lib/pos";
import {
  type ReturnCartItem,
  type OfflineReturn,
  type ProcessReturnInput,
  RETURN_REASONS,
  lookupProductForReturn,
  useProcessOfflineReturn,
  useOfflineReturnsList,
} from "@/lib/pos-returns";
import { POSReturnReceipt, type ReturnReceiptData } from "@/components/admin/POSReturnReceipt";
import clothing from "@/assets/cat-clothing.jpg";

type ReturnView = "process" | "history";

type SaleItemRecord = {
  id: string;
  name: string;
  sku: string;
  price: number;
  qty: number;
  subtotal: number;
  product_id?: string | null;
  product_slug?: string;
  variant_info?: string;
  mrp_snapshot?: number;
  barcode_snapshot?: string;
};

type OfflineSaleLookupRecord = {
  id: string;
  sale_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_id: string | null;
  payment_method: string;
  total: number;
  subtotal: number;
  created_at: string;
  status: string;
  pos_token_number?: number | null;
  offline_sale_items?: SaleItemRecord[];
};

export function POSReturnsTab() {
  const qc = useQueryClient();
  const [view, setView] = useState<ReturnView>("process");

  // Cart & Scan State
  const [returnCart, setReturnCart] = useState<ReturnCartItem[]>([]);
  const [scanInput, setScanInput] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const scanInputRef = useRef<HTMLInputElement>(null);

  // Customer & Past Order Search Query
  const [pastOrderSearch, setPastOrderSearch] = useState("");
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);

  // Return Details State (Default to Exchange Credit Voucher per store policy)
  const [returnReason, setReturnReason] = useState<string>(RETURN_REASONS[0]);
  const [returnNotes, setReturnNotes] = useState("");
  const [refundMethod, setRefundMethod] = useState<string>("exchange_credit");

  // Customer State
  const [customerMode, setCustomerMode] = useState<"walkin" | "existing" | "new">("walkin");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerSearchQuery, setCustomerSearchQuery] = useState("");

  // Confirmation & Receipt State
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(generateIdempotencyKey());
  const [activeReceipt, setActiveReceipt] = useState<ReturnReceiptData | null>(null);
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);

  // History Detail Modal
  const [selectedHistoryReturn, setSelectedHistoryReturn] = useState<OfflineReturn | null>(null);
  const [historySearch, setHistorySearch] = useState("");

  // Queries
  const { data: allProducts = [] } = useQuery({
    queryKey: ["admin-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*, product_images(public_url, is_primary, sort_order)")
        .eq("is_active", true);
      if (error) throw error;
      return (data as never[]).map((r) => mapProduct(r as never));
    },
  });

  // Query past offline sales for customer lookup
  const { data: pastSales = [] } = useQuery({
    queryKey: ["offline-sales-for-returns-history-lookup"],
    queryFn: async (): Promise<OfflineSaleLookupRecord[]> => {
      const { data, error } = await supabase
        .from("offline_sales")
        .select("*, offline_sale_items(*)")
        .order("created_at", { ascending: false });
      if (error) return [];
      return (data ?? []) as unknown as OfflineSaleLookupRecord[];
    },
    staleTime: 10_000,
  });

  const searchCustomers = useSearchPOSCustomers();
  const createCustomer = useCreatePOSCustomer();
  const processReturnMutation = useProcessOfflineReturn();
  const { data: returnsList = [], isLoading: isHistoryLoading } = useOfflineReturnsList();

  // Filter past sales based on search query (name, phone, receipt number, SKU) or show recent sales by default
  const matchedPastSales = useMemo(() => {
    const q = pastOrderSearch.trim().toLowerCase();
    if (!q) {
      return pastSales.filter((s) => s.status !== "cancelled").slice(0, 5);
    }
    return pastSales
      .filter((s) => {
        if (s.status === "cancelled") return false;
        const nameMatch = (s.customer_name || "").toLowerCase().includes(q);
        const phoneMatch = (s.customer_phone || "").toLowerCase().includes(q);
        const saleNumMatch = (s.sale_number || "").toLowerCase().includes(q);
        const tokenMatch = s.pos_token_number != null && String(s.pos_token_number).includes(q);
        const itemMatch = (s.offline_sale_items ?? []).some(
          (item) =>
            (item.name || "").toLowerCase().includes(q) ||
            (item.sku || "").toLowerCase().includes(q),
        );
        return nameMatch || phoneMatch || saleNumMatch || tokenMatch || itemMatch;
      })
      .slice(0, 15);
  }, [pastSales, pastOrderSearch]);

  // Handle Adding Item by Barcode or Lookup
  const handleBarcodeLookupAndAdd = useCallback(async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;

    setIsScanning(true);
    try {
      const result = await lookupProductForReturn(trimmed);
      if (!result.found || !result.product_id) {
        playScanError();
        toast.error(result.error || `Barcode '${trimmed}' not found in catalog`);
        return;
      }

      playScanSuccess();

      // Increment if existing in cart
      setReturnCart((prev) => {
        const existingIdx = prev.findIndex(
          (i) => i.product_id === result.product_id || (i.barcode && i.barcode === result.barcode),
        );

        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = {
            ...updated[existingIdx],
            qty: updated[existingIdx].qty + 1,
          };
          toast.success(`Incremented '${result.name}' (Qty: ${updated[existingIdx].qty})`);
          return updated;
        }

        // Add new row to return cart
        const newItem: ReturnCartItem = {
          product_id: result.product_id ?? null,
          product_slug: result.product_slug || "",
          name: result.name || "Product",
          sku: result.sku || "",
          barcode: result.barcode || trimmed,
          image_url: result.image_url || null,
          current_price: result.current_price || 0,
          recent_sold_price: result.recent_sold_price,
          refund_price: result.recent_sold_price ?? result.current_price ?? 0,
          mrp: result.mrp || result.current_price || 0,
          current_stock: result.stock || 0,
          variant_info: result.variant_info || "",
          qty: 1,
        };

        toast.success(`Added '${result.name}' to Return Cart`);
        return [newItem, ...prev];
      });

      setScanInput("");
    } catch (err: unknown) {
      playScanError();
      toast.error((err as Error).message || "Error resolving barcode for return");
    } finally {
      setIsScanning(false);
    }
  }, []);

  // Hook up Hardware Global Barcode Scanner
  useGlobalBarcodeScanner((scannedCode) => {
    if (view === "process" && !isConfirmModalOpen && !isReceiptOpen) {
      handleBarcodeLookupAndAdd(scannedCode);
    }
  });

  // Handle adding an item directly from past sale history
  const handleAddPastSaleItemToReturnCart = (
    sale: OfflineSaleLookupRecord,
    item: SaleItemRecord,
  ) => {
    playScanSuccess();

    const matchedProd = allProducts.find(
      (p) =>
        p.id === item.product_id ||
        (p.sku && p.sku.toLowerCase() === item.sku?.toLowerCase()) ||
        p.name.toLowerCase() === item.name?.toLowerCase(),
    );

    const resolvedImage =
      matchedProd?.imageUrl ||
      matchedProd?.image ||
      imageFor(matchedProd?.category || "clothing", undefined);

    setReturnCart((prev) => {
      const existingIdx = prev.findIndex(
        (i) =>
          (item.product_id && i.product_id === item.product_id) ||
          (item.sku && i.sku.toLowerCase() === item.sku.toLowerCase()),
      );

      if (existingIdx >= 0) {
        const updated = [...prev];
        const newQty = updated[existingIdx].qty + 1;
        updated[existingIdx] = {
          ...updated[existingIdx],
          qty: newQty,
        };
        toast.success(`Incremented '${item.name}' (Qty: ${newQty})`);
        return updated;
      }

      const newItem: ReturnCartItem = {
        product_id: item.product_id || matchedProd?.id || null,
        product_slug: item.product_slug || matchedProd?.id || "",
        name: item.name,
        sku: item.sku || matchedProd?.sku || "",
        barcode: item.barcode_snapshot || matchedProd?.barcode || item.sku || "",
        image_url: resolvedImage,
        current_price: matchedProd?.price || item.price,
        recent_sold_price: item.price,
        refund_price: item.price,
        mrp: item.mrp_snapshot || matchedProd?.mrp || item.price,
        current_stock: matchedProd?.stock || 0,
        variant_info: item.variant_info || "",
        qty: 1,
      };

      toast.success(`Selected '${item.name}' for Return (₹${item.price})`);
      return [newItem, ...prev];
    });

    // Auto-fill customer association
    if (sale.customer_name && sale.customer_name !== "Walk-in Customer") {
      setCustomerMode("existing");
      setCustomerName(sale.customer_name);
      setCustomerPhone(sale.customer_phone || "");
      setCustomerEmail(sale.customer_email || "");
      setCustomerId(sale.customer_id || null);
    } else if (sale.customer_phone) {
      setCustomerMode("existing");
      setCustomerName(`Customer (${sale.customer_phone})`);
      setCustomerPhone(sale.customer_phone);
    }
  };

  // Quantity modification
  const handleUpdateQty = (idx: number, delta: number) => {
    setReturnCart((prev) => {
      const updated = [...prev];
      const newQty = updated[idx].qty + delta;
      if (newQty <= 0) return prev;
      updated[idx] = { ...updated[idx], qty: newQty };
      return updated;
    });
  };

  const handleUpdateRefundPrice = (idx: number, price: number) => {
    setReturnCart((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], refund_price: Math.max(0, price) };
      return updated;
    });
  };

  const handleRemoveItem = (idx: number) => {
    setReturnCart((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleClearCart = () => {
    setReturnCart([]);
    setIdempotencyKey(generateIdempotencyKey());
  };

  // Cart Calculations
  const totalReturnUnits = useMemo(
    () => returnCart.reduce((sum, item) => sum + (item.qty || 1), 0),
    [returnCart],
  );

  const totalRefundAmount = useMemo(
    () => returnCart.reduce((sum, item) => sum + item.refund_price * item.qty, 0),
    [returnCart],
  );

  // Filter products for manual search
  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return [];
    const q = productSearch.toLowerCase();
    return allProducts
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.barcode && p.barcode.toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [allProducts, productSearch]);

  // Submit Return Execution
  const handleConfirmReturn = async () => {
    if (returnCart.length === 0) {
      toast.error("Return cart is empty");
      return;
    }

    try {
      const resolvedCustomerName =
        customerMode === "walkin" ? "Walk-in Customer" : customerName.trim() || "Walk-in Customer";

      const payload: ProcessReturnInput = {
        customer_name: resolvedCustomerName,
        customer_phone: customerPhone.trim(),
        customer_email: customerEmail.trim(),
        customer_id: customerId,
        refund_method: refundMethod,
        refund_status: "completed",
        return_reason: returnReason,
        notes: returnNotes.trim(),
        items: returnCart.map((item) => ({
          product_id: item.product_id,
          product_slug: item.product_slug,
          name: item.name,
          sku: item.sku,
          barcode: item.barcode,
          variant_info: item.variant_info,
          refund_price: item.refund_price,
          qty: item.qty,
          mrp: item.mrp,
        })),
        idempotency_key: "",
      };

      const result = await processReturnMutation.mutateAsync(payload);

      // Create Receipt Data
      const receiptData: ReturnReceiptData = {
        return_number: result.return_number,
        customer_name: resolvedCustomerName,
        customer_phone: customerPhone.trim(),
        refund_amount: result.refund_amount,
        refund_method: refundMethod,
        return_reason: returnReason,
        notes: returnNotes.trim(),
        created_at: new Date().toISOString(),
        items: returnCart.map((item) => ({
          name: item.name,
          sku: item.sku,
          barcode: item.barcode,
          variant_info: item.variant_info,
          refund_price: item.refund_price,
          qty: item.qty,
          subtotal: item.refund_price * item.qty,
        })),
      };

      setActiveReceipt(receiptData);
      setIsReceiptOpen(true);
      setIsConfirmModalOpen(false);
      handleClearCart();
      toast.success(
        refundMethod === "exchange_credit"
          ? `Exchange Credit Voucher #${result.return_number} issued!`
          : `Return #${result.return_number} processed! Inventory restocked.`,
      );
    } catch (err: unknown) {
      toast.error((err as Error).message || "Failed to process offline return");
    }
  };

  // Filtered Returns History
  const filteredHistory = useMemo(() => {
    if (!historySearch.trim()) return returnsList;
    const q = historySearch.toLowerCase();
    return returnsList.filter(
      (r) =>
        r.return_number.toLowerCase().includes(q) ||
        r.customer_name.toLowerCase().includes(q) ||
        r.customer_phone.includes(q) ||
        r.refund_method.toLowerCase().includes(q) ||
        r.return_reason.toLowerCase().includes(q),
    );
  }, [returnsList, historySearch]);

  return (
    <div className="flex flex-col space-y-5">
      {/* ── Sub-Header & Navigation Tabs ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <RotateCcw className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground">
              Offline POS Returns &amp; Exchange
            </h2>
            <p className="text-xs text-muted-foreground">
              Search past customer purchases, select items for return, restock inventory, and issue
              Exchange Vouchers.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setView("process")}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition cursor-pointer ${
              view === "process"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "border border-border bg-card text-muted-foreground hover:bg-muted"
            }`}
          >
            <Scan className="h-4 w-4" />
            <span>Process Return / Exchange</span>
          </button>

          <button
            type="button"
            onClick={() => setView("history")}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition cursor-pointer ${
              view === "history"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "border border-border bg-card text-muted-foreground hover:bg-muted"
            }`}
          >
            <History className="h-4 w-4" />
            <span>Return History ({returnsList.length})</span>
          </button>
        </div>
      </div>

      {/* ── VIEW 1: PROCESS RETURN ── */}
      {view === "process" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
          {/* LEFT 7-COL: Past Order Lookup, Barcode Scanner, Cart & Items */}
          <div className="lg:col-span-7 flex flex-col space-y-4">
            {/* 1. Find Customer / Past Purchase Lookup Box */}
            <div className="rounded-2xl border border-border bg-card p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-primary" />
                  <h3 className="text-xs font-bold text-foreground">
                    Look Up Past Purchase / Customer History
                  </h3>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  Search by Customer Name, Phone, or Receipt #
                </span>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={pastOrderSearch}
                  onChange={(e) => setPastOrderSearch(e.target.value)}
                  placeholder="e.g. Jack Sparrow, 9876543210, or POS-2609-00009..."
                  className="w-full rounded-xl border border-border bg-background pl-9 pr-9 py-2 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                />
                {pastOrderSearch && (
                  <button
                    type="button"
                    onClick={() => setPastOrderSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>

              {/* Matched Past Sales List (Always visible: recent or filtered by search) */}
              <div className="space-y-2.5 mt-2 max-h-80 overflow-y-auto pr-1">
                {matchedPastSales.length === 0 ? (
                  <div className="p-4 text-center rounded-xl bg-muted/30 border border-border text-xs text-muted-foreground">
                    No past sales found for "{pastOrderSearch}". You can also scan product barcode directly below.
                  </div>
                ) : (
                  matchedPastSales.map((sale) => {
                    const isExpanded =
                      expandedSaleId === sale.id || !!pastOrderSearch.trim() || matchedPastSales.length === 1;
                    return (
                      <div
                        key={sale.id}
                        className="rounded-2xl border-2 border-border/80 bg-muted/20 overflow-hidden text-xs transition shadow-2xs"
                      >
                        {/* Receipt Summary Header with Prominent Customer Info */}
                        <div
                          onClick={() => setExpandedSaleId(isExpanded ? null : sale.id)}
                          className="p-3.5 flex flex-wrap items-center justify-between gap-2 bg-card hover:bg-muted/40 cursor-pointer border-b border-border/60"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {isExpanded ? (
                              <ChevronDown className="size-4 text-primary shrink-0" />
                            ) : (
                              <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                            )}
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="inline-flex items-center gap-1 rounded-lg bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 font-black text-xs">
                                <User className="size-3" />
                                {sale.customer_name || "Walk-in Customer"}
                              </span>
                              {sale.customer_phone && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-mono font-bold text-foreground">
                                  <Phone className="size-2.5 text-muted-foreground" />
                                  {sale.customer_phone}
                                </span>
                              )}
                              <span className="font-mono text-[11px] font-semibold text-muted-foreground">
                                #{sale.sale_number}
                              </span>
                            </div>
                          </div>

                          <div className="text-right shrink-0 flex items-center gap-3">
                            <div>
                              <span className="font-extrabold text-foreground text-sm block">
                                {formatPrice(sale.total)}
                              </span>
                              <span className="text-[10px] text-muted-foreground block">
                                {new Date(sale.created_at).toLocaleDateString("en-IN", {
                                  day: "numeric",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Items in this past sale with Exact Purchased Prices */}
                        {isExpanded && (
                          <div className="p-3.5 bg-background space-y-2.5">
                            <div className="flex items-center justify-between">
                              <p className="text-[11px] font-black text-foreground uppercase tracking-wider">
                                Purchased Items ({sale.offline_sale_items?.length || 0})
                              </p>
                              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                                Exact original prices loaded from invoice
                              </span>
                            </div>

                            <div className="divide-y divide-border/60">
                              {(sale.offline_sale_items ?? []).map((item) => (
                                <div
                                  key={item.id}
                                  className="py-2.5 flex items-center justify-between gap-3"
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="font-bold text-foreground text-xs truncate">
                                      {item.name}
                                    </p>
                                    <div className="flex flex-wrap items-center gap-2 mt-1">
                                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 text-[11px] font-extrabold text-emerald-700 dark:text-emerald-300">
                                        Purchased Price: {formatPrice(item.price)}
                                      </span>
                                      <span className="text-[11px] text-muted-foreground font-medium">
                                        Qty bought: {item.qty}
                                      </span>
                                      {item.sku && (
                                        <span className="text-[10px] text-muted-foreground font-mono">
                                          SKU: {item.sku}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => handleAddPastSaleItemToReturnCart(sale, item)}
                                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 font-bold text-xs transition cursor-pointer shadow-xs shrink-0"
                                  >
                                    <Plus className="size-3.5" />
                                    <span>Select for Return ({formatPrice(item.price)})</span>
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* 2. Barcode Scanner Input Box */}
            <div className="rounded-2xl border-2 border-dashed border-primary/40 bg-card p-4 shadow-xs">
              <div className="flex flex-col sm:flex-row items-center gap-3">
                <div className="relative flex-1 w-full">
                  <Scan className="absolute left-3 top-3 h-4 w-4 text-primary animate-pulse" />
                  <input
                    ref={scanInputRef}
                    type="text"
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleBarcodeLookupAndAdd(scanInput);
                      }
                    }}
                    placeholder="Scan barcode gun or enter SKU / Barcode..."
                    className="w-full rounded-xl border border-border bg-background pl-9 pr-4 py-2 text-xs font-medium text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => handleBarcodeLookupAndAdd(scanInput)}
                  disabled={isScanning || !scanInput.trim()}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition shadow-xs cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  <span>Add Product</span>
                </button>
              </div>

              {/* Manual Product Search Fallback */}
              <div className="mt-3 pt-3 border-t border-border/60">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Search product catalog manually..."
                    className="w-full rounded-lg border border-border bg-muted/30 pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:bg-background outline-none transition"
                  />
                </div>

                {filteredProducts.length > 0 && (
                  <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-border bg-popover divide-y divide-border shadow-lg">
                    {filteredProducts.map((p) => (
                      <div
                        key={p.uuid || p.id}
                        onClick={() => {
                          handleBarcodeLookupAndAdd(p.barcode || p.sku || p.id);
                          setProductSearch("");
                        }}
                        className="flex items-center justify-between p-2 hover:bg-muted cursor-pointer transition text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {p.imageUrl || p.image ? (
                            <img
                              src={p.imageUrl || p.image}
                              alt={p.name}
                              loading="lazy"
                              decoding="async"
                              className="h-8 w-8 rounded-lg object-cover"
                            />
                          ) : (
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                              <Package className="h-4 w-4" />
                            </div>
                          )}
                          <div className="truncate">
                            <p className="font-semibold text-foreground truncate">{p.name}</p>
                            <p className="text-[10px] text-muted-foreground">
                              SKU: {p.sku} | Barcode: {p.barcode || "N/A"}
                            </p>
                          </div>
                        </div>
                        <div className="text-right shrink-0 ml-2">
                          <p className="font-bold text-foreground">{formatPrice(p.price)}</p>
                          <p className="text-[10px] text-muted-foreground">Stock: {p.stock}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 3. Return Cart Table */}
            <div className="flex-1 rounded-2xl border border-border bg-card shadow-xs flex flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-muted/20">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold text-foreground">Return Cart Items</h3>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                    {totalReturnUnits} units
                  </span>
                </div>

                {returnCart.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearCart}
                    className="text-[11px] font-semibold text-destructive hover:underline cursor-pointer"
                  >
                    Clear All
                  </button>
                )}
              </div>

              {/* Customer Banner if active */}
              {customerName && (
                <div className="bg-primary/10 border-b border-primary/20 px-4 py-2.5 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <User className="size-3.5 text-primary" />
                    <span className="font-extrabold text-foreground">Customer: {customerName}</span>
                    {customerPhone && <span className="font-mono text-muted-foreground">({customerPhone})</span>}
                  </div>
                  <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-black text-emerald-700 dark:text-emerald-300">
                    Exact Purchase Price Linked
                  </span>
                </div>
              )}

              <div className="flex-1 overflow-y-auto divide-y divide-border min-h-[160px]">
                {returnCart.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                    <ShoppingBag className="h-10 w-10 text-muted-foreground/30 mb-2" />
                    <p className="text-xs font-bold text-foreground">Return Cart is Empty</p>
                    <p className="text-[11px] max-w-xs mt-1">
                      Search customer past purchase above or scan barcodes with the gun to add items.
                    </p>
                  </div>
                ) : (
                  returnCart.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 hover:bg-muted/30 transition"
                    >
                      {/* Product details */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {item.image_url ? (
                          <img
                            src={item.image_url}
                            alt={item.name}
                            loading="lazy"
                            decoding="async"
                            className="h-10 w-10 rounded-xl object-cover shrink-0 border border-border"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = clothing;
                            }}
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground shrink-0">
                            <Package className="h-5 w-5" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-xs text-foreground truncate">{item.name}</p>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 text-[11px] font-black text-emerald-700 dark:text-emerald-300">
                              Purchased Price: {formatPrice(item.refund_price)}
                            </span>
                            {item.sku && <span className="text-[10px] text-muted-foreground font-mono">SKU: {item.sku}</span>}
                            {item.variant_info && <span className="text-[10px] text-muted-foreground">({item.variant_info})</span>}
                          </div>
                        </div>
                      </div>

                      {/* Quantity & Unit Refund Controls */}
                      <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto shrink-0">
                        {/* Qty +- */}
                        <div className="flex items-center rounded-xl border border-border bg-background p-0.5">
                          <button
                            type="button"
                            onClick={() => handleUpdateQty(idx, -1)}
                            disabled={item.qty <= 1}
                            className="flex h-6 w-6 items-center justify-center rounded-lg hover:bg-muted text-muted-foreground disabled:opacity-30 cursor-pointer"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-8 text-center text-xs font-bold text-foreground">
                            {item.qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleUpdateQty(idx, 1)}
                            className="flex h-6 w-6 items-center justify-center rounded-lg hover:bg-muted text-muted-foreground cursor-pointer"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>

                        {/* Unit Return Price input */}
                        <div className="flex flex-col items-end">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-muted-foreground">₹</span>
                            <input
                              type="number"
                              min="0"
                              value={item.refund_price}
                              onChange={(e) =>
                                handleUpdateRefundPrice(idx, parseFloat(e.target.value) || 0)
                              }
                              className="w-20 rounded-lg border border-border bg-background px-2 py-1 text-right text-xs font-bold text-foreground focus:ring-1 focus:ring-primary outline-none"
                              title="Unit Return Value"
                            />
                          </div>
                          <span className="text-[10px] font-bold text-primary mt-0.5">
                            Credit: {formatPrice(item.refund_price * item.qty)}
                          </span>
                        </div>

                        {/* Remove */}
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(idx)}
                          className="flex h-8 w-8 items-center justify-center rounded-xl text-destructive hover:bg-destructive/10 transition cursor-pointer"
                          title="Remove item"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* RIGHT 5-COL: Customer, Resolution / Exchange Method, Notes & Actions */}
          <div className="lg:col-span-5 flex flex-col space-y-4 lg:sticky lg:top-4">
            {/* Customer Association */}
            <div className="rounded-2xl border border-border bg-card p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" />
                  <h3 className="text-xs font-bold text-foreground">Customer Association</h3>
                </div>
                <div className="flex items-center gap-1 rounded-xl border border-border bg-muted/40 p-0.5 text-[10px]">
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerMode("walkin");
                      setCustomerId(null);
                    }}
                    className={`rounded-lg px-2 py-1 font-bold transition cursor-pointer ${
                      customerMode === "walkin"
                        ? "bg-card text-foreground shadow-xs"
                        : "text-muted-foreground"
                    }`}
                  >
                    Walk-in
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomerMode("existing")}
                    className={`rounded-lg px-2 py-1 font-bold transition cursor-pointer ${
                      customerMode === "existing"
                        ? "bg-card text-foreground shadow-xs"
                        : "text-muted-foreground"
                    }`}
                  >
                    Lookup
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomerMode("new")}
                    className={`rounded-lg px-2 py-1 font-bold transition cursor-pointer ${
                      customerMode === "new"
                        ? "bg-card text-foreground shadow-xs"
                        : "text-muted-foreground"
                    }`}
                  >
                    New
                  </button>
                </div>
              </div>

              {customerMode === "walkin" && (
                <p className="text-[11px] text-muted-foreground bg-muted/30 rounded-xl p-2.5">
                  Walk-in Customer selected. No profile required.
                </p>
              )}

              {customerMode === "existing" && (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={customerSearchQuery}
                    onChange={(e) => setCustomerSearchQuery(e.target.value)}
                    placeholder="Search POS customer profile by name or phone..."
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none"
                  />
                  {customerName && (
                    <div className="flex items-center justify-between rounded-xl bg-primary/10 border border-primary/20 p-2.5 text-xs text-primary">
                      <div>
                        <p className="font-bold">{customerName}</p>
                        {customerPhone && <p className="text-[10px] font-mono">{customerPhone}</p>}
                      </div>
                      <Check className="h-4 w-4" />
                    </div>
                  )}
                </div>
              )}

              {customerMode === "new" && (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Customer Name"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground outline-none"
                  />
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="Customer Phone"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground outline-none"
                  />
                </div>
              )}
            </div>

            {/* Return Settlement Method — EXCHANGE FIRST POLICY */}
            <div className="rounded-2xl border border-border bg-card p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-foreground">Settlement / Return Method</h3>
                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                  Exchange Only Policy
                </span>
              </div>

              {/* Primary Exchange Option */}
              <button
                type="button"
                onClick={() => setRefundMethod("exchange_credit")}
                className={`w-full text-left p-3.5 rounded-2xl border-2 transition-all cursor-pointer ${
                  refundMethod === "exchange_credit"
                    ? "border-emerald-600 bg-emerald-500/10 shadow-xs"
                    : "border-border bg-card hover:bg-muted/40"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`p-2 rounded-xl shrink-0 ${
                      refundMethod === "exchange_credit"
                        ? "bg-emerald-600 text-white"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <Sparkles className="size-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-sm text-foreground">Exchange Credit Voucher</p>
                      <span className="rounded-md bg-emerald-600/20 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.2 text-[9px] font-black uppercase">
                        Recommended
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Issues a store credit slip allowing customer to buy or exchange any item in
                      store.
                    </p>
                  </div>
                </div>
              </button>

              {/* Alternative payout methods (if explicitly required) */}
              <div className="pt-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Alternative Refund (Direct Payout)
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: "cash", label: "Cash", icon: Banknote },
                    { key: "upi", label: "UPI", icon: Smartphone },
                    { key: "card", label: "Card", icon: CreditCard },
                  ].map((m) => {
                    const Icon = m.icon;
                    const active = refundMethod === m.key;
                    return (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => setRefundMethod(m.key)}
                        className={`flex flex-col items-center justify-center gap-1.5 rounded-xl p-2.5 border font-semibold text-xs transition cursor-pointer ${
                          active
                            ? "border-primary bg-primary/10 text-primary shadow-xs"
                            : "border-border bg-card text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        <span>{m.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Return Reason & Notes */}
            <div className="rounded-2xl border border-border bg-card p-4 shadow-xs space-y-3">
              <h3 className="text-xs font-bold text-foreground">Return Reason &amp; Notes</h3>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                  Reason for Return / Exchange
                </label>
                <select
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                >
                  {RETURN_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                  Cashier Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  value={returnNotes}
                  onChange={(e) => setReturnNotes(e.target.value)}
                  placeholder="Notes about product condition or exchange request..."
                  className="w-full rounded-xl border border-border bg-background p-2.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary resize-none"
                />
              </div>
            </div>

            {/* Summary & Action Button */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-4">
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between text-muted-foreground">
                  <span>Customer</span>
                  <span className="font-bold text-foreground truncate max-w-[200px]">
                    {customerName || "Walk-in Customer"}
                  </span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Total Items to Restock</span>
                  <span className="font-bold text-foreground">+{totalReturnUnits} units</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Original Paid Price</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">
                    {formatPrice(totalRefundAmount)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm font-bold pt-2 border-t border-border">
                  <span className="text-foreground">
                    {refundMethod === "exchange_credit"
                      ? "Exchange Credit Value"
                      : "Total Refund Amount"}
                  </span>
                  <span className="text-xl font-black text-primary">
                    {formatPrice(totalRefundAmount)}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsConfirmModalOpen(true)}
                disabled={returnCart.length === 0 || processReturnMutation.isPending}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition shadow-xs cursor-pointer"
              >
                <Sparkles className="h-4 w-4" />
                <span>
                  {refundMethod === "exchange_credit"
                    ? `Issue Exchange Voucher (${formatPrice(totalRefundAmount)})`
                    : `Process Return (${formatPrice(totalRefundAmount)})`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── VIEW 2: RETURN HISTORY ── */}
      {view === "history" && (
        <div className="flex-1 flex flex-col rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
          {/* History Search Header */}
          <div className="p-4 border-b border-border bg-muted/20 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Search returns by voucher #, customer, or phone..."
                className="w-full rounded-xl border border-border bg-background pl-9 pr-4 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
              />
            </div>
            <span className="text-xs text-muted-foreground">
              Showing {filteredHistory.length} return / exchange records
            </span>
          </div>

          {/* History Table */}
          <div className="flex-1 overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-5 py-3.5">Voucher / Return #</th>
                  <th className="px-5 py-3.5">Customer</th>
                  <th className="px-5 py-3.5">Date (IST)</th>
                  <th className="px-5 py-3.5">Settlement Mode</th>
                  <th className="px-5 py-3.5">Reason</th>
                  <th className="px-5 py-3.5 text-right">Value</th>
                  <th className="px-5 py-3.5 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {isHistoryLoading ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-xs text-muted-foreground">
                      Loading return history…
                    </td>
                  </tr>
                ) : filteredHistory.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-xs text-muted-foreground">
                      No returns found matching search criteria.
                    </td>
                  </tr>
                ) : (
                  filteredHistory.map((ret) => (
                    <tr
                      key={ret.id}
                      className="hover:bg-muted/40 transition cursor-pointer"
                      onClick={() => setSelectedHistoryReturn(ret)}
                    >
                      <td className="px-5 py-3.5 font-mono font-bold text-foreground text-xs">
                        {ret.return_number}
                      </td>
                      <td className="px-5 py-3.5">
                        <p className="font-bold text-foreground text-xs">{ret.customer_name}</p>
                        {ret.customer_phone && (
                          <p className="text-[10px] text-muted-foreground font-mono">
                            {ret.customer_phone}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">
                        {new Date(ret.created_at).toLocaleString("en-IN")}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">
                          {ret.refund_method === "exchange_credit"
                            ? "Exchange Voucher"
                            : ret.refund_method}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-muted-foreground truncate max-w-xs">
                        {ret.return_reason}
                      </td>
                      <td className="px-5 py-3.5 text-right font-bold text-primary text-sm">
                        {formatPrice(ret.refund_amount)}
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedHistoryReturn(ret);
                          }}
                          className="flex items-center gap-1 mx-auto px-2.5 py-1 rounded-lg border border-border bg-background hover:bg-muted text-xs font-bold text-foreground transition cursor-pointer shadow-2xs"
                        >
                          <Printer className="size-3 text-primary" />
                          Reprint Slip
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {isConfirmModalOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={() => setIsConfirmModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
                <Sparkles className="size-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">
                  Confirm Return &amp; Exchange
                </h3>
                <p className="text-xs text-muted-foreground">
                  {refundMethod === "exchange_credit"
                    ? "Generate Exchange Credit Voucher and restock inventory"
                    : "Process return payout and restock inventory"}
                </p>
              </div>
            </div>

            <div className="rounded-2xl bg-muted/40 border border-border p-4 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Customer:</span>
                <span className="font-bold text-foreground">
                  {customerMode === "walkin" ? "Walk-in Customer" : customerName || "Walk-in"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Units to Restock:</span>
                <span className="font-bold text-foreground">+{totalReturnUnits} units</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Settlement:</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400 uppercase">
                  {refundMethod === "exchange_credit" ? "Exchange Credit Voucher" : refundMethod}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t border-border text-sm font-bold">
                <span className="text-foreground">Total Credit Value:</span>
                <span className="text-primary font-black text-base">
                  {formatPrice(totalRefundAmount)}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsConfirmModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-border bg-background text-xs font-bold text-muted-foreground hover:bg-muted transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReturn}
                disabled={processReturnMutation.isPending}
                className="px-5 py-2 rounded-xl bg-primary text-xs font-bold text-primary-foreground hover:bg-primary/90 transition shadow-xs cursor-pointer flex items-center gap-1.5"
              >
                {processReturnMutation.isPending ? (
                  "Processing…"
                ) : (
                  <>
                    <Check className="size-4" />
                    Confirm &amp; Print Voucher
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Return & Exchange Voucher Receipt Modal */}
      {isReceiptOpen && activeReceipt && (
        <POSReturnReceipt
          returnData={activeReceipt}
          onClose={() => {
            setIsReceiptOpen(false);
            setActiveReceipt(null);
          }}
          autoPrint={true}
        />
      )}

      {/* History Reprint Receipt Modal */}
      {selectedHistoryReturn && (
        <POSReturnReceipt
          returnData={{
            return_number: selectedHistoryReturn.return_number,
            customer_name: selectedHistoryReturn.customer_name,
            customer_phone: selectedHistoryReturn.customer_phone,
            refund_amount: selectedHistoryReturn.refund_amount,
            refund_method: selectedHistoryReturn.refund_method,
            return_reason: selectedHistoryReturn.return_reason,
            notes: selectedHistoryReturn.notes,
            created_at: selectedHistoryReturn.created_at,
            items: (selectedHistoryReturn.offline_return_items ?? []).map((i) => ({
              name: i.name,
              sku: i.sku,
              barcode: i.barcode,
              variant_info: i.variant_info,
              refund_price: i.refund_price,
              qty: i.qty,
              subtotal: i.subtotal,
            })),
          }}
          onClose={() => setSelectedHistoryReturn(null)}
        />
      )}
    </div>
  );
}
