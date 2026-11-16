import React, { useState, useMemo, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatPrice, imageFor } from "@/lib/store";
import { safeLower, safeUpper } from "@/lib/utils";
import { invalidateCanonicalReportingQueries } from "@/lib/canonical-reporting";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Coins,
  Search,
  ArrowLeft,
  Edit3,
  Plus,
  Minus,
  Check,
  X,
  User,
  Phone,
  Mail,
  Copy,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  Ticket,
  Filter,
  ArrowUpDown,
  RefreshCw,
  Trash2,
  RotateCcw,
  Package,
  Layers,
  ChevronDown,
  ChevronRight,
  Receipt,
  Download,
} from "lucide-react";
import type {
  DrillDownPOSSale,
  DrillDownOrder,
  DrillDownProduct,
  DrillDownReturn,
} from "./DashboardDrillDown";

export interface ProductCreditUsageItem {
  key: string;
  productId: string;
  productSlug: string;
  productName: string;
  sku: string;
  imageUrl: string | null;
  unitsSoldWithCredit: number;
  totalCreditUsed: number;
  totalGrossRevenue: number;
  totalNetCollected: number;
  salesCount: number;
  sales: Array<{
    saleId: string;
    saleNumber: string;
    date: string;
    customerName: string;
    customerPhone: string;
    creditTokenUsed?: string;
    qty: number;
    price: number;
    itemGross: number;
    creditAllocated: number;
    netPaid: number;
  }>;
}

export interface ItemizedCreditTransaction {
  id: string;
  saleId: string;
  saleNumber: string;
  date: string;
  customerName: string;
  customerPhone: string;
  creditTokenUsed?: string;
  productId: string;
  productSlug: string;
  productName: string;
  sku: string;
  imageUrl: string | null;
  qty: number;
  price: number;
  itemGross: number;
  creditAllocated: number;
  netPaid: number;
}

export interface ReturnCreditRow {
  id: string;
  return_number: string;
  date: string;
  customer_name: string;
  customer_phone: string;
  customer_id?: string | null;
  credit_token: string;
  refund_amount: number;
  credit_used: number;
  remaining_balance: number;
  status: "ACTIVE" | "PARTIALLY_USED" | "CONSUMED" | "EXPIRED" | "VOIDED";
  linked_sale_id?: string | null;
  notes?: string;
  raw: any;
}

interface CustomerCreditsDrillDownProps {
  onBack: () => void;
  dateRangeText?: string;
  posSales?: DrillDownPOSSale[];
  allPosSales?: DrillDownPOSSale[];
  orders?: DrillDownOrder[];
  products?: DrillDownProduct[];
  offlineReturns?: DrillDownReturn[];
}

export function CustomerCreditsDrillDown({
  onBack,
  dateRangeText,
  posSales = [],
  allPosSales = [],
  orders = [],
  products = [],
  offlineReturns: propReturns = [],
}: CustomerCreditsDrillDownProps) {
  const qc = useQueryClient();
  // View mode: 'return_vouchers' (default) | 'by_product' | 'by_transaction'
  const [activeTab, setActiveTab] = useState<"return_vouchers" | "by_product" | "by_transaction">("return_vouchers");
  const [returnFilterStatus, setReturnFilterStatus] = useState<"active" | "all" | "settled">("active");
  const periodHasCredits = useMemo(() => {
    return posSales.some((s) => Number(s.store_credit_used || 0) > 0 && !s.is_voided);
  }, [posSales]);
  const [scope, setScope] = useState<"period" | "all">(periodHasCredits ? "period" : "all");
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // Return Credit Modals
  const [editingReturn, setEditingReturn] = useState<ReturnCreditRow | null>(null);
  const [editReturnBalance, setEditReturnBalance] = useState<string>("");
  const [editReturnNotes, setEditReturnNotes] = useState<string>("");
  const [deletingReturn, setDeletingReturn] = useState<ReturnCreditRow | null>(null);
  const [deleteReturnMode, setDeleteReturnMode] = useState<"void" | "delete">("void");
  const [isIssuingNew, setIsIssuingNew] = useState(false);
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCreditAmount, setNewCreditAmount] = useState("");
  const [newCreditNotes, setNewCreditNotes] = useState("");
  const [isMutating, setIsMutating] = useState(false);

  // 1. Fetch live offline returns if not passed or for freshness
  const { data: rawReturns = propReturns, refetch: refetchReturns } = useQuery({
    queryKey: ["offline-returns-credits-drilldown"],
    staleTime: 1000 * 60 * 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("offline_returns")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) return propReturns as any[];
      return data ?? [];
    },
  });

  const safeFormatDate = (d: any, fmt: string, fallback = "—"): string => {
    if (!d) return fallback;
    try {
      const parsed = new Date(d);
      if (isNaN(parsed.getTime())) return fallback;
      return format(parsed, fmt);
    } catch {
      return fallback;
    }
  };

  const getProductInfo = (slugOrIdOrName: unknown) => {
    const key = safeLower(slugOrIdOrName);
    if (!key) return null;
    return (
      products.find(
        (p) =>
          safeLower(p.id) === key ||
          safeLower(p.slug) === key ||
          safeLower(p.name) === key
      ) || null
    );
  };

  const getProductImage = (p: DrillDownProduct | null, fallback?: string | null) => {
    if (fallback && typeof fallback === "string" && fallback.trim().length > 0) return fallback;
    if (!p) return null;
    return (
      p.image ||
      p.image_url ||
      p.product_images?.[0]?.public_url ||
      imageFor(p.category || "clothing", null, p) ||
      null
    );
  };

  // ── 2. Authoritative Calculation of Credits Used on Products ──
  const activeSales = useMemo(() => {
    const pool = scope === "all" ? (allPosSales.length > 0 ? allPosSales : posSales) : posSales;
    return pool.filter((sale) => {
      if (sale.is_voided) return false;
      const status = safeLower(sale.status);
      if (["cancelled", "voided", "failed", "sync_failed"].includes(status)) return false;
      const returnStatus = safeLower(sale.return_status);
      if (["returned", "fully_returned"].includes(returnStatus)) return false;
      const creditAmt = Number(sale.store_credit_used || (sale as any).credit_used || 0);
      const isCreditMethod = safeLower((sale as any).payment_method) === "store_credit" || safeLower((sale as any).payment_method) === "credit";
      return creditAmt > 0 || isCreditMethod;
    });
  }, [posSales, allPosSales, scope]);

  const { productCredits, itemizedTransactions, totalCreditUsed, totalGrossRevenue, totalNetCash } = useMemo(() => {
    const productMap = new Map<string, ProductCreditUsageItem>();
    const transactions: ItemizedCreditTransaction[] = [];
    let grandCreditUsed = 0;
    let grandGross = 0;
    let grandNet = 0;

    for (const sale of activeSales) {
      let saleCredit = Number(sale.store_credit_used || (sale as any).credit_used || 0);
      if (saleCredit <= 0) {
        const isCreditMethod = safeLower((sale as any).payment_method) === "store_credit" || safeLower((sale as any).payment_method) === "credit";
        if (isCreditMethod) {
          saleCredit = Number((sale as any).total_amount || sale.total || 0);
        }
      }
      if (saleCredit <= 0) continue;
      grandCreditUsed += saleCredit;

      let rawItems: any[] = [];
      if (Array.isArray(sale.offline_sale_items)) {
        rawItems = sale.offline_sale_items;
      } else if (typeof sale.offline_sale_items === "string") {
        try {
          const parsed = JSON.parse(sale.offline_sale_items);
          if (Array.isArray(parsed)) rawItems = parsed;
        } catch {
          rawItems = [];
        }
      } else if (Array.isArray((sale as any).items)) {
        rawItems = (sale as any).items;
      }

      const saleIdStr = String(sale.id || "");
      const saleNumber = String(
        sale.sale_number || (saleIdStr ? `#${saleIdStr.substring(0, 8).toUpperCase()}` : "POS-SALE")
      );
      const customerName = String(sale.customer_name || "Customer").trim();
      const customerPhone = String(sale.customer_phone || "").trim();
      const tokenUsed = String((sale as any).credit_token_used || "").trim();
      const saleDate = sale.created_at || new Date().toISOString();

      if (rawItems.length === 0) {
        rawItems = [
          {
            name: (sale as any).notes || "In-Store POS Sale",
            product_id: "in_store_sale",
            product_slug: "pos-sale",
            sku: "POS-SALE",
            qty: 1,
            price: Number((sale as any).total_amount || sale.total || saleCredit),
          },
        ];
      }

      // Calculate total item weights for proportional distribution
      const itemWeights = rawItems.map((it) => {
        const qty = Number(it.qty || it.quantity || 1);
        const price = Number(it.price || 0);
        return Math.max(0, qty * price);
      });
      const totalWeight = itemWeights.reduce((sum, w) => sum + w, 0);

      // Allocate credit to each item
      rawItems.forEach((it, idx) => {
        const qty = Number(it.qty || it.quantity || 1);
        const price = Number(it.price || 0);
        const itemGross = price * qty;
        grandGross += itemGross;

        let creditAllocated = 0;
        if (totalWeight > 0) {
          creditAllocated = Number(((itemWeights[idx] / totalWeight) * saleCredit).toFixed(2));
        } else if (rawItems.length > 0) {
          creditAllocated = Number((saleCredit / rawItems.length).toFixed(2));
        }
        creditAllocated = Math.min(itemGross, creditAllocated);
        const netPaid = Math.max(0, itemGross - creditAllocated);
        grandNet += netPaid;

        const prodInfo = getProductInfo(it.product_id || it.product_slug || it.name || "");
        const prodName = String(it.name || prodInfo?.name || "Product").trim();
        const prodSlug = String(it.product_slug || prodInfo?.slug || "").trim();
        const prodId = String(it.product_id || prodInfo?.id || prodSlug || prodName || "item").trim();
        const sku = String(it.sku || prodInfo?.sku || "—").trim();
        const imageUrl = getProductImage(prodInfo, (it as any).image_url);

        // Add to itemized transactions
        transactions.push({
          id: `${saleIdStr}-${idx}`,
          saleId: saleIdStr,
          saleNumber,
          date: saleDate,
          customerName,
          customerPhone,
          creditTokenUsed: tokenUsed,
          productId: prodId,
          productSlug: prodSlug,
          productName: prodName,
          sku,
          imageUrl,
          qty,
          price,
          itemGross,
          creditAllocated,
          netPaid,
        });

        // Aggregate by Product
        const prodKey = safeLower(prodId) || safeLower(prodName);
        let existing = productMap.get(prodKey);
        if (!existing) {
          existing = {
            key: prodKey,
            productId: prodId,
            productSlug: prodSlug,
            productName: prodName,
            sku,
            imageUrl,
            unitsSoldWithCredit: 0,
            totalCreditUsed: 0,
            totalGrossRevenue: 0,
            totalNetCollected: 0,
            salesCount: 0,
            sales: [],
          };
          productMap.set(prodKey, existing);
        }

        existing.unitsSoldWithCredit += qty;
        existing.totalCreditUsed += creditAllocated;
        existing.totalGrossRevenue += itemGross;
        existing.totalNetCollected += netPaid;
        existing.salesCount += 1;
        existing.sales.push({
          saleId: saleIdStr,
          saleNumber,
          date: saleDate,
          customerName,
          customerPhone,
          creditTokenUsed: tokenUsed,
          qty,
          price,
          itemGross,
          creditAllocated,
          netPaid,
        });
      });
    }

    const prodList = Array.from(productMap.values()).sort((a, b) => b.totalCreditUsed - a.totalCreditUsed);
    transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return {
      productCredits: prodList,
      itemizedTransactions: transactions,
      totalCreditUsed: grandCreditUsed,
      totalGrossRevenue: grandGross,
      totalNetCash: grandNet,
    };
  }, [activeSales, products]);

  // Filtered lists based on search
  const filteredProducts = useMemo(() => {
    const q = safeLower(searchTerm);
    if (!q) return productCredits;
    return productCredits.filter(
      (p) =>
        safeLower(p.productName).includes(q) ||
        safeLower(p.sku).includes(q) ||
        safeLower(p.productId).includes(q) ||
        p.sales.some(
          (s) =>
            safeLower(s.saleNumber).includes(q) ||
            safeLower(s.customerName).includes(q) ||
            safeLower(s.customerPhone).includes(q) ||
            safeLower(s.creditTokenUsed).includes(q)
        )
    );
  }, [productCredits, searchTerm]);

  const filteredTransactions = useMemo(() => {
    const q = safeLower(searchTerm);
    if (!q) return itemizedTransactions;
    return itemizedTransactions.filter(
      (t) =>
        safeLower(t.productName).includes(q) ||
        safeLower(t.sku).includes(q) ||
        safeLower(t.saleNumber).includes(q) ||
        safeLower(t.customerName).includes(q) ||
        safeLower(t.customerPhone).includes(q) ||
        safeLower(t.creditTokenUsed).includes(q)
    );
  }, [itemizedTransactions, searchTerm]);

  // ── 3. Return Credits Table Data (for Tab 3) ──
  const returnCredits: ReturnCreditRow[] = useMemo(() => {
    return rawReturns.map((r: any) => {
      const refundAmount = Number(r.refund_amount || r.refund_total || 0);
      const creditUsed = Number(r.credit_used || 0);
      const remainingBalance = Math.max(0, refundAmount - creditUsed);
      const token = String(r.credit_token || "").trim();
      let status: ReturnCreditRow["status"] = safeUpper(r.credit_token_status || "ACTIVE") as any;

      if (remainingBalance <= 0 || creditUsed >= refundAmount) {
        status = "CONSUMED";
      } else if (creditUsed > 0 && remainingBalance > 0) {
        status = "PARTIALLY_USED";
      }

      const returnIdStr = String(r.id || "");
      const shortId = returnIdStr.length >= 8 ? returnIdStr.substring(0, 8).toUpperCase() : returnIdStr.toUpperCase();

      return {
        id: returnIdStr,
        return_number: String(r.return_number || `RET-${shortId}`),
        date: r.created_at || new Date().toISOString(),
        customer_name: String(r.customer_name || "Return Customer"),
        customer_phone: String(r.customer_phone || ""),
        customer_id: r.customer_id,
        credit_token: token || `EXCH-${shortId.substring(0, 6)}`,
        refund_amount: refundAmount,
        credit_used: creditUsed,
        remaining_balance: remainingBalance,
        status,
        linked_sale_id: r.linked_sale_id,
        notes: String(r.notes || ""),
        raw: r,
      };
    });
  }, [rawReturns]);

  const totalActiveReturnBalance = useMemo(() => {
    return returnCredits
      .filter((r) => r.remaining_balance > 0 && r.status !== "VOIDED")
      .reduce((sum, r) => sum + r.remaining_balance, 0);
  }, [returnCredits]);

  const activeVouchersCount = useMemo(() => {
    return returnCredits.filter((r) => r.remaining_balance > 0 && r.status !== "VOIDED").length;
  }, [returnCredits]);

  const settledVouchersCount = useMemo(() => {
    return returnCredits.filter((r) => r.remaining_balance <= 0 || r.status === "CONSUMED").length;
  }, [returnCredits]);

  const filteredReturnCredits = useMemo(() => {
    let list = [...returnCredits];
    if (returnFilterStatus === "active") {
      list = list.filter((r) => r.remaining_balance > 0 && r.status !== "VOIDED");
    } else if (returnFilterStatus === "settled") {
      list = list.filter((r) => r.remaining_balance <= 0 || r.status === "CONSUMED");
    }
    const q = safeLower(searchTerm);
    if (q) {
      list = list.filter(
        (r) =>
          safeLower(r.return_number).includes(q) ||
          safeLower(r.customer_name).includes(q) ||
          safeLower(r.customer_phone).includes(q) ||
          safeLower(r.credit_token).includes(q)
      );
    }
    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [returnCredits, returnFilterStatus, searchTerm]);

  const handleCopyToken = (token: string) => {
    navigator.clipboard.writeText(token);
    setCopiedToken(token);
    toast.success(`Voucher code ${token} copied!`);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const reconcileCustomerCreditByPhone = async (phone: string | undefined | null) => {
    const norm10 = (phone || "").replace(/\D/g, "").slice(-10);
    if (!norm10) return;
    try {
      const { data: retData } = await supabase
        .from("offline_returns")
        .select("refund_amount, credit_used, credit_balance, credit_token_status")
        .ilike("customer_phone", `%${norm10}%`);

      let totalRemaining = 0;
      for (const r of retData || []) {
        const status = String(r.credit_token_status || "").toUpperCase();
        if (status === "ACTIVE" || status === "PARTIALLY_USED") {
          const rem =
            r.credit_balance !== undefined && r.credit_balance !== null
              ? Number(r.credit_balance)
              : Math.max(0, Number(r.refund_amount || 0) - Number(r.credit_used || 0));
          totalRemaining += Math.max(0, rem);
        }
      }

      await supabase
        .from("pos_customers")
        .update({
          store_credit_balance: totalRemaining,
          store_credit: totalRemaining,
          updated_at: new Date().toISOString(),
        } as any)
        .ilike("phone", `%${norm10}%`);
    } catch (e) {
      console.warn("[CustomerCreditsDrillDown] Error reconciling pos_customers credit:", e);
    }
  };

  // 1-Click Settle Return
  const handleSettleReturn = async (row: ReturnCreditRow) => {
    try {
      setIsMutating(true);
      const noteAppend = `[Settled ₹${row.remaining_balance.toFixed(2)} by admin on ${format(
        new Date(),
        "MMM dd, yyyy • hh:mm a"
      )}]`;
      const updatedNotes = row.notes ? `${row.notes}\n${noteAppend}` : noteAppend;

      // 1. Try atomic security definer backend RPC first
      const { error: rpcErr } = await (supabase.rpc as any)("admin_settle_return_voucher", {
        _return_id: row.id,
        _notes: noteAppend,
      });

      if (rpcErr) {
        // Fallback to direct table mutation if RPC is pending migration
        const { error: directErr } = await supabase
          .from("offline_returns")
          .update({
            credit_used: row.refund_amount,
            credit_balance: 0,
            credit_token_status: "CONSUMED",
            notes: updatedNotes,
            updated_at: new Date().toISOString(),
          } as any)
          .eq("id", row.id);

        if (directErr) throw directErr;
        await reconcileCustomerCreditByPhone(row.customer_phone);
      }

      toast.success(`Return Credit ${row.return_number} marked as settled!`);
      await refetchReturns();
      await qc.invalidateQueries({ queryKey: ["offline-returns"] });
      await qc.invalidateQueries({ queryKey: ["admin-pos-customers-credit"] });
      invalidateCanonicalReportingQueries(qc);
    } catch (err: any) {
      toast.error(err?.message || "Failed to settle return credit");
    } finally {
      setIsMutating(false);
    }
  };

  // Save Edit Return
  const handleSaveEditReturn = async () => {
    if (!editingReturn) return;
    const newBal = parseFloat(editReturnBalance);
    if (isNaN(newBal) || newBal < 0) {
      toast.error("Please enter a valid credit balance");
      return;
    }

    try {
      setIsMutating(true);
      const originalRefund = editingReturn.refund_amount;
      const calculatedUsed = Math.max(0, originalRefund - newBal);
      const isConsumed = newBal <= 0;
      const noteAppend = editReturnNotes.trim()
        ? `[Credit adjusted by admin to ₹${newBal}: ${editReturnNotes.trim()} on ${format(new Date(), "MMM dd, yyyy")}]`
        : `[Credit adjusted by admin to ₹${newBal} on ${format(new Date(), "MMM dd, yyyy")}]`;
      const updatedNotes = editingReturn.notes
        ? `${editingReturn.notes}\n${noteAppend}`
        : noteAppend;

      // 1. Try atomic security definer backend RPC first
      const { error: rpcErr } = await (supabase.rpc as any)("admin_adjust_return_credit", {
        _return_id: editingReturn.id,
        _new_remaining: newBal,
        _notes: noteAppend,
      });

      if (rpcErr) {
        // Fallback to direct table mutation if RPC is pending migration
        const { error: directErr } = await supabase
          .from("offline_returns")
          .update({
            credit_balance: newBal,
            credit_used: calculatedUsed,
            credit_token_status: isConsumed ? "CONSUMED" : "ACTIVE",
            notes: updatedNotes,
            updated_at: new Date().toISOString(),
          } as any)
          .eq("id", editingReturn.id);

        if (directErr) throw directErr;
        await reconcileCustomerCreditByPhone(editingReturn.customer_phone);
      }

      toast.success(`Return Credit ${editingReturn.return_number} updated to ${formatPrice(newBal)}!`);
      setEditingReturn(null);
      await refetchReturns();
      await qc.invalidateQueries({ queryKey: ["offline-returns"] });
      await qc.invalidateQueries({ queryKey: ["admin-pos-customers-credit"] });
      invalidateCanonicalReportingQueries(qc);
    } catch (err: any) {
      toast.error(err?.message || "Failed to update return credit");
    } finally {
      setIsMutating(false);
    }
  };

  // Delete / Void Return
  const handleConfirmDeleteReturn = async () => {
    if (!deletingReturn) return;
    try {
      setIsMutating(true);
      if (deleteReturnMode === "void") {
        const voidNote = `[Voucher VOIDED by admin on ${format(new Date(), "MMM dd, yyyy")}]`;
        const updatedNotes = deletingReturn.notes
          ? `${deletingReturn.notes}\n${voidNote}`
          : voidNote;

        const { error: rpcErr } = await (supabase.rpc as any)("admin_void_return_voucher", {
          _return_id: deletingReturn.id,
          _notes: voidNote,
        });

        if (rpcErr) {
          const { error: directErr } = await supabase
            .from("offline_returns")
            .update({
              credit_balance: 0,
              credit_token_status: "VOIDED",
              notes: updatedNotes,
              updated_at: new Date().toISOString(),
            } as any)
            .eq("id", deletingReturn.id);

          if (directErr) throw directErr;
          await reconcileCustomerCreditByPhone(deletingReturn.customer_phone);
        }

        toast.success(`Return Voucher ${deletingReturn.credit_token} voided!`);
      } else {
        const { error } = await supabase
          .from("offline_returns")
          .delete()
          .eq("id", deletingReturn.id);

        if (error) throw error;
        await reconcileCustomerCreditByPhone(deletingReturn.customer_phone);
        toast.success(`Return record ${deletingReturn.return_number} deleted!`);
      }

      await reconcileCustomerCreditByPhone(deletingReturn.customer_phone);

      setDeletingReturn(null);
      await refetchReturns();
      await qc.invalidateQueries({ queryKey: ["offline-returns"] });
      await qc.invalidateQueries({ queryKey: ["admin-pos-customers-credit"] });
      invalidateCanonicalReportingQueries(qc);
    } catch (err: any) {
      toast.error(err?.message || "Failed to process delete / void");
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Header & Breadcrumb */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card p-4 sm:p-5 rounded-2xl border border-border shadow-xs">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2 rounded-xl bg-muted/60 hover:bg-muted text-foreground transition cursor-pointer flex items-center justify-center shrink-0"
            title="Back to Dashboard"
          >
            <ArrowLeft className="size-4.5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-foreground flex items-center gap-2">
                <span>Return Credits &amp; Store Credit Ledger</span>
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                  {formatPrice(totalActiveReturnBalance)} Available
                </span>
              </h2>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Active customer return credit vouchers, balances, and products purchased with store credit.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Scope Toggle: Current Period vs All Time */}
          <div className="flex items-center gap-1 p-1 bg-muted/60 rounded-xl border border-border text-xs font-bold">
            <button
              type="button"
              onClick={() => setScope("period")}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                scope === "period"
                  ? "bg-card text-foreground shadow-2xs font-black"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {dateRangeText || "Selected Period"}
            </button>
            <button
              type="button"
              onClick={() => setScope("all")}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                scope === "all"
                  ? "bg-card text-foreground shadow-2xs font-black"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All Time
            </button>
          </div>
        </div>
      </div>

      {/* KPI Highlights Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* 1. Active Return Credits Available */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-900 via-indigo-950 to-purple-950 text-white shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-white/80">Active Return Credits</span>
            <Coins className="size-5 text-indigo-300 opacity-80" />
          </div>
          <h3 className="text-2xl font-black mt-2 tracking-tight">
            {formatPrice(totalActiveReturnBalance)}
          </h3>
          <p className="text-[11px] text-white/70 mt-1">
            {activeVouchersCount} active voucher{activeVouchersCount === 1 ? "" : "s"} holding balance
          </p>
        </div>

        {/* 2. Credits Redeemed in Sales */}
        <div className="p-4 rounded-2xl bg-card border border-border shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Credits Redeemed</span>
            <Receipt className="size-5 text-indigo-600 dark:text-indigo-400 opacity-80" />
          </div>
          <h3 className="text-2xl font-black text-foreground mt-2 tracking-tight">
            {formatPrice(totalCreditUsed)}
          </h3>
          <p className="text-[11px] text-muted-foreground mt-1">
            Redeemed at checkout {scope === "period" ? `(${dateRangeText})` : "(All Time)"}
          </p>
        </div>

        {/* 3. Products Sold with Credit */}
        <div className="p-4 rounded-2xl bg-card border border-border shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Products Redeemed</span>
            <Package className="size-5 text-blue-500 opacity-80" />
          </div>
          <h3 className="text-2xl font-black text-foreground mt-2 tracking-tight">
            {productCredits.length}
          </h3>
          <p className="text-[11px] text-muted-foreground mt-1">
            Distinct catalog items bought with credit
          </p>
        </div>

        {/* 4. Net Cash Collected on these Sales */}
        <div className="p-4 rounded-2xl bg-card border border-border shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Net Cash Collected</span>
            <CheckCircle2 className="size-5 text-emerald-500 opacity-80" />
          </div>
          <h3 className="text-2xl font-black text-foreground mt-2 tracking-tight">
            {formatPrice(totalNetCash)}
          </h3>
          <p className="text-[11px] text-muted-foreground mt-1">
            Actual cash/UPI paid beyond credit
          </p>
        </div>
      </div>

      {/* Tabs & Search Strip */}
      <div className="space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-card p-3 rounded-2xl border border-border shadow-xs">
          {/* Main Switcher Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-muted/60 rounded-xl border border-border text-xs font-bold overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab("return_vouchers")}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === "return_vouchers"
                  ? "bg-card text-foreground shadow-2xs font-black"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Ticket className="size-3.5 text-emerald-500" />
              <span>Return Vouchers &amp; Balances ({activeVouchersCount} active)</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("by_product")}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === "by_product"
                  ? "bg-card text-foreground shadow-2xs font-black"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Package className="size-3.5 text-indigo-500" />
              <span>By Product ({productCredits.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("by_transaction")}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === "by_transaction"
                  ? "bg-card text-foreground shadow-2xs font-black"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Receipt className="size-3.5 text-blue-500" />
              <span>Itemized Sales ({itemizedTransactions.length})</span>
            </button>
          </div>

          {/* Sub-filter for Return Vouchers */}
          {activeTab === "return_vouchers" && (
            <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-xl border border-border/80 text-xs font-semibold self-start md:self-center">
              <button
                type="button"
                onClick={() => setReturnFilterStatus("active")}
                className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                  returnFilterStatus === "active"
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-bold border border-emerald-500/30"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Active Only ({activeVouchersCount})
              </button>
              <button
                type="button"
                onClick={() => setReturnFilterStatus("all")}
                className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                  returnFilterStatus === "all"
                    ? "bg-card text-foreground font-bold shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                All ({returnCredits.length})
              </button>
              <button
                type="button"
                onClick={() => setReturnFilterStatus("settled")}
                className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                  returnFilterStatus === "settled"
                    ? "bg-slate-500/15 text-slate-700 dark:text-slate-300 font-bold border border-slate-500/30"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Settled ({settledVouchersCount})
              </button>
            </div>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={
              activeTab === "by_product"
                ? "Search by product name, SKU, or sale number…"
                : activeTab === "by_transaction"
                ? "Search by product, customer name, phone, or voucher token…"
                : "Search return vouchers by customer, token, or return #…"
            }
            className="w-full pl-10 pr-8 py-2.5 rounded-2xl border border-border bg-card text-xs font-medium text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary transition shadow-xs"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── VIEW 1: BY PRODUCT (Default) ── */}
      {activeTab === "by_product" && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-left text-xs">
              <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground font-bold border-b border-border">
                <tr>
                  <th className="px-5 py-3.5">Product</th>
                  <th className="px-5 py-3.5 text-center">Units Sold w/ Credit</th>
                  <th className="px-5 py-3.5 text-right">Gross Bill Value</th>
                  <th className="px-5 py-3.5 text-right">Credit Used on Product</th>
                  <th className="px-5 py-3.5 text-right">Net Cash Collected</th>
                  <th className="px-5 py-3.5 text-center pr-5">Sales Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredProducts.map((p) => {
                  const isExpanded = expandedProduct === p.key;
                  return (
                    <React.Fragment key={p.key}>
                      <tr className="hover:bg-muted/30 transition-colors group bg-background">
                        {/* Product Info */}
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            {p.imageUrl ? (
                              <img
                                src={p.imageUrl}
                                alt={p.productName}
                                className="size-11 rounded-xl object-cover border border-border bg-muted shrink-0"
                              />
                            ) : (
                              <div className="size-11 rounded-xl bg-indigo-500/10 text-indigo-600 border border-indigo-500/20 flex items-center justify-center font-bold text-xs shrink-0">
                                <Package className="size-5" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="font-bold text-foreground text-xs truncate max-w-[240px]">
                                {p.productName}
                              </p>
                              <p className="font-mono text-[10px] text-muted-foreground mt-0.5">
                                SKU: {p.sku}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Units Sold with Credit */}
                        <td className="px-5 py-4 text-center whitespace-nowrap">
                          <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full font-bold bg-muted text-foreground border border-border text-xs">
                            {p.unitsSoldWithCredit} unit{p.unitsSoldWithCredit === 1 ? "" : "s"}
                          </span>
                        </td>

                        {/* Gross Bill Value */}
                        <td className="px-5 py-4 text-right font-medium text-muted-foreground whitespace-nowrap">
                          {formatPrice(p.totalGrossRevenue)}
                        </td>

                        {/* Credit Used on Product */}
                        <td className="px-5 py-4 text-right font-black text-sm whitespace-nowrap">
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30">
                            {formatPrice(p.totalCreditUsed)}
                          </span>
                        </td>

                        {/* Net Cash Collected */}
                        <td className="px-5 py-4 text-right font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                          {formatPrice(p.totalNetCollected)}
                        </td>

                        {/* Expand Button */}
                        <td className="px-5 py-4 text-center pr-5 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setExpandedProduct(isExpanded ? null : p.key)}
                            className="inline-flex items-center gap-1 px-3 py-1 text-xs font-bold text-foreground bg-muted hover:bg-muted/80 rounded-xl transition cursor-pointer"
                          >
                            <span>{p.sales.length} sale{p.sales.length === 1 ? "" : "s"}</span>
                            {isExpanded ? (
                              <ChevronDown className="size-3.5" />
                            ) : (
                              <ChevronRight className="size-3.5" />
                            )}
                          </button>
                        </td>
                      </tr>

                      {/* Expanded Sub-Table showing individual sales for this product */}
                      {isExpanded && (
                        <tr className="bg-muted/15 border-b border-border/80">
                          <td colSpan={6} className="px-6 py-4">
                            <div className="rounded-xl border border-border bg-card p-3 space-y-2">
                              <p className="text-[11px] font-extrabold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                                <Receipt className="size-3 text-indigo-500" />
                                <span>Sales where credit was applied to {p.productName}:</span>
                              </p>
                              <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                  <thead className="text-[10px] uppercase text-muted-foreground border-b border-border/60">
                                    <tr>
                                      <th className="py-2">Date</th>
                                      <th className="py-2">Sale Number</th>
                                      <th className="py-2">Customer</th>
                                      <th className="py-2">Voucher Token</th>
                                      <th className="py-2 text-center">Qty</th>
                                      <th className="py-2 text-right">Gross Price</th>
                                      <th className="py-2 text-right">Credit Used</th>
                                      <th className="py-2 text-right">Net Cash Paid</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-border/40 font-mono text-[11px]">
                                    {p.sales.map((s, idx) => (
                                      <tr key={idx} className="hover:bg-muted/40">
                                        <td className="py-2 whitespace-nowrap text-muted-foreground font-sans">
                                          {safeFormatDate(s.date, "MMM d, yyyy • hh:mm a")}
                                        </td>
                                        <td className="py-2 font-bold text-primary">{s.saleNumber}</td>
                                        <td className="py-2 font-sans font-medium text-foreground">
                                          {s.customerName} {s.customerPhone ? `(${s.customerPhone})` : ""}
                                        </td>
                                        <td className="py-2">
                                          {s.creditTokenUsed ? (
                                            <span className="px-1.5 py-0.5 rounded bg-muted text-foreground border border-border text-[10px] font-bold">
                                              {s.creditTokenUsed}
                                            </span>
                                          ) : (
                                            "—"
                                          )}
                                        </td>
                                        <td className="py-2 text-center font-bold">×{s.qty}</td>
                                        <td className="py-2 text-right text-muted-foreground">
                                          {formatPrice(s.itemGross)}
                                        </td>
                                        <td className="py-2 text-right font-black text-indigo-600 dark:text-indigo-400">
                                          {formatPrice(s.creditAllocated)}
                                        </td>
                                        <td className="py-2 text-right font-bold text-emerald-600">
                                          {formatPrice(s.netPaid)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}

                {filteredProducts.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-muted-foreground space-y-2">
                      <Coins className="size-10 mx-auto text-muted-foreground/40" />
                      <p className="font-bold text-sm text-foreground">
                        {searchTerm
                          ? "No products match your search"
                          : `No store credits were used in ${scope === "period" ? (dateRangeText || "this period") : "all time"}.`}
                      </p>
                      <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                        When a customer redeems a return credit voucher or wallet credit at checkout, the product-wise deduction breakdown will appear here.
                      </p>
                      {scope === "period" && (
                        <button
                          type="button"
                          onClick={() => setScope("all")}
                          className="mt-2 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold cursor-pointer"
                        >
                          View All Time Credits Used
                        </button>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── VIEW 2: ITEMIZED TRANSACTIONS ── */}
      {activeTab === "by_transaction" && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-xs">
              <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground font-bold border-b border-border">
                <tr>
                  <th className="px-5 py-3.5">Date &amp; Sale #</th>
                  <th className="px-5 py-3.5">Customer</th>
                  <th className="px-5 py-3.5">Product</th>
                  <th className="px-5 py-3.5">Voucher Token</th>
                  <th className="px-5 py-3.5 text-center">Qty</th>
                  <th className="px-5 py-3.5 text-right">Gross Price</th>
                  <th className="px-5 py-3.5 text-right">Credit Used</th>
                  <th className="px-5 py-3.5 text-right pr-5">Net Cash Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredTransactions.map((t) => (
                  <tr key={t.id} className="hover:bg-muted/30 transition-colors bg-background">
                    <td className="px-5 py-4 whitespace-nowrap">
                      <p className="font-mono font-bold text-primary">{t.saleNumber}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {safeFormatDate(t.date, "MMM d, yyyy • hh:mm a")}
                      </p>
                    </td>

                    <td className="px-5 py-4">
                      <p className="font-bold text-foreground text-xs">{t.customerName}</p>
                      {t.customerPhone && (
                        <p className="text-[11px] font-mono text-muted-foreground mt-0.5">{t.customerPhone}</p>
                      )}
                    </td>

                    <td className="px-5 py-4">
                      <p className="font-bold text-foreground text-xs truncate max-w-[200px]">
                        {t.productName}
                      </p>
                      <p className="font-mono text-[10px] text-muted-foreground mt-0.5">SKU: {t.sku}</p>
                    </td>

                    <td className="px-5 py-4 whitespace-nowrap">
                      {t.creditTokenUsed ? (
                        <span className="px-2 py-0.5 rounded bg-muted text-foreground font-mono font-bold text-[11px] border border-border">
                          {t.creditTokenUsed}
                        </span>
                      ) : (
                        <span className="text-muted-foreground italic">Wallet</span>
                      )}
                    </td>

                    <td className="px-5 py-4 text-center font-bold whitespace-nowrap">
                      ×{t.qty}
                    </td>

                    <td className="px-5 py-4 text-right font-medium text-muted-foreground whitespace-nowrap">
                      {formatPrice(t.itemGross)}
                    </td>

                    <td className="px-5 py-4 text-right font-black text-sm text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
                      {formatPrice(t.creditAllocated)}
                    </td>

                    <td className="px-5 py-4 text-right pr-5 font-bold text-emerald-600 whitespace-nowrap">
                      {formatPrice(t.netPaid)}
                    </td>
                  </tr>
                ))}

                {filteredTransactions.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-muted-foreground">
                      No transactions match your search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── VIEW 3: RETURN VOUCHERS & BALANCES (Full Action Controls) ── */}
      {activeTab === "return_vouchers" && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-left text-xs">
              <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground font-bold border-b border-border">
                <tr>
                  <th className="px-5 py-3.5">Date &amp; Return #</th>
                  <th className="px-5 py-3.5">Customer</th>
                  <th className="px-5 py-3.5">Voucher Token</th>
                  <th className="px-5 py-3.5 text-right">Return Value</th>
                  <th className="px-5 py-3.5 text-right">Redeemed</th>
                  <th className="px-5 py-3.5 text-right">Remaining Credit</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5 text-center pr-5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredReturnCredits.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/30 transition-colors group bg-background">
                    <td className="px-5 py-4 whitespace-nowrap">
                      <p className="font-mono font-bold text-foreground text-xs">{row.return_number}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {safeFormatDate(row.date, "MMM d, yyyy")}
                      </p>
                    </td>

                    <td className="px-5 py-4">
                      <p className="font-bold text-foreground text-xs truncate max-w-[160px]">
                        {row.customer_name}
                      </p>
                      {row.customer_phone && (
                        <p className="font-mono text-[11px] text-muted-foreground mt-0.5">{row.customer_phone}</p>
                      )}
                    </td>

                    <td className="px-5 py-4 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleCopyToken(row.credit_token)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 font-mono font-bold text-xs border border-indigo-500/20 transition cursor-pointer"
                        title="Click to copy voucher code"
                      >
                        <span>{row.credit_token}</span>
                        {copiedToken === row.credit_token ? (
                          <CheckCircle2 className="size-3 text-emerald-600" />
                        ) : (
                          <Copy className="size-3 text-indigo-400 opacity-70" />
                        )}
                      </button>
                    </td>

                    <td className="px-5 py-4 text-right font-medium text-muted-foreground whitespace-nowrap">
                      {formatPrice(row.refund_amount)}
                    </td>

                    <td className="px-5 py-4 text-right font-medium text-muted-foreground whitespace-nowrap">
                      {row.credit_used > 0 ? (
                        <span className="text-amber-600 dark:text-amber-400 font-bold">
                          {formatPrice(row.credit_used)}
                        </span>
                      ) : (
                        "₹0.00"
                      )}
                    </td>

                    <td className="px-5 py-4 text-right font-black text-sm whitespace-nowrap">
                      {row.remaining_balance > 0 ? (
                        <span className="text-emerald-600 dark:text-emerald-400">
                          {formatPrice(row.remaining_balance)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/60">₹0.00</span>
                      )}
                    </td>

                    <td className="px-5 py-4 whitespace-nowrap">
                      {row.status === "ACTIVE" && row.remaining_balance > 0 && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 text-[10px] font-bold uppercase tracking-wider">
                          Active Credit
                        </span>
                      )}
                      {row.status === "PARTIALLY_USED" && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 text-[10px] font-bold uppercase tracking-wider">
                          Partially Used
                        </span>
                      )}
                      {(row.status === "CONSUMED" || row.remaining_balance <= 0) && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-500/10 text-slate-700 dark:text-slate-300 border border-slate-500/20 text-[10px] font-bold uppercase tracking-wider">
                          Settled / Used
                        </span>
                      )}
                      {row.status === "VOIDED" && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20 text-[10px] font-bold uppercase tracking-wider">
                          Voided
                        </span>
                      )}
                    </td>

                    <td className="px-5 py-4 text-center pr-5 whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1.5">
                        {row.remaining_balance > 0 && (
                          <button
                            type="button"
                            disabled={isMutating}
                            onClick={() => handleSettleReturn(row)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 rounded-lg transition shadow-2xs cursor-pointer disabled:opacity-50"
                            title="Mark return credit fully settled / redeemed"
                          >
                            <CheckCircle2 className="size-3.5" />
                            <span>Settle</span>
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={isMutating}
                          onClick={() => {
                            setEditingReturn(row);
                            setEditReturnBalance(String(row.remaining_balance));
                            setEditReturnNotes(row.notes || "");
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-blue-700 dark:text-blue-300 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 rounded-lg transition shadow-2xs cursor-pointer disabled:opacity-50"
                          title="Edit return credit balance"
                        >
                          <Edit3 className="size-3.5" />
                          <span>Edit</span>
                        </button>

                        <button
                          type="button"
                          disabled={isMutating}
                          onClick={() => {
                            setDeletingReturn(row);
                            setDeleteReturnMode("void");
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-bold text-rose-700 dark:text-rose-300 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 rounded-lg transition shadow-2xs cursor-pointer disabled:opacity-50"
                          title="Void voucher or delete return record"
                        >
                          <Trash2 className="size-3.5" />
                          <span className="sr-only">Delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {filteredReturnCredits.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-muted-foreground space-y-2">
                      <Ticket className="size-10 mx-auto text-muted-foreground/40" />
                      <p className="font-bold text-sm text-foreground">
                        {searchTerm
                          ? "No return vouchers match your search."
                          : returnFilterStatus === "active"
                          ? "No active remaining return credits found."
                          : "No return vouchers found."}
                      </p>
                      {returnFilterStatus === "active" && returnCredits.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setReturnFilterStatus("all")}
                          className="mt-2 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold cursor-pointer"
                        >
                          View All Historical Vouchers ({returnCredits.length})
                        </button>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── MODAL: Edit Return Credit ── */}
      {editingReturn && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
        >
          <div className="w-full max-w-md bg-card border border-border rounded-3xl p-5 sm:p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 flex items-center justify-center font-black">
                  <Ticket className="size-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-foreground">Edit Return Credit</h3>
                  <p className="text-xs text-muted-foreground font-mono">
                    {editingReturn.return_number} • {editingReturn.credit_token}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingReturn(null)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="p-3.5 rounded-2xl bg-muted/40 border border-border space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Customer:</span>
                <span className="font-bold text-foreground">
                  {editingReturn.customer_name} ({editingReturn.customer_phone || "No phone"})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Original Credit Issued:</span>
                <span className="font-bold text-foreground">{formatPrice(editingReturn.refund_amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Credit Used:</span>
                <span className="font-bold text-amber-600">{formatPrice(editingReturn.credit_used)}</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-border font-bold">
                <span className="text-foreground">Current Remaining Balance:</span>
                <span className="text-emerald-600 font-black">{formatPrice(editingReturn.remaining_balance)}</span>
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveEditReturn();
              }}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">
                  New Remaining Credit Balance (₹)
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">
                    ₹
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={editReturnBalance}
                    onChange={(e) => setEditReturnBalance(e.target.value)}
                    className="w-full pl-8 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm font-black text-foreground focus:outline-none focus:border-primary transition"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">Adjustment Reason / Notes</label>
                <input
                  type="text"
                  value={editReturnNotes}
                  onChange={(e) => setEditReturnNotes(e.target.value)}
                  placeholder="e.g. Return balance adjusted by store admin"
                  className="w-full px-3.5 py-2 rounded-xl border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary transition"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingReturn(null)}
                  className="px-4 py-2 rounded-xl border border-border text-xs font-bold text-muted-foreground hover:bg-muted transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isMutating}
                  className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 disabled:opacity-50 transition cursor-pointer flex items-center gap-1.5 shadow-xs"
                >
                  <Check className="size-3.5" />
                  <span>Save Balance</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: Delete / Void Return Credit ── */}
      {deletingReturn && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
        >
          <div className="w-full max-w-md bg-card border border-border rounded-3xl p-5 sm:p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 flex items-center justify-center font-black">
                  <Trash2 className="size-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-foreground">Void or Delete Return Credit</h3>
                  <p className="text-xs text-muted-foreground font-mono">
                    {deletingReturn.return_number} • {deletingReturn.credit_token}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeletingReturn(null)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-900 dark:text-rose-200">
              <p className="font-bold">Customer: {deletingReturn.customer_name} ({deletingReturn.customer_phone})</p>
              <p>Available Balance: <strong>{formatPrice(deletingReturn.remaining_balance)}</strong></p>
            </div>

            <div className="space-y-2">
              <label className="flex items-start gap-3 p-3 rounded-xl border border-border bg-background cursor-pointer hover:bg-muted/40 transition">
                <input
                  type="radio"
                  name="delMode"
                  value="void"
                  checked={deleteReturnMode === "void"}
                  onChange={() => setDeleteReturnMode("void")}
                  className="mt-0.5"
                />
                <div>
                  <p className="text-xs font-bold text-foreground">Void Voucher Code (Recommended)</p>
                  <p className="text-[11px] text-muted-foreground">Cancels the voucher token, sets credit balance to ₹0, keeping audit logs.</p>
                </div>
              </label>
              <label className="flex items-start gap-3 p-3 rounded-xl border border-border bg-background cursor-pointer hover:bg-muted/40 transition">
                <input
                  type="radio"
                  name="delMode"
                  value="delete"
                  checked={deleteReturnMode === "delete"}
                  onChange={() => setDeleteReturnMode("delete")}
                  className="mt-0.5"
                />
                <div>
                  <p className="text-xs font-bold text-rose-600 dark:text-rose-400">Hard Delete Record</p>
                  <p className="text-[11px] text-muted-foreground">Permanently deletes return entry.</p>
                </div>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeletingReturn(null)}
                className="px-4 py-2 rounded-xl border border-border text-xs font-bold text-muted-foreground hover:bg-muted transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isMutating}
                onClick={handleConfirmDeleteReturn}
                className="px-5 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 disabled:opacity-50 transition cursor-pointer flex items-center gap-1.5 shadow-xs"
              >
                <Trash2 className="size-3.5" />
                <span>Confirm {deleteReturnMode === "void" ? "Void Voucher" : "Delete"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
