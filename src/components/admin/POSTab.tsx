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
  Sparkles,
  Tag,
  Loader2,
  CloudUpload,
  PauseCircle,
  PlayCircle,
  History,
  Percent,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  type Product,
  type ProductVariant,
  mapProduct,
  formatPrice,
  imageFor,
  getColorSwatchImage,
} from "@/lib/store";
import { calculatePOSFinancials, type CouponRule } from "@/lib/pricing-engine";
import {
  invalidateCanonicalReportingQueries,
  notifyPOSSaleChanged,
} from "@/lib/canonical-reporting";
import { broadcastCatalogueChange, invalidateCatalogue } from "@/lib/admin-products";
import clothing from "@/assets/cat-clothing.jpg";
import {
  type POSCartItem,
  type SaleResult,
  type POSTransactionState,
  lookupBarcode,
  usePlaceOfflineSale,
  useSearchPOSCustomers,
  useCreatePOSCustomer,
  calculateDiscount,
  generateIdempotencyKey,
  validatePOSCoupon,
} from "@/lib/pos";
import { searchPOSProducts, type POSSearchResult, type POSSearchVariant } from "@/lib/pos-search";
import { useCustomerStoreCredit, useStoreCreditVoucher } from "@/lib/pos-returns";
import { ThermalReceipt } from "@/components/admin/ThermalReceipt";
import { A4Invoice, type A4InvoiceItem } from "@/components/admin/A4Invoice";
import { PrintLabelsModal } from "@/components/admin/PrintLabelsModal";
import { useSession } from "@/lib/auth";
import { useOfflineSyncStatus, findOfflineProductByCode } from "@/lib/offline-sync-engine";
import { POSTerminalSkeleton } from "@/components/ui/Skeletons";
import { cn } from "@/lib/utils";
import {
  useActivePOSSessions,
  savePOSSession,
  closePOSSession,
  closeAllPOSSessions,
  closePOSSessionsBatch,
  createDefaultSession,
  loadStoredSessionsLocal,
  saveStoredSessionsLocal,
  loadActiveSessionIdLocal,
  saveActiveSessionIdLocal,
  generateSessionNumber,
  ACTIVE_POS_SESSIONS_QUERY_KEY,
  type POSSession,
} from "@/lib/pos-sessions";

type POSStep = "cart" | "checkout" | "success";

const POS_DRAFT_KEY = "zerah_pos_terminal_draft_v1";
const POS_HELD_ORDERS_KEY = "zerah_pos_held_orders_v1";

export type HeldPOSOrder = {
  id: string;
  timestamp: number;
  label: string;
  cart: POSCartItem[];
  discountType: "none" | "percentage" | "fixed";
  discountValue: number;
  customerMode: "walkin" | "existing" | "new";
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerId: string | null;
  storeCreditApplied: number;
  creditTokenInput: string;
  totalAmount: number;
};

export function loadHeldOrders(): HeldPOSOrder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(POS_HELD_ORDERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveHeldOrders(orders: HeldPOSOrder[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(POS_HELD_ORDERS_KEY, JSON.stringify(orders));
  } catch {
    // ignore
  }
}

type POSDraftState = {
  cart: POSCartItem[];
  step: POSStep;
  discountType: "none" | "percentage" | "fixed";
  discountValue: number;
  appliedCoupon?: CouponRule | null;
  customerMode: "walkin" | "existing" | "new";
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerId: string | null;
  paymentMethod: string;
  storeCreditApplied?: number;
  creditTokenInput?: string;
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
  const [step, setStep] = useState<POSStep>("cart");
  const [txState, setTxState] = useState<POSTransactionState>("DRAFT");
  const [showCloseAllConfirm, setShowCloseAllConfirm] = useState(false);
  const closedSessionIdsRef = useRef<Set<string>>(new Set());
  // Double-click tab rename state
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editTabName, setEditTabName] = useState("");
  const [editTabPhone, setEditTabPhone] = useState("");

  // Multi-Customer POS Session Engine State
  const { data: remoteSessions } = useActivePOSSessions();
  const [sessions, setSessions] = useState<POSSession[]>(() => {
    const local = loadStoredSessionsLocal();
    if (local.length > 0) return local;
    return [createDefaultSession("1")];
  });
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    const saved = loadActiveSessionIdLocal();
    const local = loadStoredSessionsLocal();
    if (saved && local.some((s) => s.id === saved)) return saved;
    return local[0]?.id || "";
  });

  // Persistent Cart state initialized from active session or fallback draft
  const [cart, setCart] = useState<POSCartItem[]>(() => {
    const local = loadStoredSessionsLocal();
    const savedId = loadActiveSessionIdLocal();
    const active = savedId ? local.find((s) => s.id === savedId) : local[0];
    if (active?.items && active.items.length > 0) return active.items;
    const draft = loadPOSDraft();
    return draft?.cart || [];
  });

  // Unified Universal POS Scan & Search State
  const [searchQuery, setSearchQuery] = useState("");
  const productSearch = searchQuery;
  const setProductSearch = setSearchQuery;
  const scanValue = searchQuery;
  const setScanValue = setSearchQuery;
  const [scanLoading, setScanLoading] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = scanInputRef;

  // Quick Order State
  const [quickOrderProduct, setQuickOrderProduct] = useState("");
  const [quickOrderPrice, setQuickOrderPrice] = useState("");

  // Discount state
  const [discountType, setDiscountType] = useState<"none" | "percentage" | "fixed">(() => {
    const local = loadStoredSessionsLocal();
    const savedId = loadActiveSessionIdLocal();
    const active = savedId ? local.find((s) => s.id === savedId) : local[0];
    if (active) return active.discount_type || "none";
    const draft = loadPOSDraft();
    return draft?.discountType || "none";
  });
  const [discountValue, setDiscountValue] = useState<number>(() => {
    const local = loadStoredSessionsLocal();
    const savedId = loadActiveSessionIdLocal();
    const active = savedId ? local.find((s) => s.id === savedId) : local[0];
    if (active) return active.discount_value || 0;
    const draft = loadPOSDraft();
    return draft?.discountValue || 0;
  });

  // Customer state
  const [customerMode, setCustomerMode] = useState<"walkin" | "existing" | "new">(() => {
    const local = loadStoredSessionsLocal();
    const savedId = loadActiveSessionIdLocal();
    const active = savedId ? local.find((s) => s.id === savedId) : local[0];
    if (active) return active.customer_mode || "walkin";
    const draft = loadPOSDraft();
    return draft?.customerMode || "walkin";
  });
  const [customerName, setCustomerName] = useState(() => {
    const local = loadStoredSessionsLocal();
    const savedId = loadActiveSessionIdLocal();
    const active = savedId ? local.find((s) => s.id === savedId) : local[0];
    if (active)
      return active.customer_name === "Walk-in Customer" ? "" : active.customer_name || "";
    const draft = loadPOSDraft();
    return draft?.customerName || "";
  });
  const [customerPhone, setCustomerPhone] = useState(() => {
    const local = loadStoredSessionsLocal();
    const savedId = loadActiveSessionIdLocal();
    const active = savedId ? local.find((s) => s.id === savedId) : local[0];
    if (active) return active.customer_phone || "";
    const draft = loadPOSDraft();
    return draft?.customerPhone || "";
  });
  const [customerEmail, setCustomerEmail] = useState(() => {
    const local = loadStoredSessionsLocal();
    const savedId = loadActiveSessionIdLocal();
    const active = savedId ? local.find((s) => s.id === savedId) : local[0];
    if (active) return active.customer_email || "";
    const draft = loadPOSDraft();
    return draft?.customerEmail || "";
  });
  const [customerId, setCustomerId] = useState<string | null>(() => {
    const local = loadStoredSessionsLocal();
    const savedId = loadActiveSessionIdLocal();
    const active = savedId ? local.find((s) => s.id === savedId) : local[0];
    if (active) return active.customer_id || null;
    const draft = loadPOSDraft();
    return draft?.customerId || null;
  });
  const [customerSearchQuery, setCustomerSearchQuery] = useState("");
  const [customerCity, setCustomerCity] = useState("");

  // Payment state
  const [paymentMethod, setPaymentMethod] = useState<string>(() => {
    const local = loadStoredSessionsLocal();
    const savedId = loadActiveSessionIdLocal();
    const active = savedId ? local.find((s) => s.id === savedId) : local[0];
    if (active) return active.payment_method || "cash";
    const draft = loadPOSDraft();
    return draft?.paymentMethod || "cash";
  });
  const [cashTendered, setCashTendered] = useState<number | "">("");

  // Held Orders State (Local Storage Resilient)
  const [heldOrders, setHeldOrders] = useState<HeldPOSOrder[]>(loadHeldOrders);
  const [isHeldOrdersOpen, setIsHeldOrdersOpen] = useState(false);
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [customerModalSessionId, setCustomerModalSessionId] = useState<string | null>(null);
  const [customerModalTab, setCustomerModalTab] = useState<"existing" | "new" | "walkin">("existing");

  // Store Credit / Exchange Tender State
  const [storeCreditApplied, setStoreCreditApplied] = useState<number>(() => {
    const local = loadStoredSessionsLocal();
    const savedId = loadActiveSessionIdLocal();
    const active = savedId ? local.find((s) => s.id === savedId) : local[0];
    if (active) return active.store_credit_applied || 0;
    const draft = loadPOSDraft();
    return draft?.storeCreditApplied || 0;
  });
  const [creditTokenInput, setCreditTokenInput] = useState<string>(() => {
    const local = loadStoredSessionsLocal();
    const savedId = loadActiveSessionIdLocal();
    const active = savedId ? local.find((s) => s.id === savedId) : local[0];
    if (active) return active.credit_token_input || "";
    const draft = loadPOSDraft();
    return draft?.creditTokenInput || "";
  });
  const [creditDismissedManually, setCreditDismissedManually] = useState<boolean>(false);

  // Keep sessions synchronized with remote Supabase sessions
  useEffect(() => {
    if (remoteSessions) {
      setSessions((prev) => {
        // Exclude any sessions that have been closed/cancelled locally or remotely
        const validRemote = remoteSessions.filter(
          (s) =>
            !closedSessionIdsRef.current.has(s.id) &&
            s.status !== "cancelled" &&
            s.status !== "completed",
        );

        if (validRemote.length === 0) {
          // If remote has no active sessions, retain only non-closed local sessions or fresh default
          const nonClosedPrev = prev.filter((s) => !closedSessionIdsRef.current.has(s.id));
          if (nonClosedPrev.length > 0) {
            saveStoredSessionsLocal(nonClosedPrev);
            return nonClosedPrev;
          }
          const fresh = createDefaultSession("1");
          saveStoredSessionsLocal([fresh]);
          return [fresh];
        }

        const map = new Map<string, POSSession>();
        for (const s of validRemote) {
          map.set(s.id, s);
        }

        // Local sessions merge into remote sessions, but ONLY if not in closed set
        for (const s of prev) {
          if (closedSessionIdsRef.current.has(s.id)) continue;
          const remote = map.get(s.id);
          if (remote) {
            map.set(s.id, {
              ...remote,
              ...s,
              items: s.items && s.items.length > 0 ? s.items : remote.items,
              customer_name: s.customer_name || remote.customer_name,
              customer_phone: s.customer_phone || remote.customer_phone,
              customer_email: s.customer_email || remote.customer_email,
              customer_id: s.customer_id !== undefined ? s.customer_id : remote.customer_id,
              customer_mode: s.customer_mode || remote.customer_mode,
            });
          } else if (s.created_at && Date.now() - new Date(s.created_at).getTime() < 15000) {
            // Newly created locally within 15 seconds, preserve while saving
            map.set(s.id, s);
          }
        }
        const merged = Array.from(map.values());
        saveStoredSessionsLocal(merged);
        return merged;
      });
    }
  }, [remoteSessions]);

  // Ensure activeSessionId points to an existing session
  useEffect(() => {
    if (sessions.length > 0) {
      if (!activeSessionId || !sessions.some((s) => s.id === activeSessionId)) {
        const nextId = sessions[0].id;
        setActiveSessionId(nextId);
        saveActiveSessionIdLocal(nextId);
      }
    }
  }, [sessions, activeSessionId]);

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
        storeCreditApplied,
        creditTokenInput,
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
    storeCreditApplied,
    creditTokenInput,
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

  // Calculations via Master Pricing Engine
  const posFinancials = useMemo(
    () =>
      calculatePOSFinancials({
        items: cart.map((i) => ({ price: i.price, mrp: i.mrp, qty: i.qty })),
        discountType,
        discountValue,
        coupon: null,
      }),
    [cart, discountType, discountValue],
  );

  const subtotal = posFinancials.subtotal;
  const mrpTotal = posFinancials.mrpTotal;
  const productSavings = posFinancials.productSavings;
  const couponDiscount = posFinancials.couponDiscount;
  const discountAmount = posFinancials.discount;
  const total = posFinancials.finalTotal;
  const totalItems = useMemo(() => cart.reduce((acc, item) => acc + item.qty, 0), [cart]);

  // Dedicated Voucher Instrument Query (4-character token scope)
  const { data: voucherData, isFetching: voucherFetching } = useStoreCreditVoucher({
    token: creditTokenInput,
    customerId,
    phone: customerPhone,
  });

  // Authoritative Customer Account Store Credit Query (phone/customerId scope)
  const { data: customerCreditData } = useCustomerStoreCredit({
    customerId,
    phone: customerPhone,
  });

  // Authoritative Available Credit:
  // When a 4-char voucher token is entered, use ONLY that specific voucher's remaining balance.
  // Otherwise, use the customer's account store credit balance.
  const availableCredit = useMemo(() => {
    if (creditTokenInput && creditTokenInput.trim().length >= 4) {
      if (voucherData?.valid) {
        return voucherData.remaining_balance ?? 0;
      }
      return 0;
    }
    return customerCreditData?.available_credit ?? 0;
  }, [creditTokenInput, voucherData, customerCreditData]);

  // Auto-apply store credit as soon as a valid voucher token or customer account balance is resolved
  // Do NOT re-apply if the cashier explicitly removed/dismissed the credit for this session
  useEffect(() => {
    if (
      availableCredit > 0 &&
      total > 0 &&
      storeCreditApplied === 0 &&
      !creditDismissedManually
    ) {
      const applyAmount = Math.min(availableCredit, total);
      setStoreCreditApplied(applyAmount);
      if (creditTokenInput.trim()) {
        toast.success(
          `Exchange Voucher ${creditTokenInput.trim().toUpperCase()} applied: ${formatPrice(applyAmount)}`,
        );
      }
    }
  }, [availableCredit, total, storeCreditApplied, creditTokenInput, creditDismissedManually]);

  // Dynamic re-clamping if total or available credit changes (e.g. cart quantity changes)
  useEffect(() => {
    if (
      storeCreditApplied > 0 &&
      (storeCreditApplied > availableCredit || storeCreditApplied > total)
    ) {
      setStoreCreditApplied(Math.min(availableCredit, total));
    }
  }, [availableCredit, total, storeCreditApplied]);

  // Auto-clamp applied credit to available credit and final total
  const effectiveCreditUsed = useMemo(() => {
    return Math.min(storeCreditApplied, availableCredit, total);
  }, [storeCreditApplied, availableCredit, total]);

  const payableAfterCredit = Math.max(0, total - effectiveCreditUsed);
  const customerRemainingCredit = Math.max(0, availableCredit - effectiveCreditUsed);

  // Real-time Customer Intelligence Profile (Unified Online + Offline History, Total Spend, Recent Orders)
  const { data: customerIntel } = useQuery({
    queryKey: ["pos-customer-intel", customerId],
    enabled: Boolean(customerId),
    queryFn: async () => {
      if (!customerId) return null;
      const { data, error } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: any; error: any }>
      )("get_pos_customer_intel", {
        p_customer_id: customerId,
      });
      if (error || !data) return null;
      return data;
    },
  });

  const changeDue = useMemo(() => {
    if (typeof cashTendered !== "number" || cashTendered < payableAfterCredit) return 0;
    return Math.max(0, cashTendered - payableAfterCredit);
  }, [cashTendered, payableAfterCredit]);

  // Products for manual search (active only, including offline-only items and all variants)
  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: ["pos-products"],
    staleTime: 1000 * 5, // 5s fresh window with instant realtime invalidation
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const [productsRes, costsRes] = await Promise.all([
        supabase
          .from("products")
          .select(
            "id, name, slug, sku, barcode, price, mrp, stock, category, brand, is_active, sales_channel, product_images(public_url, is_primary, sort_order, color, alt_text), product_variants(id, name, sku, stock, price_override, mrp_override, color, size, barcode, image_url)",
          )
          .eq("is_active", true),
        Promise.resolve(
          supabase.from("product_costs").select("product_id, buying_price"),
        ).catch(() => ({ data: [] as { product_id: string; buying_price: number }[], error: null })),
      ]);

      if (productsRes.error) throw productsRes.error;

      const costMap = new Map<string, number>(
        (
          (costsRes as { data?: { product_id: string; buying_price: number }[] | null })?.data || []
        ).map((c) => [c.product_id, Number(c.buying_price || 0)]),
      );

      const mapped = (productsRes.data || []).map((r) => {
        const prod = mapProduct(r as never);
        const cost = costMap.get(prod.uuid) ?? costMap.get(prod.id) ?? 0;
        prod.buyingPrice = cost;
        prod.buying_price = cost;
        prod.product_costs = [{ buying_price: cost }];
        return prod;
      });

      import("@/lib/offline-sync-engine")
        .then((m) => {
          m.cacheFullCatalog(mapped as unknown as Array<Record<string, unknown>>).catch(
            console.error,
          );
        })
        .catch(console.error);
      return mapped;
    },
  });

  // Derive live authoritative stock for any cart item directly from latest catalog query
  const getLiveItemStock = useCallback(
    (item: POSCartItem): number => {
      if (item.isCustom) return 999;
      const cleanSku = item.sku ? item.sku.toLowerCase() : "";
      const cleanBarcode = item.barcode ? item.barcode.toLowerCase() : "";

      const p = products.find(
        (prod) =>
          prod.uuid === item.product_id ||
          prod.id === item.product_id ||
          prod.id === item.slug ||
          (cleanSku && prod.sku?.toLowerCase() === cleanSku) ||
          (cleanBarcode && prod.barcode?.toLowerCase() === cleanBarcode) ||
          prod.variants?.some(
            (v) =>
              (item.variant_id && v.id === item.variant_id) ||
              (cleanSku && v.sku?.toLowerCase() === cleanSku) ||
              (cleanBarcode && v.barcode?.toLowerCase() === cleanBarcode),
          ),
      );
      if (!p) return item.stock ?? 0;
      if (item.variant_id || cleanSku || cleanBarcode) {
        const v = p.variants?.find(
          (varItem) =>
            (item.variant_id && varItem.id === item.variant_id) ||
            (cleanSku && varItem.sku?.toLowerCase() === cleanSku) ||
            (cleanBarcode && varItem.barcode?.toLowerCase() === cleanBarcode),
        );
        if (v) return Number(v.stock ?? 0);
      }
      return Number(p.stock ?? 0);
    },
    [products],
  );

  // Realtime & Cross-tab synchronized inventory listening in POS
  useEffect(() => {
    // 1. Cross-tab BroadcastChannel
    const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("zerah_catalog_sync") : null;
    if (bc) {
      bc.onmessage = (msg) => {
        if (msg.data?.type === "CATALOG_MUTATED") {
          qc.invalidateQueries({ queryKey: ["pos-products"] });
          qc.invalidateQueries({ queryKey: ["admin-products"] });
        }
      };
    }

    // 2. Window event listener
    const handleCatalogEvent = () => {
      qc.invalidateQueries({ queryKey: ["pos-products"] });
      qc.invalidateQueries({ queryKey: ["admin-products"] });
    };
    window.addEventListener("zerah:catalog-updated", handleCatalogEvent);

    // 3. Supabase Realtime Postgres Changes
    const channel = supabase
      .channel("pos-realtime-catalog-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "products" },
        () => {
          qc.invalidateQueries({ queryKey: ["pos-products"] });
          qc.invalidateQueries({ queryKey: ["admin-products"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "product_variants" },
        () => {
          qc.invalidateQueries({ queryKey: ["pos-products"] });
          qc.invalidateQueries({ queryKey: ["admin-products"] });
        },
      )
      .subscribe();

    return () => {
      bc?.close();
      window.removeEventListener("zerah:catalog-updated", handleCatalogEvent);
      supabase.removeChannel(channel);
    };
  }, [qc]);

  // Continuous Cart Inventory Reconciliation with live authoritative database catalog
  useEffect(() => {
    if (!products || products.length === 0) return;
    setCart((prev) => {
      let changed = false;
      const updated = prev.map((item) => {
        if (item.isCustom) return item;
        const liveStock = getLiveItemStock(item);
        const clampedQty = Math.max(0, Math.min(item.qty, liveStock));
        if (item.stock !== liveStock || (item.qty > liveStock && liveStock > 0)) {
          changed = true;
          if (item.qty > liveStock) {
            toast.warning(`Stock changed for "${item.name}". Quantity adjusted to available stock (${liveStock}).`);
          }
          return {
            ...item,
            stock: liveStock,
            qty: clampedQty === 0 && liveStock > 0 ? 1 : clampedQty,
          };
        }
        return item;
      });
      return changed ? updated : prev;
    });
  }, [products, getLiveItemStock]);

  // Live profit calculation: cross-reference buying_price from cart item or from local catalog
  const profitCalc = useMemo(() => {
    let totalCost = 0;
    let hasCostData = false;
    if (!Array.isArray(cart) || cart.length === 0) {
      return { totalCost: 0, profit: 0, marginPct: null, hasCostData: false };
    }
    const catalog = Array.isArray(products) ? products : [];
    for (const item of cart) {
      if (!item) continue;
      let bp = item.buying_price != null ? Number(item.buying_price) : 0;
      // Fallback: look up from locally fetched products catalog (which has product_costs or buyingPrice)
      if ((!bp || bp <= 0) && catalog.length > 0) {
        const found = catalog.find(
          (p) =>
            p?.uuid === item.product_id ||
            p?.id === item.product_id ||
            p?.uuid === item.slug ||
            p?.id === item.slug ||
            (p?.sku && item.sku && p.sku.toLowerCase() === item.sku.toLowerCase()),
        );
        if (found) {
          bp = Number(
            found.buyingPrice ??
              found.buying_price ??
              (found as unknown as { product_costs?: Array<{ buying_price?: number }> })
                ?.product_costs?.[0]?.buying_price ??
              0,
          );
        }
      }
      if (bp > 0) {
        hasCostData = true;
        totalCost += bp * (item.qty || 1);
      }
    }
    const curTotal = typeof total === "number" ? total : 0;
    const profit = curTotal - totalCost;
    const marginPct = totalCost > 0 && curTotal > 0 ? (profit / curTotal) * 100 : null;
    return { totalCost, profit, marginPct, hasCostData };
  }, [cart, total, products]);

  // In-Memory O(1) Instant POS Catalog Index (Barcodes, SKUs, IDs, Variants)
  const productLookupMaps = useMemo(() => {
    const barcodeMap = new Map<
      string,
      { product: Product; variant?: ProductVariant }
    >();
    const skuMap = new Map<
      string,
      { product: Product; variant?: ProductVariant }
    >();
    const idMap = new Map<string, Product>();

    if (Array.isArray(products)) {
      for (const p of products) {
        if (!p) continue;
        if (p.id) idMap.set(p.id.toLowerCase(), p);
        if (p.uuid) idMap.set(p.uuid.toLowerCase(), p);
        const pSlug = (p as unknown as { slug?: string }).slug;
        if (pSlug) idMap.set(String(pSlug).toLowerCase(), p);

        if (p.barcode) {
          barcodeMap.set(p.barcode.trim().toLowerCase(), { product: p });
        }
        if (p.sku) {
          skuMap.set(p.sku.trim().toLowerCase(), { product: p });
        }

        if (p.variants && p.variants.length > 0) {
          for (const v of p.variants) {
            if (v.barcode) {
              barcodeMap.set(v.barcode.trim().toLowerCase(), { product: p, variant: v });
            }
            if (v.sku) {
              skuMap.set(v.sku.trim().toLowerCase(), { product: p, variant: v });
            }
          }
        }
      }
    }

    return { barcodeMap, skuMap, idMap };
  }, [products]);

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

  // Multi-Customer POS Session Handlers
  const handleSwitchSession = (targetSessionId: string) => {
    const target = sessions.find((s) => s.id === targetSessionId);
    if (!target) return;

    // Save outgoing active session first (ONLY if not closed/cancelled)
    const current = sessions.find((s) => s.id === activeSessionId);
    let sessionList = sessions;
    if (
      current &&
      !closedSessionIdsRef.current.has(current.id) &&
      current.status !== "cancelled" &&
      current.status !== "completed"
    ) {
      const updatedCurrent: POSSession = {
        ...current,
        customer_mode: customerMode,
        customer_name:
          customerMode === "walkin" ? "Walk-in Customer" : customerName || "Walk-in Customer",
        customer_phone: customerPhone,
        customer_email: customerEmail,
        customer_id: customerId,
        discount_type: discountType,
        discount_value: discountValue,
        payment_method: paymentMethod,
        store_credit_applied: storeCreditApplied,
        credit_token_input: creditTokenInput,
        subtotal,
        discount_total: discountAmount,
        total,
        items: [...cart],
        updated_at: new Date().toISOString(),
      };
      sessionList = sessions.map((s) => (s.id === current.id ? updatedCurrent : s));
      setSessions(sessionList);
      saveStoredSessionsLocal(sessionList);
      savePOSSession(updatedCurrent).catch(() => {});
    }

    const resolvedTarget = sessionList.find((s) => s.id === targetSessionId) || target;

    setActiveSessionId(targetSessionId);
    saveActiveSessionIdLocal(targetSessionId);

    // Hydrate target session state into active editor
    setCart(resolvedTarget.items || []);
    setCustomerMode(resolvedTarget.customer_mode || "walkin");
    setCustomerName(resolvedTarget.customer_name === "Walk-in Customer" ? "" : resolvedTarget.customer_name || "");
    setCustomerPhone(resolvedTarget.customer_phone || "");
    setCustomerEmail(resolvedTarget.customer_email || "");
    setCustomerId(resolvedTarget.customer_id || null);
    setDiscountType(resolvedTarget.discount_type || "none");
    setDiscountValue(resolvedTarget.discount_value || 0);
    setStoreCreditApplied(resolvedTarget.store_credit_applied || 0);
    setCreditTokenInput(resolvedTarget.credit_token_input || "");
    setCreditDismissedManually(false);
    setPaymentMethod(resolvedTarget.payment_method || "cash");
    setStep("cart");
    setSearchQuery("");
    setTimeout(() => scanInputRef.current?.focus(), 50);
  };

  const handleCreateNewSale = () => {
    // Save current active session (ONLY if not closed/cancelled)
    const current = sessions.find((s) => s.id === activeSessionId);
    let baseSessions = sessions.filter((s) => !closedSessionIdsRef.current.has(s.id));
    if (
      current &&
      !closedSessionIdsRef.current.has(current.id) &&
      current.status !== "cancelled" &&
      current.status !== "completed"
    ) {
      const updatedCurrent: POSSession = {
        ...current,
        customer_mode: customerMode,
        customer_name:
          customerMode === "walkin" ? "Walk-in Customer" : customerName || "Walk-in Customer",
        customer_phone: customerPhone,
        customer_email: customerEmail,
        customer_id: customerId,
        discount_type: discountType,
        discount_value: discountValue,
        payment_method: paymentMethod,
        store_credit_applied: storeCreditApplied,
        credit_token_input: creditTokenInput,
        subtotal,
        discount_total: discountAmount,
        total,
        items: [...cart],
        updated_at: new Date().toISOString(),
      };
      baseSessions = baseSessions.map((s) => (s.id === current.id ? updatedCurrent : s));
      savePOSSession(updatedCurrent).catch(() => {});
    }

    const newSess = createDefaultSession(undefined, baseSessions);
    const updatedSessions = [...baseSessions, newSess];
    setSessions(updatedSessions);
    saveStoredSessionsLocal(updatedSessions);
    setActiveSessionId(newSess.id);
    saveActiveSessionIdLocal(newSess.id);

    // Reset active state for new sale
    setCart([]);
    setCustomerMode("walkin");
    setCustomerName("");
    setCustomerPhone("");
    setCustomerEmail("");
    setCustomerId(null);
    setDiscountType("none");
    setDiscountValue(0);
    setStoreCreditApplied(0);
    setCreditTokenInput("");
    setCreditDismissedManually(false);
    setPaymentMethod("cash");
    setStep("cart");
    setSearchQuery("");

    savePOSSession(newSess).catch(() => {});
    toast.success(`New sale session started (${newSess.session_number})`);
    setTimeout(() => scanInputRef.current?.focus(), 50);
  };

  const handleHoldCurrentOrder = () => {
    if (cart.length === 0) {
      toast.error("Cannot hold an empty cart");
      return;
    }

    const current = sessions.find((s) => s.id === activeSessionId);
    const sessionNum = current?.session_number
      ? current.session_number.replace(/^#/, "")
      : generateSessionNumber(sessions);
    const custName =
      customerMode === "walkin" ? "Walk-in Customer" : customerName || "Walk-in Customer";

    const heldSession: POSSession = {
      id:
        activeSessionId ||
        (typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `sess_${Date.now()}`),
      session_number: sessionNum,
      customer_mode: customerMode,
      customer_name: custName,
      customer_phone: customerPhone,
      customer_email: customerEmail,
      customer_id: customerId,
      status: "held",
      discount_type: discountType,
      discount_value: discountValue,
      payment_method: paymentMethod,
      notes: "",
      store_credit_applied: storeCreditApplied,
      credit_token_input: creditTokenInput,
      subtotal,
      discount_total: discountAmount,
      total,
      items: [...cart],
      held_at: new Date().toISOString(),
      created_at: current?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    savePOSSession(heldSession).catch(() => {});

    // Backward-compatible legacy heldOrders drawer sync
    const legacyHold: HeldPOSOrder = {
      id: heldSession.id,
      timestamp: Date.now(),
      label: `${custName} • ${totalItems} item${totalItems > 1 ? "s" : ""} • ${formatPrice(total)}`,
      cart: [...cart],
      discountType,
      discountValue,
      customerMode,
      customerName,
      customerPhone,
      customerEmail,
      customerId,
      storeCreditApplied,
      creditTokenInput,
      totalAmount: total,
    };
    const updatedHeld = [legacyHold, ...heldOrders.filter((h) => h.id !== heldSession.id)];
    setHeldOrders(updatedHeld);
    saveHeldOrders(updatedHeld);

    // Switch to another draft session or create a new one
    const otherDraft = sessions.find((s) => s.id !== activeSessionId && s.status === "draft");
    if (otherDraft) {
      const updatedSessions = sessions.map((s) => (s.id === activeSessionId ? heldSession : s));
      setSessions(updatedSessions);
      saveStoredSessionsLocal(updatedSessions);
      setActiveSessionId(otherDraft.id);
      saveActiveSessionIdLocal(otherDraft.id);
      setCart(otherDraft.items || []);
      setCustomerMode(otherDraft.customer_mode || "walkin");
      setCustomerName(otherDraft.customer_name === "Walk-in Customer" ? "" : otherDraft.customer_name || "");
      setCustomerPhone(otherDraft.customer_phone || "");
      setCustomerEmail(otherDraft.customer_email || "");
      setCustomerId(otherDraft.customer_id || null);
      setDiscountType(otherDraft.discount_type || "none");
      setDiscountValue(otherDraft.discount_value || 0);
      setStoreCreditApplied(otherDraft.store_credit_applied || 0);
      setCreditTokenInput(otherDraft.credit_token_input || "");
      setPaymentMethod(otherDraft.payment_method || "cash");
      setStep("cart");
      setSearchQuery("");
    } else {
      const newSess = createDefaultSession(undefined, sessions);
      const updatedSessions = sessions
        .map((s) => (s.id === activeSessionId ? heldSession : s))
        .concat(newSess);
      setSessions(updatedSessions);
      saveStoredSessionsLocal(updatedSessions);
      setActiveSessionId(newSess.id);
      saveActiveSessionIdLocal(newSess.id);
      setCart([]);
      setCustomerMode("walkin");
      setCustomerName("");
      setCustomerPhone("");
      setCustomerEmail("");
      setCustomerId(null);
      setDiscountType("none");
      setDiscountValue(0);
      setStoreCreditApplied(0);
      setCreditTokenInput("");
      setPaymentMethod("cash");
      setStep("cart");
      setSearchQuery("");
      savePOSSession(newSess).catch(() => {});
    }

    toast.success(`Cart placed on Hold (${sessionNum})`, {
      description: `${custName} • ${totalItems} items saved. Ready for next customer.`,
    });
    setTimeout(() => scanInputRef.current?.focus(), 50);
  };

  const handleResumeSession = (targetSessionId: string) => {
    const target = sessions.find((s) => s.id === targetSessionId);
    if (!target) return;

    // Save current active if has items
    const current = sessions.find((s) => s.id === activeSessionId);
    if (current && cart.length > 0) {
      const updatedCurrent: POSSession = {
        ...current,
        customer_mode: customerMode,
        customer_name:
          customerMode === "walkin" ? "Walk-in Customer" : customerName || "Walk-in Customer",
        customer_phone: customerPhone,
        customer_email: customerEmail,
        customer_id: customerId,
        discount_type: discountType,
        discount_value: discountValue,
        payment_method: paymentMethod,
        store_credit_applied: storeCreditApplied,
        credit_token_input: creditTokenInput,
        subtotal,
        discount_total: discountAmount,
        total,
        items: [...cart],
        updated_at: new Date().toISOString(),
      };
      savePOSSession(updatedCurrent).catch(() => {});
    }

    const resumed: POSSession = {
      ...target,
      status: "draft",
      held_at: null,
      updated_at: new Date().toISOString(),
    };

    savePOSSession(resumed).catch(() => {});
    const updatedSessions = sessions.map((s) => (s.id === targetSessionId ? resumed : s));
    setSessions(updatedSessions);
    saveStoredSessionsLocal(updatedSessions);

    // Also remove from legacy heldOrders if present
    const updatedHeld = heldOrders.filter((h) => h.id !== targetSessionId);
    setHeldOrders(updatedHeld);
    saveHeldOrders(updatedHeld);

    setActiveSessionId(targetSessionId);
    saveActiveSessionIdLocal(targetSessionId);

    setCart(target.items || []);
    setCustomerMode(target.customer_mode || "walkin");
    setCustomerName(target.customer_name === "Walk-in Customer" ? "" : target.customer_name || "");
    setCustomerPhone(target.customer_phone || "");
    setCustomerEmail(target.customer_email || "");
    setCustomerId(target.customer_id || null);
    setDiscountType(target.discount_type || "none");
    setDiscountValue(target.discount_value || 0);
    setStoreCreditApplied(target.store_credit_applied || 0);
    setCreditTokenInput(target.credit_token_input || "");
    setCreditDismissedManually(false);
    setPaymentMethod(target.payment_method || "cash");
    setStep("cart");
    setSearchQuery("");
    setIsHeldOrdersOpen(false);
    toast.success(`Resumed sale (${target.session_number})`);
    setTimeout(() => scanInputRef.current?.focus(), 50);
  };

  const handleResumeOrder = (held: HeldPOSOrder) => {
    handleResumeSession(held.id);
  };

  const handleDiscardSession = async (sessionId: string) => {
    const sess = sessions.find((s) => s.id === sessionId);
    if (!sess) return;
    const hasItems = (sess.id === activeSessionId ? cart.length : sess.items?.length || 0) > 0;
    if (hasItems) {
      if (
        !window.confirm(
          `Discard sale session ${sess.session_number}? Any unbilled items will be cleared.`,
        )
      ) {
        return;
      }
    }

    // 1. Mark session as closed in local memory tracker immediately
    closedSessionIdsRef.current.add(sessionId);

    // 2. Immediately remove from React Query cache synchronously
    qc.setQueryData<POSSession[]>(ACTIVE_POS_SESSIONS_QUERY_KEY, (prev) =>
      prev ? prev.filter((s) => s.id !== sessionId) : [],
    );

    // 3. Persist terminal status in Supabase
    closePOSSession(sessionId).catch(() => {});

    // 4. Update local sessions list
    const updatedSessions = sessions.filter((s) => s.id !== sessionId);

    if (sessionId === activeSessionId) {
      if (updatedSessions.length > 0) {
        const next = updatedSessions[0];
        setSessions(updatedSessions);
        saveStoredSessionsLocal(updatedSessions);
        setActiveSessionId(next.id);
        saveActiveSessionIdLocal(next.id);

        // Hydrate next session directly WITHOUT calling handleSwitchSession (which would save the closed session!)
        setCart(next.items || []);
        setCustomerMode(next.customer_mode || "walkin");
        setCustomerName(next.customer_name === "Walk-in Customer" ? "" : next.customer_name || "");
        setCustomerPhone(next.customer_phone || "");
        setCustomerEmail(next.customer_email || "");
        setCustomerId(next.customer_id || null);
        setDiscountType(next.discount_type || "none");
        setDiscountValue(next.discount_value || 0);
        setStoreCreditApplied(next.store_credit_applied || 0);
        setCreditTokenInput(next.credit_token_input || "");
        setCreditDismissedManually(false);
        setPaymentMethod(next.payment_method || "cash");
        setStep("cart");
        setSearchQuery("");
      } else {
        const fresh = createDefaultSession("1");
        setSessions([fresh]);
        saveStoredSessionsLocal([fresh]);
        setActiveSessionId(fresh.id);
        saveActiveSessionIdLocal(fresh.id);
        resetPOS();
        savePOSSession(fresh).catch(() => {});
      }
    } else {
      setSessions(updatedSessions);
      saveStoredSessionsLocal(updatedSessions);
    }

    const updatedHeld = heldOrders.filter((h) => h.id !== sessionId);
    setHeldOrders(updatedHeld);
    saveHeldOrders(updatedHeld);

    // 5. Reconcile with Supabase in background
    closePOSSession(sessionId).catch(() => {});
    qc.invalidateQueries({ queryKey: ACTIVE_POS_SESSIONS_QUERY_KEY });

    toast.info(`Sale ${sess.session_number} discarded`);
    setTimeout(() => scanInputRef.current?.focus(), 50);
  };

  const handleDiscardAllSessions = async () => {
    setShowCloseAllConfirm(false);
    const count = sessions.length;

    // 1. Mark all existing session IDs as closed in memory tracker
    for (const s of sessions) {
      closedSessionIdsRef.current.add(s.id);
    }

    // 2. Create single clean default session #1
    const fresh = createDefaultSession("1");
    closeAllPOSSessions(fresh.id).catch(() => {});

    // 3. Immediately set query cache to only the fresh session
    qc.setQueryData<POSSession[]>(ACTIVE_POS_SESSIONS_QUERY_KEY, [fresh]);

    // 4. Update local React state and storage synchronously
    setSessions([fresh]);
    saveStoredSessionsLocal([fresh]);
    setActiveSessionId(fresh.id);
    saveActiveSessionIdLocal(fresh.id);

    // Reset all POS inputs & cart state
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
    setStoreCreditApplied(0);
    setCreditTokenInput("");
    setCreditDismissedManually(false);
    setStep("cart");
    setSaleResult(null);
    setSaleItems([]);
    setIdempotencyKey(generateIdempotencyKey());

    // Clear held orders
    setHeldOrders([]);
    saveHeldOrders([]);

    // Clear draft in localStorage
    try {
      localStorage.removeItem(POS_DRAFT_KEY);
    } catch {
      // ignore
    }

    // 5. Execute atomic server-side cancellation of all previous sessions
    await closeAllPOSSessions(fresh.id);

    // 6. Save the fresh session to Supabase
    await savePOSSession(fresh);

    // 7. Invalidate query cache to reconcile
    qc.invalidateQueries({ queryKey: ACTIVE_POS_SESSIONS_QUERY_KEY });

    toast.success(`Deleted all ${count} sale tabs. Fresh sale ready!`);
    setTimeout(() => scanInputRef.current?.focus(), 50);
  };

  const handleDeleteHeldOrder = (id: string) => {
    handleDiscardSession(id);
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

  // Dedicated handler to add variant or product from POS search directly into the cart
  const addPOSResultToCart = useCallback(
    (product: POSSearchResult, variant?: POSSearchVariant) => {
      const selectedVar =
        variant ||
        (product.matched_variant_id
          ? product.variants.find((v) => v.id === product.matched_variant_id)
          : undefined) ||
        product.variants.find((v) => v.stock > 0) ||
        product.variants[0];

      const stock = selectedVar ? selectedVar.stock : product.stock;

      if (stock <= 0) {
        playScanError();
        toast.error(
          `"${product.name}${selectedVar?.name && selectedVar.name !== "Default" ? ` (${selectedVar.name})` : ""}" is out of stock`,
          { description: "Cannot add out-of-stock items to a new POS sale." },
        );
        return false;
      }

      const varName =
        selectedVar && selectedVar.name && selectedVar.name !== "Default"
          ? ` - ${selectedVar.name}`
          : "";

      const itemPrice = selectedVar?.price ?? product.price;
      const itemMrp = selectedVar?.mrp ?? product.mrp ?? itemPrice;
      const itemSku = selectedVar?.sku || product.sku;
      const itemBarcode = selectedVar?.barcode || product.barcode || "";
      const itemImage = selectedVar?.image_url || product.image_url;

      const matchedProd = products.find(
        (p) => p.uuid === product.id || p.id === product.id || (p as any).slug === product.id || p.id === product.slug || p.uuid === product.slug,
      );
      const resBuyingPrice =
        Number(
          (product as unknown as { buying_price?: number; buyingPrice?: number }).buying_price ??
          (product as unknown as { buying_price?: number; buyingPrice?: number }).buyingPrice ??
          matchedProd?.buyingPrice ??
          matchedProd?.buying_price ??
          0,
        ) || null;

      const added = addToCart({
        product_id: product.id,
        variant_id: selectedVar?.id || "",
        slug: product.slug || product.id,
        name: `${product.name}${varName}`,
        brand: product.brand || "Zérah Baby & Kids",
        category: product.category || "Clothing",
        age_group: "All",
        price: itemPrice,
        mrp: itemMrp,
        stock: stock,
        sku: itemSku,
        barcode: itemBarcode,
        image_url: itemImage,
        qty: 1,
        buying_price: resBuyingPrice,
        sales_channel: (product.sales_channel || "ONLINE_AND_OFFLINE") as
          | "ONLINE_AND_OFFLINE"
          | "OFFLINE_ONLY",
      });

      if (added) {
        playScanSuccess();
        setProductSearch("");
        setIsSearchDropdownOpen(false);
        setActiveSuggestionIndex(0);
        const isOfflineOnly = product.sales_channel === "OFFLINE_ONLY";
        toast.success(`Added: ${product.name}${varName}`, {
          description: `${isOfflineOnly ? "🏪 Offline Only" : "🌐 Online + Store"} • ₹${itemPrice} • Stock: ${stock}`,
        });
        setTimeout(() => scanInputRef.current?.focus(), 50);
        return true;
      }
      return false;
    },
    [products],
  );

  // Scan handler
  const handleScan = useCallback(
    async (code: string) => {
      const cleanCode = code.trim();
      if (!cleanCode) return;
      setScanValue("");

      // ── PRIORITY 1: INSTANT IN-MEMORY LOOKUP (< 1ms, ZERO NETWORK DELAY) ──
      const q = cleanCode.toLowerCase();
      const inMemoryMatch =
        productLookupMaps.barcodeMap.get(q) ||
        productLookupMaps.skuMap.get(q) ||
        (productLookupMaps.idMap.has(q)
          ? { product: productLookupMaps.idMap.get(q)! }
          : undefined);

      if (inMemoryMatch) {
        const { product, variant } = inMemoryMatch;

        if (product.isActive === false) {
          playScanError();
          toast.error(`"${product.name}" is archived and unavailable for sale`, {
            duration: 5000,
          });
          return;
        }

        const stock = variant ? (variant.stock ?? 0) : (product.stock ?? 0);
        if (stock <= 0) {
          playScanError();
          toast.error(
            `"${product.name}${variant?.name && variant.name !== "Default" ? ` (${variant.name})` : ""}" is out of stock!`,
            {
              description: "Cannot add out-of-stock items to a new POS sale.",
            },
          );
          return;
        }

        const price = variant?.priceOverride ?? (variant as any)?.price_override ?? product.price;
        const mrp = variant?.mrpOverride ?? (variant as any)?.mrp_override ?? product.mrp ?? product.price;
        const sku = variant?.sku || product.sku || "";
        const barcode = variant?.barcode || product.barcode || cleanCode;
        const buyingPrice = Number(product.buyingPrice ?? product.buying_price ?? 0) || null;
        const image = variant?.imageUrl ?? (variant as any)?.image_url ?? (product.images?.[0] || null);
        const salesChannel = (product.salesChannel || (product as any).sales_channel || "ONLINE_AND_OFFLINE") as
          | "ONLINE_AND_OFFLINE"
          | "OFFLINE_ONLY";

        const added = addToCart({
          product_id: product.uuid || product.id,
          variant_id: variant?.id || "",
          slug: (product as unknown as { slug?: string }).slug || product.id,
          name: product.name,
          brand: product.brand ?? "",
          category: product.category ?? "",
          price,
          mrp,
          stock,
          sku,
          barcode,
          image_url: image,
          age_group: product.ageGroup ?? "",
          qty: 1,
          buying_price: buyingPrice,
          sales_channel: salesChannel,
        });

        if (added) {
          playScanSuccess();
          const isOfflineOnly = salesChannel === "OFFLINE_ONLY";
          toast.success(
            `Scanned: ${product.name}${variant?.name && variant.name !== "Default" ? ` (${variant.name})` : ""}`,
            {
              description: `₹${price} • ${isOfflineOnly ? "🏪 Offline Only" : "🌐 Online + Store"} • SKU: ${sku || "N/A"} • Stock: ${stock}`,
            },
          );
          setIsSearchDropdownOpen(false);
          setSearchQuery("");
        }
        return;
      }

      // ── PRIORITY 2: ONLINE RPC & AUTHORITATIVE SERVER SEARCH (< 15ms) ──
      setScanLoading(true);
      try {
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

            const matchedProd = products.find(
              (p) => p.uuid === result.product_id || p.id === result.product_id || p.id === result.slug,
            );
            const scannedBuyingPrice =
              Number(result.buying_price ?? matchedProd?.buyingPrice ?? matchedProd?.buying_price ?? 0) || null;

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
              buying_price: scannedBuyingPrice,
              sales_channel: result.sales_channel || "ONLINE_AND_OFFLINE",
            });

            if (added) {
              playScanSuccess();
              const isOfflineOnly = result.sales_channel === "OFFLINE_ONLY";
              toast.success(`Scanned: ${result.name}`, {
                description: `₹${result.price} • ${isOfflineOnly ? "🏪 Offline Only" : "🌐 Online + Store"} • SKU: ${result.sku || "N/A"} • Stock: ${result.stock}`,
              });
              setIsSearchDropdownOpen(false);
              setSearchQuery("");
              return;
            }
          }
        } catch {
          // Fallback to local offline cache
        }

        // ── PRIORITY 3: LOCAL INDEXEDDB CACHE LOOKUP (OFFLINE RESILIENCE) ──
      try {
        const offline = await findOfflineProductByCode(cleanCode);
        if (offline) {
          const v = (offline.matchedVariant || null) as {
            id?: string;
            name?: string;
            price_override?: number | null;
            priceOverride?: number | null;
            mrp_override?: number | null;
            mrpOverride?: number | null;
            stock?: number | null;
            sku?: string | null;
            barcode?: string | null;
            image_url?: string | null;
            imageUrl?: string | null;
          } | null;

          if (offline.is_active === false || offline.isActive === false) {
            playScanError();
            toast.error(`"${offline.name}" is archived and unavailable for sale`, {
              duration: 5000,
            });
            return;
          }

          const stock = Number(v ? (v.stock ?? 0) : (offline.stock ?? 0));
          if (stock <= 0) {
            playScanError();
            toast.error(`"${offline.name}" is out of stock!`);
            return;
          }

          const price = Number(v?.price_override ?? v?.priceOverride ?? offline.price ?? 0);
          const mrp = Number(v?.mrp_override ?? v?.mrpOverride ?? offline.mrp ?? price);
          const sku = String(v?.sku || offline.sku || "");
          const barcode = String(v?.barcode || offline.barcode || cleanCode);
          const buyingPrice = Number(offline.buying_price ?? offline.buyingPrice ?? 0) || null;
          const image =
            v?.image_url ||
            v?.imageUrl ||
            (Array.isArray(offline.images) ? (offline.images[0] as string) : null) ||
            null;
          const salesChannel = (offline.sales_channel || "ONLINE_AND_OFFLINE") as
            | "ONLINE_AND_OFFLINE"
            | "OFFLINE_ONLY";

          const added = addToCart({
            product_id: String(offline.uuid || offline.id),
            variant_id: v?.id || "",
            slug: String(offline.slug || offline.id),
            name: String(offline.name || ""),
            brand: String(offline.brand || ""),
            category: String(offline.category || ""),
            price,
            mrp,
            stock,
            sku,
            barcode,
            image_url: image,
            age_group: String(offline.age_group || ""),
            qty: 1,
            buying_price: buyingPrice,
            sales_channel: salesChannel,
          });

          if (added) {
            playScanSuccess();
            toast.success(`Scanned: ${offline.name}`, {
              description: `₹${price} • SKU: ${sku || "N/A"} • Stock: ${stock}`,
            });
            setIsSearchDropdownOpen(false);
            setSearchQuery("");
            return;
          }
        }
      } catch {
        // Both online and offline lookups exhausted
      }

        // Fallback: search via server-side POS search engine (fuzzy, SKU, barcode, variants)
        const searchMatches = await searchPOSProducts(cleanCode, 5);
        if (searchMatches.length > 0) {
          const topMatch = searchMatches[0];
          const exactVar = topMatch.variants.find(
            (v) =>
              (v.barcode && v.barcode === cleanCode) ||
              (v.sku && v.sku.toLowerCase() === cleanCode.toLowerCase()),
          );
          if (topMatch.match_score >= 80 || exactVar || searchMatches.length === 1) {
            const added = addPOSResultToCart(topMatch, exactVar);
            if (added) {
              setIsSearchDropdownOpen(false);
              setSearchQuery("");
              return;
            }
          }

          setProductSearch(cleanCode);
          setIsSearchDropdownOpen(true);
          toast.info(
            `Found ${searchMatches.length} product${searchMatches.length > 1 ? "s" : ""} matching "${cleanCode}"`,
          );
          return;
        }

        // Secondary fallback: search in loaded local products catalog
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
          setIsSearchDropdownOpen(false);
          setSearchQuery("");
          return;
        }

        if (localMatches.length > 1) {
          setProductSearch(cleanCode);
          setIsSearchDropdownOpen(true);
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
    [productLookupMaps, products, addProductManually, addPOSResultToCart],
  );

  // Hook into centralized hardware scanner events (also drains queued scans on mount)
  useGlobalBarcodeScanner(handleScan);

  function addToCart(item: POSCartItem): boolean {
    let added = true;
    const currentStock = getLiveItemStock(item);
    if (currentStock <= 0 && !item.isCustom) {
      playScanError();
      toast.error(`Cannot add "${item.name}". Item is out of stock.`);
      return false;
    }
    setCart((prev) => {
      const existing = prev.find(
        (p) => p.product_id === item.product_id && (p.variant_id || "") === (item.variant_id || ""),
      );
      if (existing) {
        if (existing.qty >= currentStock && !item.isCustom) {
          playScanError();
          toast.error(`Cannot add more "${item.name}". Only ${currentStock} in stock.`);
          added = false;
          return prev;
        }
        return prev.map((p) =>
          p.product_id === item.product_id && (p.variant_id || "") === (item.variant_id || "")
            ? { ...p, stock: currentStock, qty: p.qty + 1 }
            : p,
        );
      }
      return [...prev, { ...item, stock: currentStock, qty: 1 }];
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
      buying_price: (() => {
        const bp = product.buyingPrice ?? product.buying_price;
        if (bp !== undefined && bp !== null && Number(bp) > 0) return Number(bp);
        const costs = (product as unknown as Record<string, unknown>).product_costs;
        if (Array.isArray(costs)) return Number((costs[0] as { buying_price?: number })?.buying_price || 0) || null;
        if (costs && typeof costs === "object") return Number((costs as { buying_price?: number }).buying_price || 0) || null;
        return null;
      })(),
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
          const liveStock = getLiveItemStock(p);
          const clamped = Math.max(1, Math.min(liveStock, newQty));
          if (newQty > liveStock && !p.isCustom) {
            toast.error(`Only ${liveStock} available for "${p.name}"`);
          }
          return { ...p, stock: liveStock, qty: clamped };
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

  function updateItemPrice(productId: string, newPrice: number, variantId?: string) {
    setCart((prev) => {
      const updated = prev.map((p) => {
        if (p.product_id === productId && (p.variant_id || "") === (variantId || "")) {
          const validPrice = Math.max(0, isNaN(newPrice) ? 0 : newPrice);
          return {
            ...p,
            price: validPrice,
            isCustom: true,
          };
        }
        return p;
      });

      if (activeSessionId) {
        setSessions((sPrev) => {
          const sUpdated = sPrev.map((s) =>
            s.id === activeSessionId
              ? {
                  ...s,
                  items: [...updated],
                  subtotal: updated.reduce((acc, item) => acc + item.price * item.qty, 0),
                  updated_at: new Date().toISOString(),
                }
              : s,
          );
          saveStoredSessionsLocal(sUpdated);
          return sUpdated;
        });
      }

      return updated;
    });
  }

  function handleAssignCustomer(
    cust: {
      id?: string | null;
      name: string;
      phone?: string;
      email?: string;
      city?: string;
    },
    targetSessionId?: string | null,
  ) {
    const cId = cust.id || null;
    const cName = cust.name.trim();
    const cPhone = cust.phone ? cust.phone.trim() : "";
    const cEmail = cust.email ? cust.email.trim() : "";
    const effectiveSessionId = targetSessionId || customerModalSessionId || activeSessionId;
    const mode: "walkin" | "existing" | "new" = cId ? "existing" : cName ? "new" : "walkin";

    if (effectiveSessionId === activeSessionId) {
      setCustomerId(cId);
      setCustomerName(cName);
      setCustomerPhone(cPhone);
      setCustomerEmail(cEmail);
      setCustomerMode(mode);
    }

    if (effectiveSessionId) {
      setSessions((prev) => {
        const targetSession = prev.find((s) => s.id === effectiveSessionId);
        const updatedSess = targetSession
          ? {
              ...targetSession,
              customer_id: cId,
              customer_name: cName || "Walk-in Customer",
              customer_phone: cPhone,
              customer_email: cEmail,
              customer_mode: mode,
              updated_at: new Date().toISOString(),
            }
          : null;
        if (updatedSess) {
          savePOSSession(updatedSess).catch(() => {});
        }
        const updated = prev.map((s) =>
          s.id === effectiveSessionId ? (updatedSess || s) : s,
        );
        saveStoredSessionsLocal(updated);
        return updated;
      });
    }
  }

  function handleSetWalkin(targetSessionId?: string | null) {
    const effectiveSessionId = targetSessionId || customerModalSessionId || activeSessionId;
    if (effectiveSessionId === activeSessionId) {
      setCustomerId(null);
      setCustomerName("");
      setCustomerPhone("");
      setCustomerEmail("");
      setCustomerMode("walkin");
      setStoreCreditApplied(0);
      setCreditDismissedManually(false);
    }

    if (effectiveSessionId) {
      setSessions((prev) => {
        const targetSession = prev.find((s) => s.id === effectiveSessionId);
        const updatedSess = targetSession
          ? {
              ...targetSession,
              customer_id: null,
              customer_name: "Walk-in Customer",
              customer_phone: "",
              customer_email: "",
              customer_mode: "walkin" as const,
              store_credit_applied: 0,
              updated_at: new Date().toISOString(),
            }
          : null;
        if (updatedSess) {
          savePOSSession(updatedSess).catch(() => {});
        }
        const updated = prev.map((s) =>
          s.id === effectiveSessionId ? (updatedSess || s) : s,
        );
        saveStoredSessionsLocal(updated);
        return updated;
      });
    }
  }

  function handleCancelCart() {
    // 1. Immediately empty active cart
    setCart([]);
    setDiscountType("none");
    setDiscountValue(0);
    setStoreCreditApplied(0);
    setCreditTokenInput("");
    setCashTendered("");
    setCustomerSearchQuery("");
    setProductSearch("");
    setScanValue("");

    // 2. Also clear items in active session
    if (activeSessionId) {
      setSessions((prev) => {
        const updated = prev.map((s) =>
          s.id === activeSessionId
            ? {
                ...s,
                items: [],
                subtotal: 0,
                discount_total: 0,
                total: 0,
                updated_at: new Date().toISOString(),
              }
            : s,
        );
        saveStoredSessionsLocal(updated);
        return updated;
      });

      const current = sessions.find((s) => s.id === activeSessionId);
      if (current) {
        savePOSSession({
          ...current,
          items: [],
          subtotal: 0,
          discount_total: 0,
          total: 0,
          updated_at: new Date().toISOString(),
        }).catch(() => {});
      }
    }

    // 3. Clear draft in localStorage
    try {
      localStorage.removeItem(POS_DRAFT_KEY);
    } catch {
      // ignore
    }

    toast.success("Cart cleared");
    setTimeout(() => scanInputRef.current?.focus(), 50);
  }

  // Complete sale
  async function completeSale(overrideCustomerId?: string | null) {
    if (cart.length === 0) {
      toast.error("Cart is empty");
      return;
    }

    // Strict pre-flight stock validation against live authoritative database catalog
    for (const item of cart) {
      if (item.isCustom) continue;
      const liveStock = getLiveItemStock(item);
      if (item.qty > liveStock) {
        toast.error(
          `Insufficient stock for "${item.name}". Available: ${liveStock}, requested: ${item.qty}. Please adjust quantity before checkout.`,
        );
        return;
      }
    }

    const rpcItems = cart.map((item) => {
      const isUuid =
        Boolean(item.product_id) &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          item.product_id || "",
        );
      const isVariantUuid =
        Boolean(item.variant_id) &&
        item.variant_id !== "00000000-0000-0000-0000-000000000000" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          item.variant_id || "",
        );

      const safeSlug = item.isCustom ? `custom-${Date.now()}` : item.slug || "item";
      return {
        product_id: item.isCustom || !isUuid ? undefined : item.product_id,
        variant_id: isVariantUuid ? item.variant_id : undefined,
        product_slug: safeSlug,
        slug: safeSlug,
        name: item.name || "Item",
        sku: item.sku || "",
        barcode: item.barcode || "",
        variant_info: item.variant_info || [item.color, item.size].filter(Boolean).join(" / ") || "",
        qty: item.qty || 1,
        custom_price: item.isCustom ? item.price : undefined,
        price: item.price || 0,
        mrp: item.mrp || item.price || 0,
        cost_price: (() => {
          if (item.buying_price && item.buying_price > 0) return item.buying_price;
          const found = products.find(
            (p) => p.uuid === item.product_id || p.id === item.product_id || p.id === item.slug,
          );
          return Number(found?.buyingPrice ?? found?.buying_price ?? 0);
        })(),
      };
    });

    if (payableAfterCredit > 0 && paymentMethod === "cash") {
      if (typeof cashTendered === "number" && cashTendered < payableAfterCredit) {
        toast.error(
          `Cash tendered (₹${cashTendered}) is less than payable amount (₹${payableAfterCredit})`,
        );
        return;
      }
    }

    const resolvedCustomerId = overrideCustomerId !== undefined ? overrideCustomerId : customerId;

    try {
      setTxState("PROCESSING");
      const result = await placeSale.mutateAsync({
        customer_name:
          customerMode === "walkin" ? "Walk-in Customer" : customerName || "Walk-in Customer",
        customer_phone: customerPhone,
        customer_email: customerEmail,
        payment_method: payableAfterCredit === 0 ? "store_credit" : paymentMethod,
        notes: "",
        discount_type: discountType,
        discount_value: discountValue,
        customer_id: resolvedCustomerId,
        items: rpcItems,
        idempotency_key: idempotencyKey,
        store_credit_used: effectiveCreditUsed,
        credit_token: creditTokenInput.trim() || undefined,
      });

      // Synchronously invalidate and broadcast canonical reporting updates
      invalidateCanonicalReportingQueries(qc);
      invalidateCatalogue(qc);
      broadcastCatalogueChange();
      notifyPOSSaleChanged();

      if (result.duplicate) {
        toast.warning("This sale was already processed on server (duplicate prevented)");
      }

      // Snapshot cart items NOW before any reset for printing
      setSaleItems(
        cart.map((c) => ({ name: c.name, sku: c.sku, price: c.price, mrp: c.mrp, qty: c.qty })),
      );
      setSaleResult({
        ...result,
        total: Math.max(result.total || 0, subtotal - discountAmount),
        payment_method:
          result.payment_method || (payableAfterCredit === 0 ? "store_credit" : paymentMethod),
        store_credit_used: effectiveCreditUsed,
        credit_token_used: creditTokenInput.trim() || undefined,
      });

      // Open receipt or invoice modal based on user's printer format selection (with autoPrint)
      if (printFormat === "a4") {
        setIsA4InvoiceOpen(true);
        setIsReceiptModalOpen(false);
      } else {
        setIsReceiptModalOpen(true);
        setIsA4InvoiceOpen(false);
      }
      setStep("success");

      // Mark completed session closed in Supabase & local state
      if (activeSessionId) {
        closedSessionIdsRef.current.add(activeSessionId);
        closePOSSession(activeSessionId).catch(() => {});
        qc.setQueryData<POSSession[]>(ACTIVE_POS_SESSIONS_QUERY_KEY, (prev) =>
          prev ? prev.filter((s) => s.id !== activeSessionId) : [],
        );
        const remaining = sessions.filter(
          (s) => s.id !== activeSessionId && !closedSessionIdsRef.current.has(s.id),
        );
        if (remaining.length > 0) {
          setSessions(remaining);
          saveStoredSessionsLocal(remaining);
        } else {
          const fresh = createDefaultSession("1");
          setSessions([fresh]);
          saveStoredSessionsLocal([fresh]);
        }
      }

      if (result.status === "pending_sync" || result.is_offline_queued) {
        setTxState("PENDING_SYNC");
        toast.info(`Offline sale saved locally — Pending synchronization (#${result.sale_number})`);
      } else {
        setTxState("COMPLETED");
        toast.success(`Sale completed successfully! #${result.sale_number}`);
      }
    } catch (e) {
      setTxState("FAILED");
      setIdempotencyKey(generateIdempotencyKey());
      const errMsg = e instanceof Error ? e.message : "Sale failed to process";
      if (
        errMsg.toLowerCase().includes("voucher") ||
        errMsg.toLowerCase().includes("redeemed") ||
        errMsg.toLowerCase().includes("token")
      ) {
        setStoreCreditApplied(0);
        setCreditTokenInput("");
        qc.invalidateQueries({ queryKey: ["pos_voucher"] });
      }
      toast.error(errMsg);
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
    setCustomerSearchQuery("");
    setProductSearch("");
    setScanValue("");
    setCashTendered("");
    setStoreCreditApplied(0);
    setCreditTokenInput("");
    setCreditDismissedManually(false);
    setStep("cart");
    setSaleResult(null);
    setSaleItems([]);
    setIdempotencyKey(generateIdempotencyKey());

    // Switch to next remaining active session or create clean fresh session
    const remaining = sessions.filter(
      (s) => s.id !== activeSessionId && !closedSessionIdsRef.current.has(s.id),
    );
    if (remaining.length > 0) {
      const next = remaining[0];
      handleSwitchSession(next.id);
    } else {
      const fresh = createDefaultSession("1");
      setSessions([fresh]);
      saveStoredSessionsLocal([fresh]);
      setActiveSessionId(fresh.id);
      saveActiveSessionIdLocal(fresh.id);
      savePOSSession(fresh).catch(() => {});
    }

    try {
      localStorage.removeItem(POS_DRAFT_KEY);
    } catch {
      // ignore
    }
    setTimeout(() => scanInputRef.current?.focus(), 80);
  }

  // Debounce product search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(productSearch.trim());
      setActiveSuggestionIndex(0);
    }, 200);
    return () => clearTimeout(timer);
  }, [productSearch]);

  // Open dropdown when query changes
  useEffect(() => {
    if (productSearch.trim().length > 0) {
      setIsSearchDropdownOpen(true);
    } else {
      setIsSearchDropdownOpen(false);
    }
  }, [productSearch]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        searchDropdownRef.current &&
        !searchDropdownRef.current.contains(e.target as Node) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(e.target as Node)
      ) {
        setIsSearchDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Server-side POS search with automatic fallback to offline IndexedDB
  const {
    data: searchResults = [],
    isLoading: isSearchLoading,
    isFetching: isSearchFetching,
  } = useQuery({
    queryKey: ["pos-server-search", debouncedSearch],
    enabled: debouncedSearch.length >= 1,
    queryFn: () => searchPOSProducts(debouncedSearch, 20),
    staleTime: 1000 * 30, // 30 seconds cache
  });

  // Flattened selectable items for keyboard arrow navigation & Enter selection
  interface SelectableSearchItem {
    product: POSSearchResult;
    variant: POSSearchVariant;
    isOutOfStock: boolean;
    key: string;
  }

  const selectableItems = useMemo<SelectableSearchItem[]>(() => {
    const list: SelectableSearchItem[] = [];
    for (const p of searchResults) {
      if (p.variants && p.variants.length > 0) {
        for (const v of p.variants) {
          list.push({
            product: p,
            variant: v,
            isOutOfStock: v.stock <= 0,
            key: `${p.id}-${v.id}`,
          });
        }
      } else {
        const dummyVar: POSSearchVariant = {
          id: p.id,
          name: "Default",
          sku: p.sku,
          barcode: p.barcode,
          stock: p.stock,
          price: p.price,
          mrp: p.mrp,
          color: null,
          size: null,
          image_url: p.image_url,
          is_matched: true,
        };
        list.push({
          product: p,
          variant: dummyVar,
          isOutOfStock: p.stock <= 0,
          key: `${p.id}-default`,
        });
      }
    }
    return list;
  }, [searchResults]);

  // Customer search results
  useEffect(() => {
    if (customerSearchQuery.trim().length >= 2) {
      searchCustomers.mutate(customerSearchQuery);
    } else {
      searchCustomers.reset();
    }
  }, [customerSearchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <div className="flex items-center gap-3">
            {heldOrders.length > 0 && (
              <button
                type="button"
                onClick={() => setIsHeldOrdersOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-xs font-bold hover:bg-amber-500/20 transition cursor-pointer"
                title="View active held orders"
              >
                <PauseCircle className="size-4 text-amber-600 dark:text-amber-400" />
                <span>Held Carts ({heldOrders.length})</span>
              </button>
            )}
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <Scan className="size-4 text-primary animate-pulse" />
              Scanner Active
            </div>
          </div>
        </div>

        {/* Multi-Customer / Multi-Cart Active Sale Tabs */}
        <div className="flex items-center justify-between border-b border-border/50 bg-background/95 px-4 py-2 gap-2 overflow-x-auto">
          <div className="flex items-center gap-2 min-w-0 overflow-x-auto py-1">
            {sessions.map((sess, idx) => {
              const isActive = sess.id === activeSessionId;
              const isHeld = sess.status === "held";
              const itemCount = isActive
                ? totalItems
                : sess.items?.reduce((a, b) => a + (b.qty || 1), 0) || 0;
              const displayTotal = isActive ? total : sess.total || 0;
              const custName = isActive
                ? customerMode === "walkin"
                  ? "Walk-in"
                  : customerName || "Walk-in"
                : sess.customer_mode === "walkin"
                  ? "Walk-in"
                  : sess.customer_name || "Walk-in";

              const rawNum = String(sess.session_number || "").replace(/^#/, "");
              const isLegacy = !rawNum || /^\d{4,}$/.test(rawNum);
              const tabNumber = isLegacy ? String(idx + 1) : rawNum;

              const isEditingThis = editingTabId === sess.id;

              return (
                <div key={sess.id} className="relative shrink-0">
                  {/* Inline rename popover — appears above tab on double-click */}
                  {isEditingThis && (
                    <div
                      className="absolute bottom-full left-0 mb-1.5 z-50 w-64 rounded-xl border border-primary/30 bg-card shadow-xl p-3 flex flex-col gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Customer Details</p>
                      <input
                        autoFocus
                        type="text"
                        value={editTabName}
                        onChange={(e) => setEditTabName(e.target.value)}
                        placeholder="Customer name"
                        className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const name = editTabName.trim();
                            const phone = editTabPhone.trim();
                            if (sess.id === activeSessionId) {
                              setCustomerName(name);
                              setCustomerPhone(phone);
                              if (name) setCustomerMode("new");
                            }
                            setSessions((prev) =>
                              prev.map((s) =>
                                s.id === sess.id
                                  ? { ...s, customer_name: name || "Walk-in Customer", customer_mode: name ? "new" : "walkin" }
                                  : s,
                              ),
                            );
                            setEditingTabId(null);
                          }
                          if (e.key === "Escape") setEditingTabId(null);
                        }}
                      />
                      <input
                        type="tel"
                        value={editTabPhone}
                        onChange={(e) => setEditTabPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                        placeholder="Phone (optional)"
                        className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const name = editTabName.trim();
                            const phone = editTabPhone.trim();
                            if (sess.id === activeSessionId) {
                              setCustomerName(name);
                              setCustomerPhone(phone);
                              if (name) setCustomerMode("new");
                            }
                            setSessions((prev) =>
                              prev.map((s) =>
                                s.id === sess.id
                                  ? { ...s, customer_name: name || "Walk-in Customer", customer_mode: name ? "new" : "walkin" }
                                  : s,
                              ),
                            );
                            setEditingTabId(null);
                          }
                          if (e.key === "Escape") setEditingTabId(null);
                        }}
                      />
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          className="flex-1 rounded-lg bg-primary py-1.5 text-[11px] font-bold text-primary-foreground hover:bg-primary/90 transition cursor-pointer"
                          onClick={() => {
                            const name = editTabName.trim();
                            const phone = editTabPhone.trim();
                            if (sess.id === activeSessionId) {
                              setCustomerName(name);
                              setCustomerPhone(phone);
                              if (name) setCustomerMode("new");
                            }
                            setSessions((prev) =>
                              prev.map((s) =>
                                s.id === sess.id
                                  ? { ...s, customer_name: name || "Walk-in Customer", customer_mode: name ? "new" : "walkin" }
                                  : s,
                              ),
                            );
                            setEditingTabId(null);
                          }}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-muted-foreground hover:bg-muted transition cursor-pointer"
                          onClick={() => setEditingTabId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  <div
                    className={cn(
                      "group relative inline-flex items-center rounded-xl border text-xs font-semibold transition-all shrink-0 cursor-pointer select-none",
                      isActive
                        ? "bg-primary text-primary-foreground border-primary shadow-sm ring-1 ring-primary/30"
                        : isHeld
                          ? "bg-amber-500/10 text-amber-800 dark:text-amber-200 border-amber-500/30 hover:bg-amber-500/20"
                          : "bg-card text-foreground border-border hover:bg-muted/60",
                    )}
                    onClick={() => {
                      if (editingTabId) return;
                      if (isHeld) {
                        handleResumeSession(sess.id);
                      } else if (!isActive) {
                        handleSwitchSession(sess.id);
                      }
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (!isActive) {
                        handleSwitchSession(sess.id);
                      }
                      setCustomerModalSessionId(sess.id);
                      const currentName =
                        sess.id === activeSessionId
                          ? customerMode === "walkin" ? "" : customerName
                          : sess.customer_mode === "walkin" ? "" : (sess.customer_name === "Walk-in Customer" ? "" : sess.customer_name || "");
                      const currentPhone =
                        sess.id === activeSessionId ? customerPhone : "";
                      setEditTabName(currentName);
                      setEditTabPhone(currentPhone);
                      setCustomerModalTab("existing");
                      setIsCustomerModalOpen(true);
                    }}
                    data-testid={`pos-sale-tab-${tabNumber.replace(/[^a-zA-Z0-9]/g, "")}`}
                    data-status={sess.status}
                    title="Click to switch sale, double-click to assign customer from Supabase"
                  >
                    <div className="flex items-center gap-1.5 px-3 py-1.5">
                      {isHeld && (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-800 dark:text-amber-200"
                          data-testid="pos-held-indicator"
                        >
                          <span className="size-1.5 rounded-full bg-amber-500 shrink-0" />
                          Held
                        </span>
                      )}
                      <span className="font-bold">{tabNumber}</span>
                      {/* Only show customer name if it's NOT walk-in */}
                      {custName !== "Walk-in" && (
                        <span
                          className={cn(
                            "max-w-[90px] truncate font-medium",
                            isActive ? "text-primary-foreground/90" : "text-muted-foreground",
                          )}
                          data-testid="pos-sale-tab-customer"
                        >
                          {custName}
                        </span>
                      )}
                      <span
                        className={cn(
                          "px-1.5 py-0.2 rounded-full text-[10px] font-bold",
                          isActive
                            ? "bg-primary-foreground/20 text-primary-foreground"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {itemCount}
                      </span>
                      {displayTotal > 0 && (
                        <span className="font-bold text-[11px]">{formatPrice(displayTotal)}</span>
                      )}
                    </div>
                    {sessions.length > 1 && (
                      <button
                        type="button"
                        className={cn(
                          "p-1 mr-1 rounded-md opacity-60 hover:opacity-100 transition cursor-pointer",
                          isActive ? "hover:bg-primary-foreground/20" : "hover:bg-muted",
                        )}
                        title="Discard this sale session"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDiscardSession(sess.id);
                        }}
                        data-testid={`pos-discard-sale-${tabNumber.replace(/[^a-zA-Z0-9]/g, "")}`}
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* New Sale Action Button */}
            <button
              type="button"
              onClick={handleCreateNewSale}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 text-primary text-xs font-bold transition shrink-0 cursor-pointer"
              title="Create new independent customer sale"
              data-testid="pos-new-sale-btn"
            >
              <Plus className="size-3.5" />
              <span>New Sale</span>
            </button>


            {/* Delete All Tabs Button (inline in tab bar) */}
            {sessions.length > 1 && !showCloseAllConfirm && (
              <button
                type="button"
                onClick={() => setShowCloseAllConfirm(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-red-500/30 bg-red-500/8 hover:bg-red-500/15 text-red-600 dark:text-red-400 text-xs font-bold transition shrink-0 cursor-pointer"
                title="Delete all sale tabs together and start fresh"
                data-testid="pos-delete-all-tabs-inline-btn"
              >
                <Trash2 className="size-3.5" />
                <span>Delete All</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {sessions.length > 1 && (
              showCloseAllConfirm ? (
                <div className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs animate-in fade-in">
                  <span className="text-[11px] font-bold text-red-600 dark:text-red-400 whitespace-nowrap">
                    Delete all {sessions.length} tabs?
                  </span>
                  <button
                    type="button"
                    onClick={handleDiscardAllSessions}
                    className="rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-red-700 transition cursor-pointer whitespace-nowrap"
                    data-testid="pos-confirm-delete-all-btn"
                  >
                    Yes, Delete All
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCloseAllConfirm(false)}
                    className="rounded-lg border border-border bg-card px-2 py-1 text-[11px] font-bold text-foreground hover:bg-muted transition cursor-pointer whitespace-nowrap"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowCloseAllConfirm(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-500/30 bg-red-500/8 hover:bg-red-500/15 text-red-600 dark:text-red-400 text-xs font-bold transition shrink-0 cursor-pointer"
                  title="Delete all sale tabs together and start fresh"
                  data-testid="pos-delete-all-tabs-btn"
                >
                  <Trash2 className="size-3.5" />
                  <span>Delete All ({sessions.length})</span>
                </button>
              )
            )}

            {cart.length > 0 && (
              <button
                type="button"
                onClick={handleHoldCurrentOrder}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-xs font-bold hover:bg-amber-500/20 transition cursor-pointer"
                title="Hold current sale and switch to next customer"
                data-testid="pos-hold-sale-btn"
              >
                <PauseCircle className="size-3.5 text-amber-600 dark:text-amber-400" />
                <span>Hold Sale</span>
              </button>
            )}
          </div>
        </div>

        {/* Unified Universal Scan & Search Input */}
        {step === "cart" && (
          <div className="p-4 border-b border-border/50 bg-card">
            <div className="relative" ref={searchDropdownRef}>
              <div className="relative flex items-center">
                <Scan className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-primary animate-pulse pointer-events-none" />
                <input
                  ref={scanInputRef}
                  type="text"
                  value={searchQuery}
                  onFocus={() => {
                    if (searchQuery.trim().length > 0) setIsSearchDropdownOpen(true);
                  }}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSearchQuery(val);
                    if (!isSearchDropdownOpen && val.trim().length > 0) {
                      setIsSearchDropdownOpen(true);
                    }
                  }}
                  onKeyDown={async (e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      if (selectableItems.length > 0) {
                        setActiveSuggestionIndex((prev) =>
                          prev < selectableItems.length - 1 ? prev + 1 : 0,
                        );
                      }
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      if (selectableItems.length > 0) {
                        setActiveSuggestionIndex((prev) =>
                          prev > 0 ? prev - 1 : selectableItems.length - 1,
                        );
                      }
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      const clean = searchQuery.trim();
                      if (!clean) return;

                      // 1. Check exact barcode or SKU match first (priority for scanner burst or exact SKU typing)
                      const qLower = clean.toLowerCase();
                      const exactMatch =
                        productLookupMaps.barcodeMap.get(qLower) ||
                        productLookupMaps.skuMap.get(qLower) ||
                        productLookupMaps.idMap.get(qLower);

                      if (exactMatch) {
                        await handleScan(clean);
                        setIsSearchDropdownOpen(false);
                        setSearchQuery("");
                        return;
                      }

                      // 2. If suggestions dropdown is open with suggestions, add highlighted item
                      if (isSearchDropdownOpen && selectableItems.length > 0) {
                        const target = selectableItems[activeSuggestionIndex] || selectableItems[0];
                        if (target.isOutOfStock) {
                          playScanError();
                          toast.error(
                            `"${target.product.name}${target.variant.name !== "Default" ? ` (${target.variant.name})` : ""}" is out of stock!`,
                          );
                          return;
                        }
                        addPOSResultToCart(target.product, target.variant);
                        setIsSearchDropdownOpen(false);
                        setSearchQuery("");
                        return;
                      }

                      // 3. Barcode scanner fast Enter or direct SKU enter
                      await handleScan(clean);
                      setIsSearchDropdownOpen(false);
                      setSearchQuery("");
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setIsSearchDropdownOpen(false);
                      setSearchQuery("");
                      scanInputRef.current?.focus();
                    }
                  }}
                  placeholder="Scan barcode, or search by product name, SKU, variant, color (Enter to add)…"
                  aria-label="POS Universal Scan and Search Bar"
                  className="focus-ring w-full rounded-2xl border border-border/80 bg-card pl-12 pr-32 py-3.5 text-base sm:text-lg font-bold outline-none focus:border-primary focus:ring-4 focus:ring-primary/20 shadow-premium-sm hover:shadow-premium-md transition-all placeholder:text-muted-foreground/60 placeholder:font-normal placeholder:text-sm sm:placeholder:text-base"
                  autoFocus
                />

                {/* Right Action / Loading indicators */}
                <div className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  {(isSearchLoading ||
                    (isSearchFetching && searchResults.length === 0) ||
                    scanLoading) && (
                    <div className="flex items-center gap-1.5 text-xs text-primary font-semibold animate-pulse">
                      <Loader2 className="size-4 animate-spin text-primary" />
                      <span className="text-[11px] hidden sm:inline">Searching…</span>
                    </div>
                  )}
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery("");
                        setIsSearchDropdownOpen(false);
                        scanInputRef.current?.focus();
                      }}
                      className="text-muted-foreground hover:text-foreground p-1.5 rounded-full hover:bg-muted transition-colors cursor-pointer"
                      title="Clear search"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                  <div className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-lg bg-muted/60 border border-border/50 text-[10px] font-extrabold text-muted-foreground">
                    <span>↵ ENTER</span>
                  </div>
                </div>
              </div>

              {/* Suggestions Dropdown */}
              {isSearchDropdownOpen && productSearch.trim().length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1.5 z-30 max-h-96 overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl divide-y divide-border/40 backdrop-blur-md">
                  {/* Loading State on initial fetch */}
                  {isSearchLoading || (isSearchFetching && searchResults.length === 0) ? (
                    <div className="p-6 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                      <Loader2 className="size-6 animate-spin text-primary" />
                      <p className="text-xs font-medium">Searching live database catalogue…</p>
                    </div>
                  ) : searchResults.length === 0 ? (
                    <div className="p-6 text-center space-y-1">
                      <p className="text-xs font-semibold text-foreground">
                        No products found matching &ldquo;
                        <span className="text-primary font-bold">{productSearch}</span>&rdquo;
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Try searching by product name, exact SKU, variant color, or barcode.
                      </p>
                    </div>
                  ) : (
                    searchResults.map((p) => {
                      const distinctVariants = (p.variants || []).filter(
                        (v, idx, arr) =>
                          arr.findIndex(
                            (o) =>
                              o.name === v.name &&
                              (o.color || "") === (v.color || "") &&
                              (o.size || "") === (v.size || "") &&
                              o.price === v.price,
                          ) === idx,
                      );
                      const hasRealVariants =
                        distinctVariants.length > 1 ||
                        (distinctVariants.length === 1 && distinctVariants[0].name !== "Default");

                      return (
                        <div
                          key={p.id}
                          onMouseDown={(e) => {
                            if ((e.target as HTMLElement).closest("button")) return;
                            e.preventDefault();
                            addPOSResultToCart(p);
                          }}
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest("button")) return;
                            addPOSResultToCart(p);
                          }}
                          className="p-3 hover:bg-primary/5 transition-all flex flex-col gap-2.5 cursor-pointer group"
                        >
                          {/* Parent Product Info Bar */}
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <img
                                src={imageFor(p.category, p.image_url)}
                                alt={p.name}
                                loading="lazy"
                                decoding="async"
                                className="size-11 rounded-lg object-cover border border-border shrink-0 bg-muted group-hover:border-primary/40 transition-colors"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = clothing;
                                }}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-bold text-foreground truncate group-hover:text-primary transition-colors">
                                    {p.name}
                                  </span>
                                  {p.sales_channel === "OFFLINE_ONLY" ? (
                                    <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-extrabold bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/25">
                                      🏪 Offline Only
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-extrabold bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/25">
                                      🌐 Online + Store
                                    </span>
                                  )}
                                  {p.matched_reason && (
                                    <span className="text-[10px] font-semibold text-muted-foreground/80 bg-muted px-1.5 py-0.5 rounded">
                                      {p.matched_reason}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                                  <span>
                                    SKU:{" "}
                                    <strong className="text-foreground">{p.sku || "N/A"}</strong>
                                  </span>
                                  <span>•</span>
                                  <span>
                                    Brand: <strong className="text-foreground">{p.brand}</strong>
                                  </span>
                                  <span>•</span>
                                  <span>
                                    Price:{" "}
                                    <strong className="text-primary font-bold">₹{p.price}</strong>
                                  </span>
                                  {p.mrp > p.price && (
                                    <span className="line-through text-[11px] opacity-60">
                                      ₹{p.mrp}
                                    </span>
                                  )}
                                  <span>•</span>
                                  <span>
                                    Total Stock:{" "}
                                    <strong
                                      className={
                                        p.stock > 0
                                          ? "text-emerald-600 dark:text-emerald-400 font-bold"
                                          : "text-rose-600 font-bold"
                                      }
                                    >
                                      {p.stock}
                                    </strong>
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Quick Add Button on single-variant or card level */}
                            <button
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                addPOSResultToCart(p);
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                addPOSResultToCart(p);
                              }}
                              disabled={p.stock <= 0}
                              className={`shrink-0 text-xs font-bold px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${
                                p.stock > 0
                                  ? "bg-primary text-white border-primary hover:bg-primary/90 shadow-sm"
                                  : "bg-muted text-muted-foreground border-border cursor-not-allowed"
                              }`}
                            >
                              {p.stock > 0 ? "+ Add" : "Out"}
                            </button>
                          </div>

                          {/* Variant Selection Chips / Actions if distinct variants exist */}
                          {hasRealVariants && (
                            <div className="flex flex-wrap items-center gap-2 pl-14 pt-1">
                              <span className="text-[11px] font-bold text-muted-foreground mr-1 uppercase tracking-wider">
                                Variants:
                              </span>
                              {distinctVariants.map((v) => {
                                const isItemHighlighted =
                                  selectableItems[activeSuggestionIndex]?.variant.id === v.id;
                                const isOutOfStock = v.stock <= 0;

                                return (
                                  <button
                                    key={v.id}
                                    type="button"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      if (!isOutOfStock) addPOSResultToCart(p, v);
                                    }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (!isOutOfStock) addPOSResultToCart(p, v);
                                    }}
                                    disabled={isOutOfStock}
                                    title={
                                      isOutOfStock
                                        ? `${v.name} is Out of Stock`
                                        : `Add ${v.name} (₹${v.price}, Stock: ${v.stock})`
                                    }
                                    className={`group flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                                      isItemHighlighted
                                        ? "ring-2 ring-primary border-primary bg-primary/10 text-primary shadow-sm"
                                        : isOutOfStock
                                          ? "bg-muted/60 text-muted-foreground/50 border-border/50 cursor-not-allowed line-through"
                                          : "bg-background hover:bg-primary/5 hover:border-primary/40 border-border text-foreground hover:text-primary"
                                    }`}
                                  >
                                    {v.color && (
                                      <span
                                        className="size-2.5 rounded-full border border-black/20 shrink-0 shadow-2xs"
                                        style={{ backgroundColor: v.color.toLowerCase() }}
                                        title={`Color: ${v.color}`}
                                      />
                                    )}
                                    <span className="font-bold">{v.name}</span>
                                    {v.sku && v.sku !== p.sku && (
                                      <span className="text-[10px] text-muted-foreground">
                                        ({v.sku})
                                      </span>
                                    )}
                                    <span className="text-primary font-bold">₹{v.price}</span>
                                    <span
                                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                                        isOutOfStock
                                          ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                                          : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                      }`}
                                    >
                                      {isOutOfStock ? "Out" : `${v.stock} in stock`}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
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
                    {cart.map((item) => {
                      const liveStock = getLiveItemStock(item);
                      const isOverStock = !item.isCustom && item.qty > liveStock;

                      return (
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
                          <td className="py-3 text-right">
                            <div className="flex flex-col items-end gap-0.5">
                              <div className="inline-flex items-center gap-1 bg-background border border-border focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 rounded-lg px-2 py-1 transition-all">
                                <span className="text-xs font-bold text-muted-foreground">₹</span>
                                <input
                                  type="number"
                                  min={0}
                                  step="1"
                                  value={item.price}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    updateItemPrice(item.product_id, isNaN(val) ? 0 : val, item.variant_id);
                                  }}
                                  className="w-20 text-right font-bold text-sm bg-transparent outline-none text-foreground"
                                  title="Override selling price (e.g. enter ₹350 for ₹500 item)"
                                  data-testid={`pos-item-price-input-${item.sku || item.product_id}`}
                                />
                              </div>
                              {item.isCustom && (
                                <span className="text-[10px] font-extrabold text-amber-700 dark:text-amber-300 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.2 rounded">
                                  Custom Price
                                </span>
                              )}
                              {item.mrp && item.mrp !== item.price && !item.isCustom && (
                                <span className="text-[10px] text-muted-foreground line-through">
                                  MRP: ₹{item.mrp}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 text-center">
                            <div className="flex flex-col items-center">
                              <span
                                className={`text-xs font-bold ${
                                  liveStock <= 0
                                    ? "text-red-600 font-extrabold"
                                    : liveStock <= 5
                                      ? "text-amber-600 font-bold"
                                      : "text-muted-foreground"
                                }`}
                                title={`Authoritative Database Stock: ${liveStock}`}
                              >
                                {liveStock}
                              </span>
                              {isOverStock && (
                                <span className="text-[9px] font-extrabold text-red-600 bg-red-50 border border-red-200 px-1 py-0.2 rounded mt-0.5">
                                  Only {liveStock} left!
                                </span>
                              )}
                            </div>
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
                                disabled={!item.isCustom && item.qty >= liveStock}
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
                      );
                    })}
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
                  onClick={handleCancelCart}
                  className="rounded-xl border border-red-200 bg-red-50/70 dark:bg-red-950/30 px-4 py-3 text-xs font-bold text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-all cursor-pointer flex items-center gap-1.5 active:scale-95"
                  title="Cancel and clear active POS cart"
                  data-testid="pos-cancel-cart-btn"
                >
                  <Trash2 className="size-3.5" />
                  <span>Cancel Cart</span>
                </button>

                <button
                  type="button"
                  onClick={handleHoldCurrentOrder}
                  className="rounded-xl border border-amber-300 bg-amber-50/80 dark:bg-amber-950/40 px-4 py-3 text-xs font-bold text-amber-800 dark:text-amber-200 hover:bg-amber-100 transition-all cursor-pointer flex items-center gap-1.5"
                  title="Put current active cart on hold and serve next customer"
                >
                  <PauseCircle className="size-3.5 text-amber-600 dark:text-amber-400" />
                  <span>Hold Cart</span>
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
                    <div className="flex items-center gap-1.5 justify-end">
                      {effectiveCreditUsed > 0 && (
                        <span className="text-xs text-muted-foreground line-through font-semibold">
                          {formatPrice(total)}
                        </span>
                      )}
                      <span
                        className={`font-black text-xl ${payableAfterCredit === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-primary"}`}
                      >
                        {formatPrice(payableAfterCredit)}
                      </span>
                    </div>
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
                              handleSetWalkin();
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
                            placeholder="Search by name, phone, email, city..."
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

                        {/* Searching state */}
                        {searchCustomers.isPending && customerSearchQuery.trim().length >= 2 && (
                          <div className="p-3 text-center text-xs text-muted-foreground flex items-center justify-center gap-2 border border-border rounded-xl bg-card">
                            <div className="size-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                            <span>Searching customers…</span>
                          </div>
                        )}

                        {/* No results empty state */}
                        {!searchCustomers.isPending &&
                          customerSearchQuery.trim().length >= 2 &&
                          (searchCustomers.data ?? []).length === 0 && (
                            <div className="p-4 text-center rounded-xl border border-border bg-card shadow-sm space-y-2">
                              <p className="font-bold text-foreground text-xs">No customers found</p>
                              <p className="text-[11px] text-muted-foreground">
                                No customer record matching &ldquo;{customerSearchQuery}&rdquo;
                              </p>
                              <button
                                type="button"
                                onClick={() => {
                                  setCustomerMode("new");
                                  setCustomerSearchQuery("");
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                              >
                                <Plus className="size-3" />
                                <span>Create New Customer</span>
                              </button>
                            </div>
                          )}

                        {/* Customer Suggestions Dropdown */}
                        {customerSearchQuery.trim().length > 0 &&
                          (searchCustomers.data ?? []).length > 0 && (
                            <div className="max-h-56 overflow-y-auto rounded-xl border border-border bg-card shadow-xl divide-y divide-border/60">
                              {searchCustomers.data!.map((c) => {
                                const initials = (c.name || "C")
                                  .split(" ")
                                  .map((n) => n[0])
                                  .filter(Boolean)
                                  .slice(0, 2)
                                  .join("")
                                  .toUpperCase();
                                return (
                                  <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => {
                                      handleAssignCustomer({
                                        id: c.id,
                                        name: c.name,
                                        phone: c.phone,
                                        email: c.email || "",
                                        city: c.city,
                                      });
                                      setCreditDismissedManually(false);
                                      setCustomerSearchQuery("");
                                      toast.success(`Selected customer: ${c.name}`);
                                    }}
                                    className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-sm hover:bg-muted/70 cursor-pointer text-left transition-colors group"
                                  >
                                    <div className="flex items-center gap-3 min-w-0">
                                      <div className="size-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-black shrink-0 border border-primary/20 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                                        {initials}
                                      </div>
                                      <div className="min-w-0">
                                        <p className="font-bold text-foreground text-xs sm:text-sm truncate">
                                          {c.name || "Guest Customer"}
                                        </p>
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                                          {c.phone && <span className="font-mono">{c.phone}</span>}
                                          {c.city && <span>• {c.city}</span>}
                                          {c.email && (
                                            <span className="truncate max-w-[140px]">({c.email})</span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                      <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full block">
                                        {c.total_purchases} {c.total_purchases === 1 ? "order" : "orders"}
                                      </span>
                                      {Number(c.total_spend || 0) > 0 && (
                                        <span className="text-[10px] text-muted-foreground font-semibold block mt-0.5">
                                          {formatPrice(c.total_spend)}
                                        </span>
                                      )}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}

                        {/* Selected Customer State */}
                        {customerId && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between rounded-xl bg-emerald-500/10 dark:bg-emerald-950/40 p-3 text-xs border border-emerald-500/25">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="size-9 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-black shrink-0 shadow-2xs">
                                  {(customerName || "C")
                                    .split(" ")
                                    .map((n) => n[0])
                                    .filter(Boolean)
                                    .slice(0, 2)
                                    .join("")
                                    .toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <span className="text-[9px] uppercase font-bold tracking-wider text-emerald-700 dark:text-emerald-300 block">
                                    Customer Linked
                                  </span>
                                  <p className="font-bold text-foreground text-sm truncate">
                                    {customerName}
                                  </p>
                                  <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                                    {customerPhone && <span className="font-mono">{customerPhone}</span>}
                                    {customerEmail && (
                                      <span className="truncate max-w-[140px]">({customerEmail})</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setCustomerId(null);
                                  setCustomerName("");
                                  setCustomerPhone("");
                                  setCustomerEmail("");
                                  setStoreCreditApplied(0);
                                  setCreditDismissedManually(false);
                                }}
                                className="px-2.5 py-1 rounded-lg text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-muted border border-border cursor-pointer transition-colors shrink-0"
                              >
                                Change
                              </button>
                            </div>

                            {customerIntel && (
                              <div className="p-3 rounded-xl bg-muted/40 border border-border/80 space-y-2 text-xs">
                                <div className="flex items-center justify-between border-b border-border/60 pb-1.5">
                                  <span className="font-bold text-foreground flex items-center gap-1.5 text-[11px]">
                                    <Sparkles className="size-3 text-primary" />
                                    Customer Intelligence
                                  </span>
                                  <span className="text-[10px] text-muted-foreground font-mono">
                                    ID: {customerIntel.id?.substring(0, 8)}…
                                  </span>
                                </div>
                                <div className="grid grid-cols-3 gap-1.5 text-center">
                                  <div className="p-1.5 rounded-lg bg-background border border-border/50">
                                    <p className="text-[9px] text-muted-foreground uppercase font-bold">
                                      Orders
                                    </p>
                                    <p className="text-xs font-black text-foreground">
                                      {customerIntel.total_purchases || 0}
                                    </p>
                                  </div>
                                  <div className="p-1.5 rounded-lg bg-background border border-border/50">
                                    <p className="text-[9px] text-muted-foreground uppercase font-bold">
                                      Spend
                                    </p>
                                    <p className="text-xs font-black text-primary">
                                      {formatPrice(customerIntel.total_spend || 0)}
                                    </p>
                                  </div>
                                  <div className="p-1.5 rounded-lg bg-background border border-border/50">
                                    <p className="text-[9px] text-muted-foreground uppercase font-bold">
                                      Credit
                                    </p>
                                    <p className="text-xs font-black text-emerald-600">
                                      {formatPrice(customerIntel.store_credit_balance || 0)}
                                    </p>
                                  </div>
                                </div>
                                {customerIntel.recentSales &&
                                  customerIntel.recentSales.length > 0 && (
                                    <div className="pt-1">
                                      <p className="text-[10px] text-muted-foreground font-bold uppercase mb-1">
                                        Recent Invoices
                                      </p>
                                      <div className="space-y-1">
                                        {customerIntel.recentSales.map(
                                          (s: {
                                            id: string;
                                            sale_number: string;
                                            created_at: string;
                                            total?: number;
                                            total_amount?: number;
                                            subtotal?: number;
                                          }) => (
                                          <div
                                            key={s.id}
                                            className="flex items-center justify-between text-[11px] p-1.5 rounded-md bg-background border border-border/40"
                                          >
                                            <span className="font-mono font-bold text-foreground">
                                              #{s.sale_number}
                                            </span>
                                            <span className="text-muted-foreground">
                                              {new Date(s.created_at).toLocaleDateString("en-IN", {
                                                month: "short",
                                                day: "numeric",
                                              })}
                                            </span>
                                            <span className="font-black text-primary">
                                              {formatPrice(s.total || s.total_amount || 0)}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {customerMode === "new" && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <input
                            value={customerName}
                            onChange={(e) => setCustomerName(e.target.value)}
                            placeholder="Customer Full Name *"
                            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary transition-all font-medium"
                          />
                          <input
                            value={customerPhone}
                            onChange={(e) => setCustomerPhone(e.target.value)}
                            placeholder="Mobile Number (10 digits) *"
                            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary transition-all font-medium"
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <input
                            value={customerEmail}
                            onChange={(e) => setCustomerEmail(e.target.value)}
                            placeholder="Email Address (Optional)"
                            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary transition-all font-medium"
                          />
                          <input
                            value={customerCity}
                            onChange={(e) => setCustomerCity(e.target.value)}
                            placeholder="City / Region (Optional)"
                            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary transition-all font-medium"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 3. Store Credit / Exchange Voucher Tender Section */}
                  <div className="rounded-2xl bg-card p-4 sm:p-5 shadow-2xs border border-border space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Sparkles className="size-4 text-emerald-600 dark:text-emerald-400" />
                        <h3 className="text-sm font-bold text-foreground">
                          3. Store Credit / Exchange Voucher
                        </h3>
                      </div>
                      <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded-full">
                        Zero Expiry
                      </span>
                    </div>

                    {/* Walk-in Voucher Code Search Input */}
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Tag className="absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
                        <input
                          type="text"
                          value={creditTokenInput}
                          onChange={(e) => {
                            setCreditDismissedManually(false);
                            setCreditTokenInput(
                              e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""),
                            );
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              setCreditDismissedManually(false);
                              if (availableCredit > 0) {
                                setStoreCreditApplied(Math.min(availableCredit, total));
                                toast.success(
                                  `Voucher ${creditTokenInput.trim()} applied: ${formatPrice(Math.min(availableCredit, total))}`,
                                );
                              } else if (creditTokenInput.trim()) {
                                toast.info(`Checking voucher ${creditTokenInput.trim()}...`);
                              }
                            }
                          }}
                          placeholder="Enter or scan 4-character Voucher Token (e.g. A7K2, Q9XZ)..."
                          className="w-full rounded-xl border border-border bg-background pl-9 pr-3 py-2 text-xs font-mono font-bold uppercase outline-none focus:border-primary transition-all"
                        />
                      </div>
                      {effectiveCreditUsed > 0 ? (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="px-3 py-2 rounded-xl bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center gap-1 border border-emerald-500/30">
                            <Check className="size-3.5" />
                            Applied
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setCreditDismissedManually(true);
                              setStoreCreditApplied(0);
                              setCreditTokenInput("");
                              toast.info(
                                "Voucher removed from this checkout. Balance remains untouched.",
                              );
                            }}
                            className="px-2.5 py-2 rounded-xl bg-background border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40 text-xs font-bold transition cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setCreditDismissedManually(false);
                            if (availableCredit > 0) {
                              setStoreCreditApplied(Math.min(availableCredit, total));
                              toast.success(
                                `Voucher ${creditTokenInput.trim().toUpperCase()} applied: ${formatPrice(Math.min(availableCredit, total))}`,
                              );
                            } else if (creditTokenInput.trim()) {
                              toast.info(
                                `Checking voucher ${creditTokenInput.trim().toUpperCase()}...`,
                              );
                            } else {
                              toast.info("Please enter a voucher code");
                            }
                          }}
                          className="px-3.5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition cursor-pointer shrink-0 shadow-2xs"
                        >
                          {availableCredit > 0
                            ? `Apply ₹${Math.min(availableCredit, total)}`
                            : "Apply"}
                        </button>
                      )}
                    </div>

                    {/* Invalid / Expired / Consumed Voucher Error Notice */}
                    {creditTokenInput.trim().length >= 4 && voucherData && !voucherData.valid && (
                      <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/25 text-xs text-destructive flex items-start gap-2">
                        <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold">
                            {voucherData.error || "Invalid or ineligible voucher"}
                          </p>
                          <p className="text-[11px] opacity-80 mt-0.5">
                            Exchange vouchers expire 7 days after issuance and cannot be re-used
                            after full redemption.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Available Credit Banner */}
                    {availableCredit > 0 ? (
                      <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-2 text-xs">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-bold text-emerald-950 dark:text-emerald-100">
                                Available Credit:{" "}
                                <span className="text-base font-black text-emerald-700 dark:text-emerald-300">
                                  {formatPrice(availableCredit)}
                                </span>
                              </p>
                              {voucherData?.days_remaining !== undefined && (
                                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 text-[10px] font-bold">
                                  {voucherData.days_remaining > 0
                                    ? `Expires in ${voucherData.days_remaining}d`
                                    : "Expires today"}
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-emerald-800/80 dark:text-emerald-300/80 mt-0.5">
                              {creditTokenInput
                                ? `Voucher Token: ${creditTokenInput.toUpperCase()} • Issued Value: ${formatPrice(voucherData?.original_amount ?? availableCredit)}`
                                : customerName
                                  ? `Customer Account: ${customerName}`
                                  : "Walk-in Credit Token"}
                            </p>
                          </div>

                          {storeCreditApplied > 0 ? (
                            <div className="flex items-center gap-2">
                              <span className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold text-xs">
                                Applied −{formatPrice(effectiveCreditUsed)}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setCreditDismissedManually(true);
                                  setStoreCreditApplied(0);
                                  setCreditTokenInput("");
                                  toast.info(
                                    "Voucher removed from this checkout. Balance remains untouched.",
                                  );
                                }}
                                className="px-2 py-1 rounded-lg bg-background border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40 text-xs font-bold transition cursor-pointer"
                              >
                                Remove
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setCreditDismissedManually(false);
                                setStoreCreditApplied(Math.min(availableCredit, total));
                                toast.success(
                                  `Applied ${formatPrice(Math.min(availableCredit, total))} store credit`,
                                );
                              }}
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 transition cursor-pointer"
                            >
                              Apply Store Credit
                            </button>
                          )}
                        </div>

                        {effectiveCreditUsed > 0 && availableCredit > effectiveCreditUsed && (
                          <div className="pt-2 border-t border-emerald-500/20 flex items-center justify-between text-[11px] text-emerald-900/80 dark:text-emerald-200/80">
                            <span>Projected Remaining Voucher Balance:</span>
                            <span className="font-bold text-emerald-700 dark:text-emerald-300">
                              {formatPrice(availableCredit - effectiveCreditUsed)}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      !voucherData?.error && (
                        <p className="text-[11px] text-muted-foreground">
                          Enter a 4-character Return Credit Token (e.g.{" "}
                          <span className="font-mono font-bold">A7K2</span>) or select an existing
                          customer to redeem store credit towards this purchase.
                        </p>
                      )
                    )}
                  </div>

                  {/* 4. Payment Tender (for Remaining Balance) */}
                  <div className="rounded-2xl bg-card p-4 sm:p-5 shadow-2xs border border-border space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-foreground">
                        4. Payment Tender{" "}
                        {effectiveCreditUsed > 0 && `(Payable: ${formatPrice(payableAfterCredit)})`}
                      </h3>
                      {payableAfterCredit === 0 && effectiveCreditUsed > 0 && (
                        <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                          100% Settled with Store Credit
                        </span>
                      )}
                    </div>

                    {payableAfterCredit > 0 ? (
                      <>
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
                                  setCashTendered(payableAfterCredit);
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
                              <span className="text-xs font-bold text-foreground">
                                Cash Received:
                              </span>
                              {/* Quick tender chips */}
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => setCashTendered(payableAfterCredit)}
                                  className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-background border border-border hover:bg-muted text-foreground cursor-pointer"
                                >
                                  Exact ({formatPrice(payableAfterCredit)})
                                </button>
                                {[500, 1000, 2000, 5000]
                                  .filter((amt) => amt >= payableAfterCredit)
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
                                    setCashTendered(
                                      e.target.value === "" ? "" : Number(e.target.value),
                                    )
                                  }
                                  placeholder={`Enter cash amount (min ${payableAfterCredit})`}
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
                      </>
                    ) : (
                      <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200 font-medium">
                        ✓ Full purchase covered by Store Credit ({formatPrice(effectiveCreditUsed)}
                        ). No cash/UPI collection needed.
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
                      {productSavings > 0 && (
                        <div className="flex justify-between text-muted-foreground text-[11px]">
                          <span>MRP Savings</span>
                          <span className="text-emerald-600 font-bold">
                            −{formatPrice(productSavings)}
                          </span>
                        </div>
                      )}
                      {discountAmount > 0 && (
                        <div className="flex justify-between text-emerald-700 font-bold">
                          <span>
                            Discount {discountType === "percentage" ? `(${discountValue}%)` : ""}
                          </span>
                          <span>−{formatPrice(discountAmount)}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-bold text-foreground">
                        <span>Sale Total</span>
                        <span>{formatPrice(total)}</span>
                      </div>
                      {effectiveCreditUsed > 0 && (
                        <div className="flex justify-between text-emerald-700 font-bold bg-emerald-500/10 p-1.5 rounded-lg border border-emerald-500/20">
                          <span>Store Credit Applied</span>
                          <span>−{formatPrice(effectiveCreditUsed)}</span>
                        </div>
                      )}
                      <div className="flex items-baseline justify-between border-t border-border pt-3 text-base">
                        <span className="font-bold text-foreground">Customer Payable</span>
                        <span className="font-black text-2xl text-primary">
                          {formatPrice(payableAfterCredit)}
                        </span>
                      </div>
                      {customerRemainingCredit > 0 && (
                        <div className="flex justify-between text-[11px] text-muted-foreground pt-1">
                          <span>Remaining Account Credit:</span>
                          <span className="font-bold text-emerald-600 dark:text-emerald-400">
                            {formatPrice(customerRemainingCredit)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* ── Admin-only Profit Indicator ── */}
                    {profitCalc.hasCostData ? (
                      <div
                        className={`rounded-xl border p-3 space-y-1.5 ${
                          profitCalc.profit >= 0
                            ? "bg-emerald-500/8 border-emerald-500/25"
                            : "bg-red-500/8 border-red-500/25"
                        }`}
                      >
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          📊 Admin Profit View
                        </p>
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Total Cost (COGS)</span>
                          <span className="font-semibold text-foreground">
                            {formatPrice(profitCalc.totalCost)}
                          </span>
                        </div>
                        <div
                          className={`flex justify-between text-sm font-bold ${
                            profitCalc.profit >= 0
                              ? "text-emerald-700 dark:text-emerald-400"
                              : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          <span>
                            {profitCalc.profit >= 0 ? "✓ Profit" : "⚠ Loss"}
                          </span>
                          <span>
                            {profitCalc.profit >= 0 ? "+" : ""}
                            {formatPrice(profitCalc.profit)}
                            {profitCalc.marginPct !== null && (
                              <span className="ml-1.5 text-[11px] opacity-80">
                                ({profitCalc.marginPct.toFixed(1)}% margin)
                              </span>
                            )}
                          </span>
                        </div>
                        {discountAmount > 0 && (
                          <p className="text-[10px] text-muted-foreground">
                            Includes {formatPrice(discountAmount)} discount applied
                          </p>
                        )}
                      </div>
                    ) : cart.length > 0 ? (
                      <div className="rounded-xl border border-dashed border-border p-2.5 text-center">
                        <p className="text-[10px] text-muted-foreground">
                          💡 Set buying price in product catalog to see profit
                        </p>
                      </div>
                    ) : null}

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
                            {
                              name: customerName,
                              phone: customerPhone,
                              email: customerEmail,
                              city: customerCity,
                            },
                            {
                              onSuccess: (newCustomer) => {
                                setCustomerId(newCustomer.id);
                                completeSale(newCustomer.id);
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
                          <span>
                            {payableAfterCredit === 0 && effectiveCreditUsed > 0
                              ? `Complete Sale — Settle ₹0 (100% Store Credit)`
                              : `Complete Sale — ${formatPrice(payableAfterCredit)}`}
                          </span>
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
          <div
            className={`flex-1 overflow-y-auto ${saleResult.status === "pending_sync" || saleResult.is_offline_queued ? "bg-gradient-to-b from-amber-50/60 to-white" : "bg-gradient-to-b from-emerald-50/50 to-white"} p-6 flex flex-col items-center justify-center`}
          >
            <div className="max-w-md w-full space-y-6">
              {/* Success / Offline Pending Header */}
              <div className="text-center">
                {saleResult.status === "pending_sync" || saleResult.is_offline_queued ? (
                  <>
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 mb-3 border border-amber-300">
                      <CloudUpload className="size-8 text-amber-600 animate-pulse" />
                    </div>
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-900 text-xs font-bold border border-amber-300 mb-2">
                      <span className="size-2 rounded-full bg-amber-500 animate-ping" />
                      Pending Cloud Synchronization
                    </div>
                    <h2 className="text-2xl font-bold text-amber-950">
                      Offline Sale Saved Locally
                    </h2>
                    <p className="text-xs text-amber-800 mt-1 max-w-xs mx-auto">
                      Stored in local POS queue. Will synchronize to the cloud automatically once
                      internet connection is active.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 mb-3 border border-emerald-300">
                      <Check className="size-8 text-emerald-600" />
                    </div>
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold border border-emerald-300 mb-2">
                      <span className="size-2 rounded-full bg-emerald-500" />
                      Authoritative Database Commit
                    </div>
                    <h2 className="text-2xl font-bold text-emerald-800">Sale Completed!</h2>
                  </>
                )}
                <p className="text-lg font-bold text-foreground mt-2">{saleResult.sale_number}</p>
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
            store_credit_used: saleResult.store_credit_used,
            credit_token_used: saleResult.credit_token_used,
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
            store_credit_used: saleResult.store_credit_used,
            credit_token_used: saleResult.credit_token_used,
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
            brand: item.brand || "ZERAH",
            category: item.category,
            price: item.price,
            mrp: item.mrp,
            stock: item.stock,
            sku: item.sku,
            artNo: item.sku || item.barcode || "—",
            barcode: item.barcode,
            size: (item as any).size || item.age_group || "--",
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

      {/* Held Orders Drawer / Modal */}
      {isHeldOrdersOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
            <div className="relative w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-border p-4 bg-muted/40 shrink-0">
                <div className="flex items-center gap-2">
                  <PauseCircle className="size-5 text-amber-600 dark:text-amber-400" />
                  <h3 className="font-bold text-base text-foreground">Held POS Carts</h3>
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 text-xs font-bold">
                    {heldOrders.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsHeldOrdersOpen(false)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {heldOrders.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <PauseCircle className="size-10 mx-auto opacity-30 mb-2" />
                    <p className="font-semibold text-sm">No Held Carts</p>
                    <p className="text-xs mt-1">
                      When customers step away, click &ldquo;Hold Cart&rdquo; to save their cart
                      here.
                    </p>
                  </div>
                ) : (
                  heldOrders.map((order) => {
                    const timeAgo = Math.round((Date.now() - order.timestamp) / 60000);
                    return (
                      <div
                        key={order.id}
                        className="p-4 rounded-xl border border-border bg-background hover:border-primary/50 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-foreground">
                              {order.customerMode === "walkin"
                                ? "Walk-in Customer"
                                : order.customerName || "Customer"}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded-md bg-muted text-muted-foreground font-mono">
                              {timeAgo <= 0 ? "Just now" : `${timeAgo}m ago`}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {order.cart.length} unique line{order.cart.length > 1 ? "s" : ""} •
                            Total:{" "}
                            <span className="font-bold text-primary">
                              {formatPrice(order.totalAmount)}
                            </span>
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleResumeOrder(order)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition shadow-2xs cursor-pointer"
                          >
                            <PlayCircle className="size-3.5" />
                            Resume
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteHeldOrder(order.id)}
                            className="p-1.5 rounded-xl text-destructive hover:bg-destructive/10 transition cursor-pointer"
                            title="Discard held order"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* ====== Unified Supabase POS Customer Modal ====== */}
      {isCustomerModalOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[220] flex items-center justify-center p-4"
            onClick={() => {
              setIsCustomerModalOpen(false);
              setCustomerModalSessionId(null);
            }}
          >
            {/* Backdrop */}
            <div className="fixed inset-0 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200" />

            {/* Modal Box */}
            <div
              className="relative w-full max-w-xl bg-card rounded-2xl shadow-2xl border border-border flex flex-col max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200 z-10"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30">
                <div className="flex items-center gap-2.5">
                  <div className="size-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                    <User className="size-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-foreground">
                      Assign Customer — {sessions.find((s) => s.id === (customerModalSessionId || activeSessionId))?.session_number || "Sale Tab"}
                    </h3>
                    <p className="text-[11px] text-muted-foreground">
                      Search authoritative Supabase records, create new, or bill as walk-in
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsCustomerModalOpen(false);
                    setCustomerModalSessionId(null);
                  }}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Mode Selection Tabs */}
              <div className="flex gap-2 p-4 pb-2 border-b border-border bg-background">
                {(
                  [
                    ["existing", "Search Customers (Supabase)", Search],
                    ["new", "New Customer", UserPlus],
                    ["walkin", "Walk-in (Default)", User],
                  ] as const
                ).map(([mode, label, Icon]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setCustomerModalTab(mode)}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition-all cursor-pointer",
                      customerModalTab === mode
                        ? "bg-primary text-primary-foreground shadow-2xs"
                        : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                    )}
                  >
                    <Icon className="size-3.5" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {customerModalTab === "existing" && (
                  <div className="space-y-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
                      <input
                        autoFocus
                        type="text"
                        value={customerSearchQuery}
                        onChange={(e) => setCustomerSearchQuery(e.target.value)}
                        placeholder="Search by name (e.g. Mirza), phone, email, city..."
                        className="w-full rounded-xl border border-border bg-background pl-9 pr-9 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all font-medium"
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
                          <X className="size-4" />
                        </button>
                      )}
                    </div>

                    {/* Searching spinner */}
                    {searchCustomers.isPending && customerSearchQuery.trim().length >= 1 && (
                      <div className="p-4 text-center text-xs text-muted-foreground flex items-center justify-center gap-2 border border-border rounded-xl bg-card">
                        <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        <span>Searching authoritative Supabase records…</span>
                      </div>
                    )}

                    {/* Empty Query Prompt */}
                    {customerSearchQuery.trim().length === 0 && (
                      <div className="p-6 text-center text-muted-foreground text-xs space-y-1">
                        <p className="font-bold text-foreground">Type to search customer records</p>
                        <p className="text-[11px]">
                          Try searching for &quot;mirza&quot;, &quot;sameer&quot;, &quot;7014098198&quot;, or &quot;kota&quot;.
                        </p>
                      </div>
                    )}

                    {/* No Results */}
                    {!searchCustomers.isPending &&
                      customerSearchQuery.trim().length >= 1 &&
                      (searchCustomers.data ?? []).length === 0 && (
                        <div className="p-6 text-center rounded-xl border border-border bg-card shadow-2xs space-y-2">
                          <p className="font-bold text-foreground text-xs">No matching customers</p>
                          <p className="text-[11px] text-muted-foreground">
                            No customer found for &ldquo;{customerSearchQuery}&rdquo;
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setCustomerModalTab("new");
                              setCustomerName(customerSearchQuery.replace(/\d/g, "").trim());
                              setCustomerPhone(customerSearchQuery.replace(/\D/g, "").slice(0, 10));
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-primary/10 text-primary hover:bg-primary/20 transition cursor-pointer"
                          >
                            <UserPlus className="size-3.5" />
                            <span>Create as New Customer</span>
                          </button>
                        </div>
                      )}

                    {/* Results List */}
                    {(searchCustomers.data ?? []).length > 0 && (
                      <div className="divide-y divide-border border border-border rounded-xl bg-card overflow-hidden">
                        {searchCustomers.data!.map((c) => {
                          const initials = (c.name || "C")
                            .split(" ")
                            .map((n) => n[0])
                            .filter(Boolean)
                            .slice(0, 2)
                            .join("")
                            .toUpperCase();
                          const isCurrentlySelected = customerId === c.id;

                          return (
                            <div
                              key={c.id}
                              className={cn(
                                "flex items-center justify-between gap-3 p-3 transition-colors",
                                isCurrentlySelected
                                  ? "bg-primary/5"
                                  : "hover:bg-muted/40"
                              )}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="size-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-black shrink-0 border border-primary/20">
                                  {initials}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="font-bold text-foreground text-sm truncate">
                                      {c.name || "Customer"}
                                    </p>
                                    {isCurrentlySelected && (
                                      <span className="text-[9px] font-bold uppercase bg-primary text-primary-foreground px-1.5 py-0.2 rounded">
                                        Active
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground mt-0.5">
                                    {c.phone && <span className="font-mono">{c.phone}</span>}
                                    {c.city && <span>• {c.city}</span>}
                                    {c.email && <span className="truncate max-w-[130px]">({c.email})</span>}
                                  </div>
                                  <div className="flex items-center gap-2 mt-1 text-[10px] font-semibold text-muted-foreground">
                                    <span className="bg-muted px-1.5 py-0.5 rounded">
                                      {c.total_purchases || 0} orders
                                    </span>
                                    <span className="bg-muted px-1.5 py-0.5 rounded">
                                      {formatPrice(c.total_spend || 0)} spend
                                    </span>
                                    {Number(c.store_credit_balance || 0) > 0 && (
                                      <span className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                        Credit: {formatPrice(Number(c.store_credit_balance))}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => {
                                  handleAssignCustomer({
                                    id: c.id,
                                    name: c.name,
                                    phone: c.phone,
                                    email: c.email || "",
                                    city: c.city,
                                  });
                                  setCreditDismissedManually(false);
                                  setIsCustomerModalOpen(false);
                                  setCustomerModalSessionId(null);
                                  toast.success(`Customer linked: ${c.name}`);
                                }}
                                className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-2xs cursor-pointer"
                                data-testid={`pos-select-customer-${c.id}`}
                              >
                                {isCurrentlySelected ? "Re-link" : "Select"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {customerModalTab === "new" && (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Creates a permanent customer record in Supabase that is immediately available across Admin, POS, and Online Storefront.
                    </p>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-foreground block">
                        Full Name <span className="text-destructive">*</span>
                      </label>
                      <input
                        type="text"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="e.g. Mirza Sameer Baig"
                        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary font-medium"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-foreground block">
                          Phone Number <span className="text-destructive">*</span>
                        </label>
                        <input
                          type="tel"
                          value={customerPhone}
                          onChange={(e) =>
                            setCustomerPhone(e.target.value.replace(/\D/g, "").slice(0, 10))
                          }
                          placeholder="10-digit mobile number"
                          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary font-medium font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-foreground block">Email (Optional)</label>
                        <input
                          type="email"
                          value={customerEmail}
                          onChange={(e) => setCustomerEmail(e.target.value)}
                          placeholder="customer@example.com"
                          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary font-medium"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-foreground block">City (Optional)</label>
                      <input
                        type="text"
                        value={customerCity}
                        onChange={(e) => setCustomerCity(e.target.value)}
                        placeholder="e.g. Kota, Jaipur"
                        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary font-medium"
                      />
                    </div>
                    <div className="pt-2">
                      <button
                        type="button"
                        disabled={createCustomer.isPending || !customerName.trim() || !customerPhone.trim()}
                        onClick={async () => {
                          if (!customerName.trim() || !customerPhone.trim()) {
                            toast.error("Please enter both customer name and phone number");
                            return;
                          }
                          try {
                            const res = await createCustomer.mutateAsync({
                              name: customerName.trim(),
                              phone: customerPhone.trim(),
                              email: customerEmail.trim() || undefined,
                              city: customerCity.trim() || undefined,
                            });
                            handleAssignCustomer({
                              id: res.id,
                              name: res.name,
                              phone: res.phone,
                              email: res.email || "",
                              city: res.city,
                            });
                            setIsCustomerModalOpen(false);
                            setCustomerModalSessionId(null);
                            toast.success(`Customer created and linked: ${res.name}`);
                          } catch (err: any) {
                            toast.error(err.message || "Failed to create customer");
                          }
                        }}
                        className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-xs hover:bg-primary/90 transition shadow-sm disabled:opacity-50 cursor-pointer"
                      >
                        {createCustomer.isPending ? "Creating in Supabase…" : "Save & Assign Customer"}
                      </button>
                    </div>
                  </div>
                )}

                {customerModalTab === "walkin" && (
                  <div className="p-4 rounded-xl border border-border bg-muted/30 text-center space-y-3">
                    <div className="size-12 rounded-full bg-muted flex items-center justify-center mx-auto text-muted-foreground">
                      <User className="size-6" />
                    </div>
                    <h4 className="font-bold text-sm text-foreground">Walk-in Customer</h4>
                    <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                      Bill without linking to an authoritative customer profile. Instant token number will be generated automatically.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        handleSetWalkin();
                        setIsCustomerModalOpen(false);
                        setCustomerModalSessionId(null);
                        toast.info("Active sale set to Walk-in Customer");
                      }}
                      className="px-4 py-2 rounded-xl bg-foreground text-background font-bold text-xs hover:opacity-90 transition cursor-pointer"
                    >
                      Assign as Walk-in
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
