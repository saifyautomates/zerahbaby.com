/**
 * POSReturnsTab — High-Precision Offline POS Returns & Exchange System.
 *
 * 3 Discovery Paths:
 * 1. 👤 Customer Search (Name / Phone / Customer ID) -> Complete Purchase Timeline
 * 2. 📦 Product Barcode / SKU Scan (Walk-in Candidate Matching with Date/Invoice Filters)
 * 3. 🧾 Invoice / Transaction QR Scan -> Instant Exact Sale Resolution
 *
 * Capabilities:
 * - Immutable Historical Price Authority (returns strictly calculate from original invoice price)
 * - Exact Partial Return Tracking (already returned qty vs returnable qty enforcement)
 * - Zero guessing on multiple purchases (lists candidate sales with interactive filters)
 * - 100% Store Credit / Exchange Credit Voucher generation
 * - Atomic inventory restock (+stock) and store credit ledger logging
 * - Thermal 80mm & A4 print vouchers
 */
import React, { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  QrCode,
  Layers,
  Clock,
  Filter,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import { formatPrice, imageFor } from "@/lib/store";
import { playScanSuccess, playScanError } from "@/lib/audio";
import { useGlobalBarcodeScanner, clearPendingScans } from "@/lib/barcode-scanner";
import { generateIdempotencyKey } from "@/lib/pos";
import { useTableSelection, getReturnsSelectionMetrics } from "@/lib/table-selection";
import { SmartSelectionSummary } from "@/components/admin/SmartSelectionSummary";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import {
  type ReturnCartItem,
  type OfflineReturn,
  type ProcessReturnInput,
  type OfflineSaleWithReturnMetrics,
  type OfflineSaleItemWithReturnStatus,
  RETURN_REASONS,
  lookupProductForReturn,
  useProcessOfflineReturn,
  useDeleteOfflineReturns,
  useOfflineReturnsList,
  useOfflineSalesForReturnsLookup,
  parseReturnScanCode,
} from "@/lib/pos-returns";
import { POSReturnReceipt, type ReturnReceiptData } from "@/components/admin/POSReturnReceipt";

type ReturnView = "process" | "history";
type DiscoveryMode = "customer" | "barcode" | "invoice_qr";

export function POSReturnsTab() {
  const qc = useQueryClient();
  const [view, setView] = useState<ReturnView>("process");

  // Discovery Mode: 'customer' | 'barcode' | 'invoice_qr'
  const [discoveryMode, setDiscoveryMode] = useState<DiscoveryMode>("customer");

  // Search Inputs
  const [customerSearchQuery, setCustomerSearchQuery] = useState("");
  const [productScanQuery, setProductScanQuery] = useState("");
  const [invoiceScanQuery, setInvoiceScanQuery] = useState("");

  // Filters for Walk-in Barcode Matching Candidates
  const [dateFilter, setDateFilter] = useState("");
  const [candidateCustomerFilter, setCandidateCustomerFilter] = useState("");
  const [candidateInvoiceFilter, setCandidateInvoiceFilter] = useState("");
  const [onlyReturnableFilter, setOnlyReturnableFilter] = useState(true);

  // Expanded UI States
  const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null);
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);

  // Cart & Scan State
  const [returnCart, setReturnCart] = useState<ReturnCartItem[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);

  // Return Details State
  const [returnReason, setReturnReason] = useState<string>(RETURN_REASONS[0]);
  const [returnNotes, setReturnNotes] = useState("");
  const [refundMethod, setRefundMethod] = useState<string>("exchange_credit");
  const [originalSaleId, setOriginalSaleId] = useState<string | null>(null);

  // Hardware Scanner 1200ms Debounce Lock to ensure 1 scan = 1 quantity exactly
  const lastReturnScanLockRef = useRef<{ code: string; time: number }>({ code: "", time: 0 });

  // Customer State
  const [customerMode, setCustomerMode] = useState<"walkin" | "existing">("walkin");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");

  // Confirmation & Receipt State
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(generateIdempotencyKey());
  const [activeReceipt, setActiveReceipt] = useState<ReturnReceiptData | null>(null);

  // History Detail Modal
  const [selectedHistoryReturn, setSelectedHistoryReturn] = useState<OfflineReturn | null>(null);
  const [historySearch, setHistorySearch] = useState("");

  // Queries
  const { data: pastSalesWithMetrics = [], isLoading: isSalesLoading } =
    useOfflineSalesForReturnsLookup();
  const { data: returnsList = [], isLoading: isHistoryLoading } = useOfflineReturnsList();
  const processReturnMutation = useProcessOfflineReturn();
  const deleteReturnsMutation = useDeleteOfflineReturns();
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null);

  // Clear any residual scans when entering Returns tab so POS Terminal is clean
  useEffect(() => {
    clearPendingScans();
  }, []);

  /* ------------------------------------------------------------------ */
  /*  DISCOVERY MODE 1: Customer Grouped Sales History                   */
  /* ------------------------------------------------------------------ */
  const groupedCustomerPurchases = useMemo(() => {
    const q = customerSearchQuery.trim().toLowerCase();

    // Group all past sales by customer identity (phone or name)
    const customerMap = new Map<
      string,
      {
        key: string;
        customer_id: string | null;
        customer_name: string;
        customer_phone: string;
        customer_email: string;
        total_spent: number;
        total_orders: number;
        sales: OfflineSaleWithReturnMetrics[];
        has_returnable_items: boolean;
      }
    >();

    pastSalesWithMetrics.forEach((sale) => {
      const key =
        sale.customer_phone ||
        (sale.customer_name !== "Walk-in Customer" ? sale.customer_name : null) ||
        `walkin-${sale.id}`;

      if (!customerMap.has(key)) {
        customerMap.set(key, {
          key,
          customer_id: sale.customer_id,
          customer_name: sale.customer_name || "Walk-in Customer",
          customer_phone: sale.customer_phone || "",
          customer_email: sale.customer_email || "",
          total_spent: 0,
          total_orders: 0,
          sales: [],
          has_returnable_items: false,
        });
      }

      const group = customerMap.get(key)!;
      group.sales.push(sale);
      group.total_spent += sale.total;
      group.total_orders += 1;
      if (sale.has_returnable_items) {
        group.has_returnable_items = true;
      }
    });

    let groups = Array.from(customerMap.values());

    if (q) {
      groups = groups.filter((g) => {
        const nameMatch = g.customer_name.toLowerCase().includes(q);
        const phoneMatch = g.customer_phone.toLowerCase().includes(q);
        const saleMatch = g.sales.some(
          (s) =>
            s.sale_number.toLowerCase().includes(q) ||
            s.offline_sale_items.some(
              (it) =>
                it.name.toLowerCase().includes(q) ||
                it.sku.toLowerCase().includes(q) ||
                it.barcode.toLowerCase().includes(q),
            ),
        );
        return nameMatch || phoneMatch || saleMatch;
      });
    }

    return groups;
  }, [pastSalesWithMetrics, customerSearchQuery]);

  /* ------------------------------------------------------------------ */
  /*  DISCOVERY MODE 2: Product Barcode Historical Sales Candidates     */
  /* ------------------------------------------------------------------ */
  const productBarcodeMatches = useMemo(() => {
    const q = productScanQuery.trim().toLowerCase();
    if (!q) return [];

    const matches: Array<{
      sale: OfflineSaleWithReturnMetrics;
      item: OfflineSaleItemWithReturnStatus;
    }> = [];

    pastSalesWithMetrics.forEach((sale) => {
      sale.offline_sale_items.forEach((item) => {
        const barcodeMatch = item.barcode && item.barcode.toLowerCase() === q;
        const skuMatch = item.sku && item.sku.toLowerCase() === q;
        const nameMatch = item.name && item.name.toLowerCase().includes(q);

        if (barcodeMatch || skuMatch || nameMatch) {
          // Apply Candidate Filters
          if (onlyReturnableFilter && item.returnable_qty <= 0) {
            return;
          }

          if (dateFilter.trim()) {
            const saleDateStr = new Date(sale.created_at).toISOString().slice(0, 10);
            const humanDateStr = new Date(sale.created_at)
              .toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })
              .toLowerCase();
            const filterLower = dateFilter.trim().toLowerCase();
            if (!saleDateStr.includes(filterLower) && !humanDateStr.includes(filterLower)) {
              return;
            }
          }

          if (candidateCustomerFilter.trim()) {
            const custLower = candidateCustomerFilter.trim().toLowerCase();
            const matchName = sale.customer_name.toLowerCase().includes(custLower);
            const matchPhone = sale.customer_phone.toLowerCase().includes(custLower);
            if (!matchName && !matchPhone) return;
          }

          if (candidateInvoiceFilter.trim()) {
            const invLower = candidateInvoiceFilter.trim().toLowerCase();
            if (!sale.sale_number.toLowerCase().includes(invLower)) return;
          }

          matches.push({ sale, item });
        }
      });
    });

    // Sort by sale timestamp: newest first
    return matches.sort(
      (a, b) => new Date(b.sale.created_at).getTime() - new Date(a.sale.created_at).getTime(),
    );
  }, [
    pastSalesWithMetrics,
    productScanQuery,
    dateFilter,
    candidateCustomerFilter,
    candidateInvoiceFilter,
    onlyReturnableFilter,
  ]);

  /* ------------------------------------------------------------------ */
  /*  DISCOVERY MODE 3: Invoice / Receipt QR Direct Match               */
  /* ------------------------------------------------------------------ */
  const invoiceQrMatch = useMemo(() => {
    const q = invoiceScanQuery.trim().toUpperCase();
    if (!q) return null;

    return (
      pastSalesWithMetrics.find(
        (s) =>
          s.sale_number.toUpperCase() === q ||
          s.sale_number.toUpperCase().includes(q) ||
          (s.notes && s.notes.toUpperCase().includes(q)),
      ) || null
    );
  }, [pastSalesWithMetrics, invoiceScanQuery]);

  /* ------------------------------------------------------------------ */
  /*  Select Item for Return (From Historical Sale Record)               */
  /* ------------------------------------------------------------------ */
  const handleSelectHistoricalItemForReturn = useCallback(
    (sale: OfflineSaleWithReturnMetrics, item: OfflineSaleItemWithReturnStatus) => {
      if (item.returnable_qty <= 0) {
        playScanError();
        toast.error(`'${item.name}' has already been fully returned (#${sale.sale_number}).`);
        return;
      }

      playScanSuccess();

      // Check if already in cart
      setReturnCart((prev) => {
        const existingIdx = prev.findIndex((i) => i.original_sale_item_id === item.id);

        if (existingIdx >= 0) {
          const currentQty = prev[existingIdx].qty;
          if (currentQty >= item.returnable_qty) {
            toast.warning(
              `Maximum returnable limit reached for this item (${item.returnable_qty} units).`,
            );
            return prev;
          }

          const updated = [...prev];
          updated[existingIdx] = {
            ...updated[existingIdx],
            qty: currentQty + 1,
          };
          toast.success(
            `Incremented '${item.name}' (Qty: ${currentQty + 1} of max ${item.returnable_qty})`,
          );
          return updated;
        }

        // Add new verified historical item
        const newItem: ReturnCartItem = {
          product_id: item.product_id,
          product_slug: item.product_slug || item.product_id || "",
          name: item.name,
          sku: item.sku,
          barcode: item.barcode,
          image_url: imageFor("clothing", undefined),
          current_price: item.price,
          recent_sold_price: item.price,
          refund_price: item.price, // STRICT HISTORICAL PRICE AUTHORITY
          mrp: item.mrp || item.price,
          current_stock: 0,
          variant_info:
            item.variant_info || (item.color ? `${item.color} / ${item.size}` : "Standard"),
          qty: 1,
          original_sale_id: sale.id,
          original_sale_item_id: item.id,
          original_sale_number: sale.sale_number,
          original_qty: item.qty,
          already_returned_qty: item.already_returned_qty,
          max_returnable_qty: item.returnable_qty,
        };

        toast.success(
          `Selected '${item.name}' for Return (Historical Price: ${formatPrice(item.price)})`,
        );
        return [newItem, ...prev];
      });

      // Auto-link customer association & original sale ID
      setOriginalSaleId(sale.id);
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
    },
    [],
  );

  /* ------------------------------------------------------------------ */
  /*  Direct Unlinked Walk-in Product Return (Fallback)                 */
  /* ------------------------------------------------------------------ */
  const handleDirectCatalogProductReturn = useCallback(async (code: string) => {
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

      setReturnCart((prev) => {
        const existingIdx = prev.findIndex(
          (i) => i.product_id === result.product_id && !i.original_sale_item_id,
        );
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = { ...updated[existingIdx], qty: updated[existingIdx].qty + 1 };
          return updated;
        }

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

        toast.success(
          `Added '${result.name}' (Direct Return: ${formatPrice(newItem.refund_price)})`,
        );
        return [newItem, ...prev];
      });

      setProductScanQuery("");
    } catch (err: unknown) {
      playScanError();
      toast.error((err as Error).message || "Error resolving barcode");
    } finally {
      setIsScanning(false);
    }
  }, []);

  /* ------------------------------------------------------------------ */
  /*  Global Hardware Barcode Scanner Router                            */
  /* ------------------------------------------------------------------ */
  const handleUniversalBarcodeScan = useCallback(
    async (scannedRaw: string) => {
      const trimmed = (scannedRaw || "").trim();
      if (!trimmed) return;

      const now = Date.now();
      if (
        lastReturnScanLockRef.current.code === trimmed &&
        now - lastReturnScanLockRef.current.time < 1200
      ) {
        // Debounce duplicate trigger from physical barcode scanner
        return;
      }
      lastReturnScanLockRef.current = { code: trimmed, time: now };

      // 1. Immediately clear the global pending queue so POS Terminal NEVER receives this scan!
      clearPendingScans();

      const parsed = parseReturnScanCode(trimmed);

      if (parsed.type === "invoice_qr") {
        setDiscoveryMode("invoice_qr");
        setInvoiceScanQuery(parsed.value);
        playScanSuccess();
        toast.success(`Scanned Invoice QR: ${parsed.value}`);
        return;
      }

      if (parsed.type === "credit_token") {
        setDiscoveryMode("invoice_qr");
        setInvoiceScanQuery(parsed.value);
        playScanSuccess();
        toast.success(`Scanned Voucher Token: ${parsed.value}`);
        return;
      }

      // 2. Product Barcode / SKU Scan:
      // Directly add to Return Terminal Cart!
      setDiscoveryMode("barcode");
      setProductScanQuery(parsed.value);

      // If customer is selected and has bought this item with returnable quantity, select from history
      if (customerMode === "existing" && customerPhone) {
        const custClean = customerPhone.replace(/\D/g, "");
        const matchingSale = pastSalesWithMetrics.find(
          (s) =>
            s.customer_phone &&
            s.customer_phone.replace(/\D/g, "") === custClean &&
            s.offline_sale_items.some(
              (it) =>
                (it.barcode === parsed.value || it.sku === parsed.value) && it.returnable_qty > 0,
            ),
        );

        if (matchingSale) {
          const item = matchingSale.offline_sale_items.find(
            (it) =>
              (it.barcode === parsed.value || it.sku === parsed.value) && it.returnable_qty > 0,
          );
          if (item) {
            handleSelectHistoricalItemForReturn(matchingSale, item);
            return;
          }
        }
      }

      // Check if there is an exact single matching historical sale in the store for this barcode
      const singleMatch = pastSalesWithMetrics.filter((s) =>
        s.offline_sale_items.some(
          (it) => (it.barcode === parsed.value || it.sku === parsed.value) && it.returnable_qty > 0,
        ),
      );

      if (singleMatch.length === 1) {
        const item = singleMatch[0].offline_sale_items.find(
          (it) => (it.barcode === parsed.value || it.sku === parsed.value) && it.returnable_qty > 0,
        );
        if (item) {
          handleSelectHistoricalItemForReturn(singleMatch[0], item);
          return;
        }
      }

      // Otherwise, immediately resolve catalog product and add directly into Return Terminal Cart!
      await handleDirectCatalogProductReturn(parsed.value);
    },
    [
      customerMode,
      customerPhone,
      pastSalesWithMetrics,
      handleSelectHistoricalItemForReturn,
      handleDirectCatalogProductReturn,
    ],
  );

  useGlobalBarcodeScanner(
    (scannedCode) => {
      void handleUniversalBarcodeScan(scannedCode);
    },
    view === "process" && !isConfirmModalOpen && !activeReceipt,
  );

  // Update Item Quantity in Return Cart
  const handleUpdateQty = (idx: number, delta: number) => {
    setReturnCart((prev) => {
      const updated = [...prev];
      const item = updated[idx];
      const newQty = item.qty + delta;

      if (newQty <= 0) return prev;

      if (item.max_returnable_qty && newQty > item.max_returnable_qty) {
        toast.warning(`Cannot exceed max returnable quantity of ${item.max_returnable_qty} units.`);
        return prev;
      }

      updated[idx] = { ...item, qty: newQty };
      return updated;
    });
  };

  const handleRemoveCartItem = (idx: number) => {
    setReturnCart((prev) => prev.filter((_, i) => i !== idx));
  };

  // Financial Calculations (100% STORE CREDIT)
  const totalReturnUnits = useMemo(
    () => returnCart.reduce((sum, item) => sum + item.qty, 0),
    [returnCart],
  );

  const totalRefundAmount = useMemo(
    () => returnCart.reduce((sum, item) => sum + item.refund_price * item.qty, 0),
    [returnCart],
  );

  // Submit Return Execution
  const handleProcessReturn = async () => {
    if (returnCart.length === 0) {
      toast.error("Return cart is empty. Please select or scan items to return.");
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
        refund_method: "exchange_credit",
        refund_status: "completed",
        return_reason: returnReason,
        notes: returnNotes.trim(),
        original_sale_id: originalSaleId,
        items: returnCart.map((i) => {
          const isUuid =
            Boolean(i.product_id) &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              i.product_id || "",
            );
          return {
            product_id: isUuid ? i.product_id : null,
            product_slug: i.product_slug,
            name: i.name,
            sku: i.sku,
            barcode: i.barcode,
            variant_info: i.variant_info,
            refund_price: i.refund_price,
            qty: i.qty,
            mrp: i.mrp,
            original_sale_item_id: i.original_sale_item_id || null,
          };
        }),
        idempotency_key: idempotencyKey,
      };

      const result = await processReturnMutation.mutateAsync(payload);

      const receiptData: ReturnReceiptData = {
        return_number: result.return_number,
        credit_token: result.credit_token,
        customer_name: resolvedCustomerName,
        customer_phone: customerPhone.trim(),
        items: returnCart.map((item) => ({
          name: item.name,
          sku: item.sku,
          barcode: item.barcode,
          variant_info: item.variant_info,
          qty: item.qty,
          refund_price: item.refund_price,
          subtotal: item.refund_price * item.qty,
        })),
        refund_amount: result.refund_amount,
        refund_method: "exchange_credit",
        return_reason: returnReason,
        notes: returnNotes.trim(),
        created_at: new Date().toISOString(),
        expires_at: result.expires_at,
      };

      setActiveReceipt(receiptData);
      setIsConfirmModalOpen(false);

      // Reset state for next return
      setReturnCart([]);
      setCustomerName("");
      setCustomerPhone("");
      setCustomerEmail("");
      setCustomerId(null);
      setCustomerMode("walkin");
      setCustomerSearchQuery("");
      setProductScanQuery("");
      setInvoiceScanQuery("");
      setReturnNotes("");
      setOriginalSaleId(null);
      setIdempotencyKey(generateIdempotencyKey());
      toast.success(
        `Store Credit Voucher #${result.return_number} issued! (${formatPrice(result.refund_amount)})`,
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
        (r.credit_token && r.credit_token.toLowerCase().includes(q)) ||
        r.return_reason.toLowerCase().includes(q),
    );
  }, [returnsList, historySearch]);

  const historySelection = useTableSelection<OfflineReturn>({ items: filteredHistory });
  const historyMetrics = useMemo(
    () =>
      getReturnsSelectionMetrics(
        historySelection.selectedItems as unknown as Array<{ id: string; refund_amount?: number }>,
      ),
    [historySelection.selectedItems],
  );

  return (
    <div className="flex flex-col space-y-5">
      {/* ── Sub-Header & Main Views ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <RotateCcw className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              POS Offline Returns &amp; Exchange
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">
                100% Store Credit
              </span>
            </h2>
            <p className="text-xs text-muted-foreground">
              Search by Customer Profile, Scan Product Barcode, or Scan Receipt QR Code for exact
              historical returns.
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
          {/* LEFT 7-COL: 3-Mode Discovery & Selection */}
          <div className="lg:col-span-7 flex flex-col space-y-4">
            {/* 3-Mode Return Discovery Switcher */}
            <div className="rounded-2xl border border-border bg-card p-4 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Search className="h-4 w-4 text-primary" />
                  <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
                    Return Discovery Method
                  </h3>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  Scanner gun auto-routes barcode &amp; QR
                </span>
              </div>

              {/* Mode Toggle Buttons */}
              <div className="grid grid-cols-3 gap-2 p-1 rounded-xl bg-muted/40 border border-border text-xs">
                <button
                  type="button"
                  onClick={() => setDiscoveryMode("customer")}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-lg font-bold transition cursor-pointer ${
                    discoveryMode === "customer"
                      ? "bg-card text-foreground shadow-xs border border-border/80"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <User className="size-3.5 text-primary" />
                  <span>1. Customer Search</span>
                </button>

                <button
                  type="button"
                  onClick={() => setDiscoveryMode("barcode")}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-lg font-bold transition cursor-pointer ${
                    discoveryMode === "barcode"
                      ? "bg-card text-foreground shadow-xs border border-border/80"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Scan className="size-3.5 text-primary" />
                  <span>2. Product Barcode</span>
                </button>

                <button
                  type="button"
                  onClick={() => setDiscoveryMode("invoice_qr")}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-lg font-bold transition cursor-pointer ${
                    discoveryMode === "invoice_qr"
                      ? "bg-card text-foreground shadow-xs border border-border/80"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <QrCode className="size-3.5 text-primary" />
                  <span>3. Invoice / QR</span>
                </button>
              </div>

              {/* ───────────────────────────────────────────────────────────── */}
              {/* MODE 1: CUSTOMER SEARCH & TIMELINE                           */}
              {/* ───────────────────────────────────────────────────────────── */}
              {discoveryMode === "customer" && (
                <div className="space-y-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      type="text"
                      value={customerSearchQuery}
                      onChange={(e) => setCustomerSearchQuery(e.target.value)}
                      placeholder="Search by Customer Name, Phone Number, or ID..."
                      className="w-full rounded-xl border border-border bg-background pl-9 pr-9 py-2.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                    />
                    {customerSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setCustomerSearchQuery("")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Customer Purchase Timeline List */}
                  <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                    {isSalesLoading ? (
                      <div className="p-6 text-center text-xs text-muted-foreground animate-pulse">
                        Loading customer purchase ledger...
                      </div>
                    ) : groupedCustomerPurchases.length === 0 ? (
                      <div className="p-6 text-center rounded-xl bg-muted/20 border border-border text-xs text-muted-foreground">
                        No customer purchase history found for "{customerSearchQuery}".
                      </div>
                    ) : (
                      groupedCustomerPurchases.slice(0, 30).map((group) => {
                        const isExpanded =
                          expandedCustomerId === group.key || groupedCustomerPurchases.length === 1;
                        return (
                          <div
                            key={group.key}
                            className="rounded-2xl border-2 border-border/80 bg-muted/20 overflow-hidden text-xs transition shadow-2xs"
                          >
                            {/* Customer Profile Header */}
                            <div
                              onClick={() => setExpandedCustomerId(isExpanded ? null : group.key)}
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
                                    {group.customer_name}
                                  </span>
                                  {group.customer_phone && (
                                    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-mono font-bold text-foreground">
                                      <Phone className="size-2.5 text-muted-foreground" />
                                      {group.customer_phone}
                                    </span>
                                  )}
                                  {group.has_returnable_items ? (
                                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 text-[10px] font-bold">
                                      Eligible for Return
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 rounded-md bg-muted text-muted-foreground px-1.5 py-0.5 text-[10px] font-bold">
                                      Fully Returned
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="text-right shrink-0 flex items-center gap-3">
                                <span className="font-extrabold text-foreground text-xs block">
                                  {group.sales.length} Transaction
                                  {group.sales.length !== 1 ? "s" : ""}
                                </span>
                              </div>
                            </div>

                            {/* Customer Purchase Timeline */}
                            {isExpanded && (
                              <div className="p-3.5 bg-background space-y-3.5">
                                {group.sales.map((sale) => (
                                  <div
                                    key={sale.id}
                                    className="rounded-xl border border-border/70 overflow-hidden bg-card shadow-2xs"
                                  >
                                    {/* Transaction Header */}
                                    <div className="px-3 py-2 bg-muted/40 flex flex-wrap justify-between items-center gap-2 border-b border-border/60">
                                      <div className="flex items-center gap-2">
                                        <span className="font-mono text-[11px] font-bold text-primary">
                                          #{sale.sale_number}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                          <Clock className="size-2.5" />
                                          {new Date(sale.created_at).toLocaleDateString("en-IN", {
                                            day: "numeric",
                                            month: "short",
                                            year: "numeric",
                                            hour: "2-digit",
                                            minute: "2-digit",
                                          })}
                                        </span>
                                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted uppercase font-mono font-bold text-muted-foreground">
                                          {sale.payment_method}
                                        </span>
                                      </div>
                                      <div className="text-right">
                                        <span className="font-extrabold text-foreground text-xs">
                                          Total: {formatPrice(sale.total)}
                                        </span>
                                      </div>
                                    </div>

                                    {/* Purchased Items List */}
                                    <div className="divide-y divide-border/40">
                                      {sale.offline_sale_items.map((item) => (
                                        <div
                                          key={item.id}
                                          className="p-3 flex items-center justify-between gap-3"
                                        >
                                          <div className="min-w-0 flex-1">
                                            <p className="font-bold text-foreground text-xs truncate">
                                              {item.name}
                                            </p>
                                            <div className="flex flex-wrap items-center gap-2 mt-1">
                                              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 text-[10.5px] font-extrabold text-emerald-700 dark:text-emerald-300">
                                                Purchased: {formatPrice(item.price)}
                                              </span>
                                              <span className="text-[10.5px] text-muted-foreground font-medium">
                                                Bought: {item.qty}
                                              </span>
                                              {item.already_returned_qty > 0 && (
                                                <span className="text-[10.5px] text-amber-600 dark:text-amber-400 font-bold">
                                                  Returned: {item.already_returned_qty}
                                                </span>
                                              )}
                                              <span
                                                className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-md ${
                                                  item.returnable_qty > 0
                                                    ? "bg-primary/10 text-primary border border-primary/20"
                                                    : "bg-muted text-muted-foreground"
                                                }`}
                                              >
                                                {item.returnable_qty > 0
                                                  ? `Returnable: ${item.returnable_qty} of ${item.qty}`
                                                  : "Already Fully Returned"}
                                              </span>
                                            </div>
                                          </div>

                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleSelectHistoricalItemForReturn(sale, item)
                                            }
                                            disabled={item.returnable_qty <= 0}
                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 font-bold text-xs disabled:opacity-40 disabled:pointer-events-none transition cursor-pointer shadow-xs shrink-0"
                                          >
                                            <Plus className="size-3.5" />
                                            <span>Select for Return</span>
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* ───────────────────────────────────────────────────────────── */}
              {/* MODE 2: WALK-IN PRODUCT BARCODE MATCHING CANDIDATES          */}
              {/* ───────────────────────────────────────────────────────────── */}
              {discoveryMode === "barcode" && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Scan className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary animate-pulse" />
                      <input
                        ref={scanInputRef}
                        type="text"
                        value={productScanQuery}
                        onChange={(e) => setProductScanQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const code = productScanQuery.trim();
                            if (!code) return;
                            const now = Date.now();
                            if (
                              lastReturnScanLockRef.current.code === code &&
                              now - lastReturnScanLockRef.current.time < 1200
                            ) {
                              return;
                            }
                            lastReturnScanLockRef.current = { code, time: now };
                            if (productBarcodeMatches.length === 0) {
                              handleDirectCatalogProductReturn(code);
                            }
                          }
                        }}
                        placeholder="Scan barcode gun or enter Product Barcode / SKU..."
                        className="w-full rounded-xl border border-border bg-background pl-9 pr-9 py-2.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                      />
                      {productScanQuery && (
                        <button
                          type="button"
                          onClick={() => setProductScanQuery("")}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          <X className="size-3.5" />
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDirectCatalogProductReturn(productScanQuery)}
                      disabled={isScanning || !productScanQuery.trim()}
                      className="px-3.5 py-2.5 rounded-xl bg-muted border border-border hover:bg-muted/80 text-foreground font-bold text-xs transition cursor-pointer shrink-0"
                      title="Add as Direct Return if no historical invoice exists"
                    >
                      Direct Return
                    </button>
                  </div>

                  {/* Interactive Filters for Ambiguity Resolution */}
                  {productScanQuery.trim().length > 0 && (
                    <div className="p-3 rounded-xl bg-muted/30 border border-border/70 space-y-2.5">
                      <div className="flex items-center justify-between text-[11px] font-bold text-muted-foreground">
                        <span className="flex items-center gap-1 text-foreground">
                          <Filter className="size-3 text-primary" /> Filter Candidate Transactions (
                          {productBarcodeMatches.length} Matches)
                        </span>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={onlyReturnableFilter}
                            onChange={(e) => setOnlyReturnableFilter(e.target.checked)}
                            className="rounded text-primary focus:ring-primary size-3.5"
                          />
                          <span>Returnable Only</span>
                        </label>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div className="relative">
                          <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
                          <input
                            type="text"
                            value={dateFilter}
                            onChange={(e) => setDateFilter(e.target.value)}
                            placeholder="Date (e.g. 15 Jan, 2026-09-02)"
                            className="w-full rounded-lg border border-border bg-background pl-7 pr-2 py-1.5 text-[11px] text-foreground outline-none"
                          />
                        </div>

                        <div className="relative">
                          <User className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
                          <input
                            type="text"
                            value={candidateCustomerFilter}
                            onChange={(e) => setCandidateCustomerFilter(e.target.value)}
                            placeholder="Customer / Phone"
                            className="w-full rounded-lg border border-border bg-background pl-7 pr-2 py-1.5 text-[11px] text-foreground outline-none"
                          />
                        </div>

                        <div className="relative">
                          <Receipt className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
                          <input
                            type="text"
                            value={candidateInvoiceFilter}
                            onChange={(e) => setCandidateInvoiceFilter(e.target.value)}
                            placeholder="Invoice # (e.g. 00012)"
                            className="w-full rounded-lg border border-border bg-background pl-7 pr-2 py-1.5 text-[11px] text-foreground outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Matching Historical Candidates List */}
                  <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                    {productScanQuery.trim().length === 0 ? (
                      <div className="p-6 text-center rounded-xl bg-muted/20 border border-border text-xs text-muted-foreground">
                        Scan product barcode or enter SKU to view all matching historical sales.
                      </div>
                    ) : productBarcodeMatches.length === 0 ? (
                      <div className="p-6 text-center rounded-xl bg-muted/20 border border-border text-xs text-muted-foreground space-y-2">
                        <p>No historical POS sales found matching "{productScanQuery}".</p>
                        <button
                          type="button"
                          onClick={() => handleDirectCatalogProductReturn(productScanQuery)}
                          className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-bold text-xs cursor-pointer inline-flex items-center gap-1.5"
                        >
                          <Plus className="size-3" />
                          <span>Process as Walk-in Direct Return ({productScanQuery})</span>
                        </button>
                      </div>
                    ) : (
                      productBarcodeMatches.map(({ sale, item }, idx) => (
                        <div
                          key={`${sale.id}-${item.id}-${idx}`}
                          className="p-3.5 rounded-xl border border-border bg-card hover:bg-muted/30 transition flex items-center justify-between gap-3 text-xs shadow-2xs"
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono font-bold text-primary">
                                #{sale.sale_number}
                              </span>
                              <span className="font-semibold text-foreground">
                                {sale.customer_name || "Walk-in Customer"}
                              </span>
                              {sale.customer_phone && (
                                <span className="font-mono text-[10.5px] text-muted-foreground">
                                  ({sale.customer_phone})
                                </span>
                              )}
                              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <Clock className="size-2.5" />
                                {new Date(sale.created_at).toLocaleDateString("en-IN", {
                                  day: "numeric",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </div>

                            <p className="font-bold text-foreground text-xs truncate">
                              {item.name}
                            </p>

                            <div className="flex flex-wrap items-center gap-2 text-[11px]">
                              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.2 font-extrabold text-emerald-700 dark:text-emerald-300">
                                Sold at: {formatPrice(item.price)}
                              </span>
                              <span className="text-muted-foreground">Qty Bought: {item.qty}</span>
                              <span
                                className={`font-bold px-1.5 py-0.2 rounded ${
                                  item.returnable_qty > 0
                                    ? "bg-primary/10 text-primary"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                Returnable: {item.returnable_qty}
                              </span>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleSelectHistoricalItemForReturn(sale, item)}
                            disabled={item.returnable_qty <= 0}
                            className="px-3 py-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 font-bold text-xs disabled:opacity-40 disabled:pointer-events-none transition cursor-pointer shadow-xs shrink-0 flex items-center gap-1"
                          >
                            <Plus className="size-3.5" />
                            <span>Select ({formatPrice(item.price)})</span>
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* ───────────────────────────────────────────────────────────── */}
              {/* MODE 3: INVOICE / RECEIPT QR SCAN & DIRECT RESOLUTION         */}
              {/* ───────────────────────────────────────────────────────────── */}
              {discoveryMode === "invoice_qr" && (
                <div className="space-y-3">
                  <div className="relative">
                    <QrCode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
                    <input
                      type="text"
                      value={invoiceScanQuery}
                      onChange={(e) => setInvoiceScanQuery(e.target.value)}
                      placeholder="Scan Invoice QR Code or type Invoice Number (e.g. POS-2609-00012)..."
                      className="w-full rounded-xl border border-border bg-background pl-9 pr-9 py-2.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all font-mono"
                    />
                    {invoiceScanQuery && (
                      <button
                        type="button"
                        onClick={() => setInvoiceScanQuery("")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>

                  {invoiceScanQuery.trim().length === 0 ? (
                    <div className="p-6 text-center rounded-xl bg-muted/20 border border-border text-xs text-muted-foreground">
                      Scan invoice barcode/QR on the customer's receipt to immediately open that
                      exact transaction.
                    </div>
                  ) : !invoiceQrMatch ? (
                    <div className="p-6 text-center rounded-xl bg-muted/20 border border-border text-xs text-muted-foreground">
                      No matching invoice found for "{invoiceScanQuery}".
                    </div>
                  ) : (
                    <div className="rounded-2xl border-2 border-primary/40 bg-card overflow-hidden text-xs shadow-xs space-y-3">
                      <div className="p-3.5 bg-primary/10 border-b border-primary/20 flex items-center justify-between">
                        <div>
                          <span className="font-mono font-black text-sm text-primary">
                            #{invoiceQrMatch.sale_number}
                          </span>
                          <span className="text-[11px] text-muted-foreground ml-2">
                            {new Date(invoiceQrMatch.created_at).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <span className="font-extrabold text-foreground text-sm">
                          {formatPrice(invoiceQrMatch.total)}
                        </span>
                      </div>

                      <div className="p-3 divide-y divide-border/60">
                        {invoiceQrMatch.offline_sale_items.map((item) => (
                          <div
                            key={item.id}
                            className="py-2.5 flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="font-bold text-foreground text-xs">{item.name}</p>
                              <div className="flex items-center gap-2 mt-0.5 text-[11px]">
                                <span className="font-extrabold text-emerald-600 dark:text-emerald-400">
                                  Paid: {formatPrice(item.price)}
                                </span>
                                <span className="text-muted-foreground">Bought: {item.qty}</span>
                                <span
                                  className={`font-bold px-1.5 py-0.2 rounded text-[10px] ${
                                    item.returnable_qty > 0
                                      ? "bg-primary/10 text-primary"
                                      : "bg-muted text-muted-foreground"
                                  }`}
                                >
                                  Returnable: {item.returnable_qty}
                                </span>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() =>
                                handleSelectHistoricalItemForReturn(invoiceQrMatch, item)
                              }
                              disabled={item.returnable_qty <= 0}
                              className="px-3 py-1.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 font-bold text-xs disabled:opacity-40 disabled:pointer-events-none transition cursor-pointer shadow-xs shrink-0 flex items-center gap-1"
                            >
                              <Plus className="size-3.5" />
                              <span>Select</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Return Cart Table / Items to Return */}
            <div className="rounded-2xl border border-border bg-card p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="h-4 w-4 text-primary" />
                  <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
                    Items Selected for Return ({returnCart.length})
                  </h3>
                </div>
                {returnCart.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setReturnCart([])}
                    className="text-[11px] text-destructive hover:underline font-semibold cursor-pointer"
                  >
                    Clear All
                  </button>
                )}
              </div>

              {returnCart.length === 0 ? (
                <div className="p-8 text-center rounded-xl bg-muted/20 border border-dashed border-border text-xs text-muted-foreground space-y-1">
                  <p className="font-bold text-foreground">Return cart is empty</p>
                  <p>
                    Search customer, scan barcode gun, or scan invoice QR above to select items for
                    return.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border/60">
                  {returnCart.map((item, idx) => (
                    <div
                      key={`${item.product_id}-${idx}`}
                      className="py-3 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-foreground text-xs truncate">{item.name}</p>
                          {item.original_sale_number && (
                            <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-primary/10 text-primary border border-primary/20 font-bold">
                              #{item.original_sale_number}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px]">
                          <span className="font-extrabold text-emerald-600 dark:text-emerald-400">
                            Unit Return: {formatPrice(item.refund_price)}
                          </span>
                          {item.max_returnable_qty && (
                            <span className="text-muted-foreground text-[10.5px]">
                              (Max Returnable: {item.max_returnable_qty})
                            </span>
                          )}
                          <span className="font-bold text-foreground">
                            Line Total: {formatPrice(item.refund_price * item.qty)}
                          </span>
                        </div>
                      </div>

                      {/* Qty Controls & Remove */}
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center rounded-lg border border-border bg-background">
                          <button
                            type="button"
                            onClick={() => handleUpdateQty(idx, -1)}
                            className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                          >
                            <Minus className="size-3" />
                          </button>
                          <span className="px-2.5 text-xs font-bold font-mono text-foreground">
                            {item.qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleUpdateQty(idx, 1)}
                            disabled={
                              item.max_returnable_qty != null && item.qty >= item.max_returnable_qty
                            }
                            className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                          >
                            <Plus className="size-3" />
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveCartItem(idx)}
                          className="p-1.5 text-muted-foreground hover:text-destructive cursor-pointer transition"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT 5-COL: Customer Link, Resolution & Execution */}
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
                    className={`rounded-lg px-2.5 py-1 font-bold transition cursor-pointer ${
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
                    className={`rounded-lg px-2.5 py-1 font-bold transition cursor-pointer ${
                      customerMode === "existing"
                        ? "bg-card text-foreground shadow-xs"
                        : "text-muted-foreground"
                    }`}
                  >
                    Identified Customer
                  </button>
                </div>
              </div>

              {customerMode === "walkin" ? (
                <p className="text-[11px] text-muted-foreground bg-muted/30 rounded-xl p-2.5">
                  Walk-in Customer selected. Store credit voucher will be generated with a unique
                  redeemable token.
                </p>
              ) : (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Customer Name"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
                  />
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="Customer Mobile Number"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
                  />
                </div>
              )}
            </div>

            {/* Return Reason & Notes */}
            <div className="rounded-2xl border border-border bg-card p-4 shadow-xs space-y-3">
              <h3 className="text-xs font-bold text-foreground">Return Reason &amp; Notes</h3>
              <select
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
              >
                {RETURN_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>

              <textarea
                value={returnNotes}
                onChange={(e) => setReturnNotes(e.target.value)}
                placeholder="Optional notes or item condition comments..."
                rows={2}
                className="w-full rounded-xl border border-border bg-background p-2.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
              />
            </div>

            {/* Summary & Confirm Button */}
            <div className="rounded-2xl border-2 border-primary/30 bg-card p-4 shadow-xs space-y-4">
              <div className="space-y-2 text-xs">
                <div className="flex justify-between text-muted-foreground">
                  <span>Customer:</span>
                  <span className="font-bold text-foreground">
                    {customerMode === "walkin" ? "Walk-in Customer" : customerName || "Customer"}
                  </span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Total Items to Restock:</span>
                  <span className="font-bold text-foreground">+{totalReturnUnits} units</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Settlement Method:</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">
                    100% Exchange Voucher
                  </span>
                </div>
                <div className="pt-2 border-t border-border flex justify-between items-center text-sm">
                  <span className="font-bold text-foreground">Exchange Credit Value:</span>
                  <span className="text-lg font-black text-primary">
                    {formatPrice(totalRefundAmount)}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsConfirmModalOpen(true)}
                disabled={returnCart.length === 0 || processReturnMutation.isPending}
                className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-black text-xs sm:text-sm hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-md cursor-pointer flex items-center justify-center gap-2"
              >
                <Check className="size-4" />
                <span>Confirm &amp; Issue Exchange Voucher</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── VIEW 2: RETURN HISTORY ── */}
      {view === "history" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input
                type="text"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Search returns by voucher #, customer, phone, token..."
                className="w-full rounded-xl border border-border bg-background pl-9 pr-3 py-2 text-xs text-foreground outline-none focus:border-primary"
              />
            </div>
            <div className="flex items-center gap-3">
              {historySelection.selectedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setDeleteTarget(Array.from(historySelection.selectedIds))}
                  className="px-3 py-1.5 rounded-xl bg-destructive text-destructive-foreground font-bold text-xs hover:bg-destructive/90 transition flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <Trash2 className="size-3.5" />
                  <span>Delete Selected ({historySelection.selectedCount})</span>
                </button>
              )}
              <span className="text-xs text-muted-foreground font-bold">
                Total Returns: {returnsList.length}
              </span>
            </div>
          </div>

          {/* Smart Selection Summary Bar */}
          {historySelection.selectedCount > 0 && (
            <SmartSelectionSummary
              selectedCount={historySelection.selectedCount}
              selectedLabel="Selected Returns"
              metrics={historyMetrics}
              onClear={historySelection.clearSelection}
              actions={
                <button
                  type="button"
                  onClick={() => setDeleteTarget(Array.from(historySelection.selectedIds))}
                  className="px-3 py-1 rounded-xl bg-destructive text-destructive-foreground font-bold text-xs hover:bg-destructive/90 transition flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <Trash2 className="size-3.5" />
                  <span>Delete ({historySelection.selectedCount})</span>
                </button>
              }
            />
          )}

          <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/50 border-b border-border text-muted-foreground font-bold">
                  <tr>
                    <th className="p-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={filteredHistory.length > 0 && historySelection.isAllVisibleSelected(filteredHistory)}
                        ref={(el) => {
                          if (el) el.indeterminate = historySelection.isIndeterminate(filteredHistory);
                        }}
                        onChange={() => historySelection.toggleAllVisible(filteredHistory)}
                        className="rounded border-border text-primary focus:ring-primary size-4 cursor-pointer"
                        title="Select All Returns"
                      />
                    </th>
                    <th className="p-3 whitespace-nowrap">Return ID</th>
                    <th className="p-3 whitespace-nowrap">Original Sale</th>
                    <th className="p-3 whitespace-nowrap">Customer</th>
                    <th className="p-3">Returned Items &amp; Qty</th>
                    <th className="p-3 whitespace-nowrap">Credit Token</th>
                    <th className="p-3 whitespace-nowrap">Credit Issued</th>
                    <th className="p-3 whitespace-nowrap">Credit Used</th>
                    <th className="p-3 whitespace-nowrap">Remaining</th>
                    <th className="p-3 whitespace-nowrap">Status</th>
                    <th className="p-3 whitespace-nowrap">Linked Sale</th>
                    <th className="p-3 whitespace-nowrap">Date &amp; Time</th>
                    <th className="p-3 text-right whitespace-nowrap">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {isHistoryLoading ? (
                    <tr>
                      <td colSpan={13} className="p-6 text-center text-muted-foreground">
                        Loading return records...
                      </td>
                    </tr>
                  ) : filteredHistory.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="p-6 text-center text-muted-foreground">
                        No return records found.
                      </td>
                    </tr>
                  ) : (
                    filteredHistory.map((ret) => {
                      const issued = Number(ret.refund_amount || 0);
                      const used = Number(ret.credit_used || 0);
                      const remaining = Number(
                        ret.credit_balance !== undefined && ret.credit_balance !== null
                          ? ret.credit_balance
                          : Math.max(0, issued - used),
                      );
                      const isFullyRedeemed = used >= issued && issued > 0;
                      const isPartiallyUsed = used > 0 && !isFullyRedeemed;
                      const isRowSelected = historySelection.isSelected(ret.id);

                      return (
                        <tr
                          key={ret.id}
                          className={`hover:bg-muted/20 transition-colors ${
                            isRowSelected ? "bg-primary/5 dark:bg-primary/10" : ""
                          }`}
                        >
                          <td className="p-3 w-10 text-center" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isRowSelected}
                              onChange={() => historySelection.toggle(ret.id)}
                              className="rounded border-border text-primary focus:ring-primary size-4 cursor-pointer"
                            />
                          </td>
                          <td className="p-3 font-mono font-bold text-primary whitespace-nowrap">
                            {ret.return_number}
                          </td>
                          <td className="p-3 font-mono text-[11px] text-foreground whitespace-nowrap">
                            {ret.original_sale_number ? (
                              <span className="font-bold text-foreground">
                                {ret.original_sale_number}
                              </span>
                            ) : ret.original_sale_id ? (
                              <span className="text-muted-foreground">
                                #{ret.original_sale_id.substring(0, 8).toUpperCase()}
                              </span>
                            ) : (
                              <span className="text-muted-foreground italic">Walk-in</span>
                            )}
                          </td>
                          <td className="p-3 whitespace-nowrap">
                            <p className="font-semibold text-foreground">{ret.customer_name}</p>
                            {ret.customer_phone && (
                              <p className="text-[10px] text-muted-foreground font-mono">
                                {ret.customer_phone}
                              </p>
                            )}
                          </td>
                          <td className="p-3 max-w-xs">
                            <div className="space-y-0.5">
                              {(ret.offline_return_items ?? []).length > 0 ? (
                                ret.offline_return_items!.map((it, idx) => (
                                  <p
                                    key={idx}
                                    className="text-[11px] text-foreground font-medium truncate"
                                    title={`${it.name} (${it.qty}x)`}
                                  >
                                    {it.name}{" "}
                                    <span className="text-muted-foreground font-bold font-mono">
                                      ×{it.qty}
                                    </span>
                                  </p>
                                ))
                              ) : (
                                <span className="text-muted-foreground italic text-[11px]">
                                  Items restocked
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-3 font-mono font-bold text-foreground whitespace-nowrap">
                            {ret.credit_token ? (
                              <span className="px-1.5 py-0.5 rounded bg-muted font-mono font-black text-foreground border border-border/80">
                                {ret.credit_token}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="p-3 font-black text-foreground whitespace-nowrap">
                            {formatPrice(issued)}
                          </td>
                          <td className="p-3 font-bold text-muted-foreground whitespace-nowrap">
                            {formatPrice(used)}
                          </td>
                          <td className="p-3 font-black text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                            {formatPrice(remaining)}
                          </td>
                          <td className="p-3 whitespace-nowrap">
                            {isFullyRedeemed ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">
                                Fully Redeemed
                              </span>
                            ) : isPartiallyUsed ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/20">
                                Partially Used
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">
                                Credit Issued
                              </span>
                            )}
                          </td>
                          <td className="p-3 font-mono text-[11px] whitespace-nowrap">
                            {ret.linked_sale_id ? (
                              <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold border border-primary/20">
                                #{ret.linked_sale_id.substring(0, 8).toUpperCase()}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="p-3 text-muted-foreground whitespace-nowrap text-[11px]">
                            {new Date(ret.created_at).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          <td className="p-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5 justify-end">
                              <button
                                type="button"
                                onClick={() => {
                                  const receiptData: ReturnReceiptData = {
                                    return_number: ret.return_number,
                                    credit_token: ret.credit_token || "",
                                    customer_name: ret.customer_name,
                                    customer_phone: ret.customer_phone,
                                    items: (ret.offline_return_items || []).map((i) => ({
                                      name: i.name,
                                      sku: i.sku,
                                      barcode: i.barcode,
                                      variant_info: i.variant_info,
                                      qty: i.qty,
                                      refund_price: i.refund_price,
                                      subtotal: i.subtotal || i.refund_price * i.qty,
                                    })),
                                    refund_amount: ret.refund_amount,
                                    credit_used: ret.credit_used ?? 0,
                                    credit_balance:
                                      ret.credit_balance ??
                                      Math.max(0, ret.refund_amount - (ret.credit_used ?? 0)),
                                    original_sale_number: ret.original_sale_number,
                                    original_sale_id: ret.original_sale_id,
                                    linked_sale_id: ret.linked_sale_id,
                                    refund_method: "exchange_credit",
                                    return_reason: ret.return_reason,
                                    notes: ret.notes,
                                    created_at: ret.created_at,
                                  };
                                  setActiveReceipt(receiptData);
                                }}
                                className="px-2.5 py-1 rounded-lg bg-muted hover:bg-muted/80 text-foreground font-bold text-[11px] cursor-pointer inline-flex items-center gap-1 shadow-2xs transition-colors"
                              >
                                <Printer className="size-3" />
                                <span>Voucher</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => setDeleteTarget([ret.id])}
                                className="p-1 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition cursor-pointer"
                                title="Delete Return Record"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE RETURN CONFIRMATION DIALOG ── */}
      {deleteTarget && (
        <ConfirmDialog
          title={
            deleteTarget.length === 1
              ? "Delete Return Record?"
              : `Delete ${deleteTarget.length} Return Records?`
          }
          message="Are you sure you want to permanently delete these offline return records? Associated voucher tokens will be removed from circulation."
          confirmLabel={deleteReturnsMutation.isPending ? "Deleting..." : "Yes, Delete"}
          cancelLabel="Cancel"
          destructive
          busy={deleteReturnsMutation.isPending}
          onConfirm={async () => {
            try {
              await deleteReturnsMutation.mutateAsync({
                returnIds: deleteTarget,
                revertStock: false,
              });
              setDeleteTarget(null);
              historySelection.clearSelection();
            } catch {
              // Handled by onError in hook
            }
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* ── CONFIRMATION MODAL ── */}
      {isConfirmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl space-y-5 animate-in zoom-in-95">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Sparkles className="size-5" />
              </div>
              <div>
                <h3 className="font-bold text-foreground text-sm sm:text-base">
                  Confirm Return &amp; Exchange
                </h3>
                <p className="text-xs text-muted-foreground">
                  Generate Exchange Credit Voucher and restock inventory
                </p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-muted/30 border border-border/80 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Customer:</span>
                <span className="font-bold text-foreground">
                  {customerMode === "walkin"
                    ? "Walk-in Customer"
                    : customerName || "Walk-in Customer"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Units to Restock:</span>
                <span className="font-bold text-foreground">+{totalReturnUnits} units</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Settlement:</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400 uppercase">
                  Exchange Credit Voucher
                </span>
              </div>
              <div className="pt-2 border-t border-border/60 flex justify-between items-center text-sm">
                <span className="font-bold text-foreground">Total Credit Value:</span>
                <span className="text-base font-black text-primary">
                  {formatPrice(totalRefundAmount)}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsConfirmModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-border text-xs font-bold text-muted-foreground hover:bg-muted cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleProcessReturn}
                disabled={processReturnMutation.isPending}
                className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-black text-xs hover:bg-primary/90 disabled:opacity-50 transition cursor-pointer shadow-sm flex items-center gap-1.5"
              >
                <Check className="size-4" />
                <span>
                  {processReturnMutation.isPending ? "Issuing..." : "Confirm & Print Voucher"}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PRINT RECEIPT MODAL ── */}
      {activeReceipt && (
        <POSReturnReceipt returnData={activeReceipt} onClose={() => setActiveReceipt(null)} />
      )}
    </div>
  );
}
