/**
 * POSReturnsTab — Production-grade Offline POS Returns System.
 *
 * Capabilities:
 * - Global hardware barcode scanner integration with audio tones
 * - Manual barcode / SKU / product search
 * - Return Cart with unit refund & line total calculations
 * - Historical sold price resolution with current price fallback
 * - Return reason & optional cashier notes
 * - Refund methods: Cash, UPI, Card
 * - Customer association (Walk-in or POS Customer)
 * - Atomic database transaction with inventory restock (+stock)
 * - Double-submit & duplicate return prevention
 * - 80mm thermal return receipt printing
 * - Background owner email notification
 * - Return History view with search, inspection, and re-print
 */
import { useState, useRef, useCallback, useMemo } from "react";
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
  X,
  UserPlus,
  History,
  FileText,
  ArrowLeft,
  Calendar,
  Send,
  Eye,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { mapProduct, formatPrice, type Product } from "@/lib/store";
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

type ReturnView = "process" | "history";

export function POSReturnsTab() {
  const qc = useQueryClient();
  const [view, setView] = useState<ReturnView>("process");

  // Cart & Scan State
  const [returnCart, setReturnCart] = useState<ReturnCartItem[]>([]);
  const [scanInput, setScanInput] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const scanInputRef = useRef<HTMLInputElement>(null);

  // Return Details State
  const [returnReason, setReturnReason] = useState<string>(RETURN_REASONS[0]);
  const [returnNotes, setReturnNotes] = useState("");
  const [refundMethod, setRefundMethod] = useState<string>("cash");

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
      const { data, error } = await supabase.from("products").select("*").eq("is_active", true);
      if (error) throw error;
      return (data as never[]).map((r) => mapProduct(r as never));
    },
  });

  const searchCustomers = useSearchPOSCustomers();
  const createCustomer = useCreatePOSCustomer();
  const processReturnMutation = useProcessOfflineReturn();
  const { data: returnsList = [], isLoading: isHistoryLoading } = useOfflineReturnsList();

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
    // Only intercept when in process view
    if (view === "process" && !isConfirmModalOpen && !isReceiptOpen) {
      handleBarcodeLookupAndAdd(scannedCode);
    }
  });

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
        idempotency_key: idempotencyKey,
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
      toast.success(`Return #${result.return_number} processed! Inventory restocked.`);
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
    <div className="flex flex-col h-full space-y-4">
      {/* ── Sub-Header & Navigation Tabs ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400">
            <RotateCcw className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground">Offline POS Returns</h2>
            <p className="text-xs text-muted-foreground">
              Scan barcode gun to accept customer returns, restock inventory, and issue refunds.
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
            <span>Process Return</span>
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
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 flex-1 overflow-hidden">
          {/* LEFT 7-COL: Scanner, Cart & Items */}
          <div className="lg:col-span-7 flex flex-col space-y-4 overflow-hidden">
            {/* Barcode Scanner Input Box */}
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
                    placeholder="Search product name manually..."
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

            {/* Return Cart Table */}
            <div className="flex-1 rounded-2xl border border-border bg-card shadow-xs flex flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-muted/20">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold text-foreground">Return Cart</h3>
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

              <div className="flex-1 overflow-y-auto divide-y divide-border">
                {returnCart.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                    <Scan className="h-10 w-10 text-muted-foreground/40 mb-2" />
                    <p className="text-xs font-bold text-foreground">Return Cart is Empty</p>
                    <p className="text-[11px] max-w-xs mt-1">
                      Scan product barcodes using the scanner gun to start the return workflow.
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
                            className="h-10 w-10 rounded-xl object-cover shrink-0 border border-border"
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground shrink-0">
                            <Package className="h-5 w-5" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-xs text-foreground truncate">{item.name}</p>
                          <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                            {item.sku && <span>SKU: {item.sku}</span>}
                            {item.barcode && <span>Barcode: {item.barcode}</span>}
                            {item.variant_info && <span>({item.variant_info})</span>}
                          </div>
                          {item.recent_sold_price != null && (
                            <p className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 mt-0.5">
                              Historical sold price detected: {formatPrice(item.recent_sold_price)}
                            </p>
                          )}
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

                        {/* Unit Refund Price input */}
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
                              title="Unit Refund Price"
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground mt-0.5">
                            Total: {formatPrice(item.refund_price * item.qty)}
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

          {/* RIGHT 5-COL: Return Reason, Customer, Refund Method & Actions */}
          <div className="lg:col-span-5 flex flex-col space-y-4 overflow-y-auto pr-1">
            {/* Customer Association */}
            <div className="rounded-2xl border border-border bg-card p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
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
                    Search
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
                  Walk-in Customer selected. No customer lookup required for direct barcode return.
                </p>
              )}

              {customerMode === "existing" && (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={customerSearchQuery}
                    onChange={(e) => setCustomerSearchQuery(e.target.value)}
                    placeholder="Search POS customer by name or phone..."
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none"
                  />
                  {customerName && (
                    <div className="flex items-center justify-between rounded-xl bg-primary/10 border border-primary/20 p-2.5 text-xs text-primary">
                      <div>
                        <p className="font-bold">{customerName}</p>
                        {customerPhone && <p className="text-[10px]">{customerPhone}</p>}
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

            {/* Return Reason & Notes */}
            <div className="rounded-2xl border border-border bg-card p-4 shadow-xs space-y-3">
              <h3 className="text-xs font-bold text-foreground">Return Reason &amp; Notes</h3>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                  Reason for Return
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
                  placeholder="Additional notes about product condition or reason..."
                  className="w-full rounded-xl border border-border bg-background p-2.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary resize-none"
                />
              </div>
            </div>

            {/* Refund Method */}
            <div className="rounded-2xl border border-border bg-card p-4 shadow-xs space-y-3">
              <h3 className="text-xs font-bold text-foreground">Refund Method</h3>
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
                      className={`flex flex-col items-center justify-center gap-1.5 rounded-xl p-3 border font-semibold text-xs transition cursor-pointer ${
                        active
                          ? "border-primary bg-primary/10 text-primary shadow-xs"
                          : "border-border bg-card text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      <span>{m.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Refund Summary & Action Button */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-4">
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between text-muted-foreground">
                  <span>Total Items to Return</span>
                  <span className="font-bold text-foreground">+{totalReturnUnits} units</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Refund Method</span>
                  <span className="font-bold uppercase text-foreground">{refundMethod}</span>
                </div>
                <div className="flex justify-between items-baseline pt-2 border-t border-border">
                  <span className="text-sm font-extrabold text-foreground">TOTAL REFUND</span>
                  <span className="text-xl font-black text-rose-600 dark:text-rose-400">
                    {formatPrice(totalRefundAmount)}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsConfirmModalOpen(true)}
                disabled={returnCart.length === 0}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-rose-600 to-rose-700 p-3.5 text-sm font-bold text-white shadow-md hover:from-rose-700 hover:to-rose-800 disabled:opacity-40 transition cursor-pointer"
              >
                <RotateCcw className="h-4 w-4" />
                <span>Confirm Return ({formatPrice(totalRefundAmount)})</span>
              </button>

              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground justify-center">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                <span>Inventory will be automatically restocked upon confirmation.</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── VIEW 2: RETURN HISTORY ── */}
      {view === "history" && (
        <div className="flex-1 rounded-2xl border border-border bg-card shadow-xs flex flex-col overflow-hidden">
          {/* Filter / Search Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-border bg-muted/20">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Search returns by number, customer, or phone..."
                className="w-full rounded-xl border border-border bg-background pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Showing <span className="font-bold text-foreground">{filteredHistory.length}</span>{" "}
              returns
            </p>
          </div>

          {/* Returns Table */}
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground font-semibold bg-muted/10">
                  <th className="p-3">Return #</th>
                  <th className="p-3">Date</th>
                  <th className="p-3">Customer</th>
                  <th className="p-3">Reason</th>
                  <th className="p-3">Refund Amount</th>
                  <th className="p-3">Method</th>
                  <th className="p-3">Email Alert</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isHistoryLoading ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">
                      Loading return history...
                    </td>
                  </tr>
                ) : filteredHistory.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">
                      No returns recorded yet.
                    </td>
                  </tr>
                ) : (
                  filteredHistory.map((ret) => (
                    <tr key={ret.id} className="hover:bg-muted/40 transition">
                      <td className="p-3 font-bold text-foreground">{ret.return_number}</td>
                      <td className="p-3 text-muted-foreground">
                        {new Date(ret.created_at).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td className="p-3">
                        <p className="font-semibold text-foreground">{ret.customer_name}</p>
                        {ret.customer_phone && (
                          <p className="text-[10px] text-muted-foreground">{ret.customer_phone}</p>
                        )}
                      </td>
                      <td className="p-3 text-muted-foreground max-w-xs truncate">
                        {ret.return_reason}
                      </td>
                      <td className="p-3 font-bold text-rose-600 dark:text-rose-400">
                        {formatPrice(ret.refund_amount)}
                      </td>
                      <td className="p-3 uppercase font-semibold text-foreground">
                        {ret.refund_method}
                      </td>
                      <td className="p-3">
                        <span
                          className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                            ret.owner_notification_status === "sent"
                              ? "bg-emerald-500/10 text-emerald-600"
                              : "bg-amber-500/10 text-amber-600"
                          }`}
                        >
                          {ret.owner_notification_status || "pending"}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            const receiptData: ReturnReceiptData = {
                              return_number: ret.return_number,
                              customer_name: ret.customer_name,
                              customer_phone: ret.customer_phone,
                              refund_amount: Number(ret.refund_amount),
                              refund_method: ret.refund_method,
                              return_reason: ret.return_reason,
                              notes: ret.notes,
                              created_at: ret.created_at,
                              items: (ret.offline_return_items || []).map((i) => ({
                                name: i.name,
                                sku: i.sku,
                                barcode: i.barcode,
                                variant_info: i.variant_info,
                                refund_price: Number(i.refund_price),
                                qty: Number(i.qty),
                                subtotal: Number(i.subtotal),
                              })),
                            };
                            setActiveReceipt(receiptData);
                            setIsReceiptOpen(true);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-muted transition cursor-pointer"
                        >
                          <Printer className="h-3 w-3" />
                          <span>Receipt</span>
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

      {/* ── CONFIRMATION MODAL ── */}
      {isConfirmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-100">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-2.5 border-b border-border pb-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-500/10 text-rose-600">
                <RotateCcw className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">Confirm Offline Return</h3>
                <p className="text-xs text-muted-foreground">
                  Verify return details before restock
                </p>
              </div>
            </div>

            <div className="space-y-2 rounded-xl bg-muted/40 p-3 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Returned Items:</span>
                <span className="font-bold text-foreground">+{totalReturnUnits} units</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Refund Method:</span>
                <span className="font-bold uppercase text-foreground">{refundMethod}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Customer:</span>
                <span className="font-bold text-foreground">
                  {customerMode === "walkin" ? "Walk-in Customer" : customerName || "Walk-in"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Reason:</span>
                <span className="font-bold text-foreground">{returnReason}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-border text-sm font-black text-rose-600">
                <span>TOTAL REFUND:</span>
                <span>{formatPrice(totalRefundAmount)}</span>
              </div>
            </div>

            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-700 dark:text-amber-300 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                Inventory will be increased immediately. This transaction cannot be undone.
              </span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsConfirmModalOpen(false)}
                disabled={processReturnMutation.isPending}
                className="rounded-xl border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer"
              >
                Go Back
              </button>

              <button
                type="button"
                onClick={handleConfirmReturn}
                disabled={processReturnMutation.isPending}
                className="flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50 transition shadow-sm cursor-pointer"
              >
                {processReturnMutation.isPending ? "Restocking..." : "Confirm & Restock"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 80mm THERMAL RETURN RECEIPT MODAL ── */}
      {isReceiptOpen && activeReceipt && (
        <POSReturnReceipt
          returnData={activeReceipt}
          onClose={() => {
            setIsReceiptOpen(false);
            setActiveReceipt(null);
          }}
        />
      )}
    </div>
  );
}
