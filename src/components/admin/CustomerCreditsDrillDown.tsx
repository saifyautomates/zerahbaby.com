import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatPrice, imageFor } from "@/lib/store";
import { safeLower, safeUpper } from "@/lib/utils";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Coins,
  Search,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Copy,
  User,
  Phone,
  RefreshCw,
  Package,
  Layers,
  ChevronRight,
  Receipt,
  RotateCcw,
  Edit3,
  X,
  Check,
} from "lucide-react";
import type {
  DrillDownProduct,
  DrillDownReturn,
  DrillDownPOSSale,
} from "./DashboardDrillDown";

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
  status: "ACTIVE" | "PARTIALLY_USED" | "CONSUMED" | "VOIDED";
  linked_sale_id?: string | null;
  notes?: string;
  items: Array<{
    id: string;
    name: string;
    sku: string;
    qty: number;
    refund_price: number;
    product_slug?: string;
    product_id?: string;
  }>;
  raw: any;
}

interface CustomerCreditsDrillDownProps {
  onBack: () => void;
  dateRangeText?: string;
  offlineReturns?: DrillDownReturn[];
  products?: DrillDownProduct[];
  posSales?: DrillDownPOSSale[];
}

export function CustomerCreditsDrillDown({
  onBack,
  dateRangeText,
  offlineReturns: propReturns = [],
  products = [],
}: CustomerCreditsDrillDownProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterTab, setFilterTab] = useState<"active" | "all" | "consumed">("active");
  const [settlingVoucher, setSettlingVoucher] = useState<ReturnCreditRow | null>(null);
  const [editingVoucher, setEditingVoucher] = useState<ReturnCreditRow | null>(null);
  const [editBalance, setEditBalance] = useState("");
  const [editNotes, setEditNotes] = useState("");

  // Live query for all offline_returns with items
  const {
    data: liveReturns = [],
    isLoading: returnsLoading,
    refetch: refetchReturns,
  } = useQuery({
    queryKey: ["admin-drilldown-offline-returns-credits"],
    staleTime: 1000 * 30,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("offline_returns")
        .select("*, offline_return_items(*)")
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) {
        console.error("Failed to fetch returns for credits drilldown:", error);
        return [];
      }
      return data ?? [];
    },
  });

  // Live query for POS customers with credit balances
  const {
    data: liveCustomers = [],
    isLoading: customersLoading,
    refetch: refetchCustomers,
  } = useQuery({
    queryKey: ["admin-pos-customers-credit-drilldown"],
    staleTime: 1000 * 30,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pos_customers")
        .select("id, name, phone, email, store_credit_balance, store_credit, updated_at");
      if (error) return [];
      return data ?? [];
    },
  });

  const effectiveReturns = liveReturns.length > 0 ? liveReturns : propReturns;

  // Transform and calculate authoritative remaining balance per return voucher
  const returnCreditRows: ReturnCreditRow[] = useMemo(() => {
    return effectiveReturns.map((r: any) => {
      const refundAmount = Number(r.refund_amount || r.refund_total || 0);
      const creditUsed = Number(r.credit_used || 0);
      const explicitBalance =
        r.credit_balance !== undefined && r.credit_balance !== null
          ? Number(r.credit_balance)
          : null;
      const calcBalance = Math.max(0, refundAmount - creditUsed);
      const remainingBalance = explicitBalance !== null ? Math.max(0, explicitBalance) : calcBalance;

      let statusStr = safeUpper(r.credit_token_status || "ACTIVE");
      let status: ReturnCreditRow["status"] = "ACTIVE";
      if (statusStr === "CONSUMED" || remainingBalance <= 0) {
        status = "CONSUMED";
      } else if (statusStr === "VOIDED") {
        status = "VOIDED";
      } else if (statusStr === "PARTIALLY_USED" || creditUsed > 0) {
        status = "PARTIALLY_USED";
      }

      const items = (r.offline_return_items || []).map((item: any) => ({
        id: item.id,
        name: item.name || item.product_name || "Returned Item",
        sku: item.sku || "",
        qty: Number(item.qty || item.quantity || 1),
        refund_price: Number(item.refund_price || item.total || 0),
        product_slug: item.product_slug,
        product_id: item.product_id,
      }));

      return {
        id: r.id,
        return_number: r.return_number || `RET-${r.id.slice(0, 8)}`,
        date: r.created_at ? format(new Date(r.created_at), "MMM dd, yyyy • hh:mm a") : "—",
        customer_name: r.customer_name?.trim() || "Walk-in Customer",
        customer_phone: r.customer_phone || "",
        customer_id: r.customer_id,
        credit_token: r.credit_token || r.return_number || "",
        refund_amount: refundAmount,
        credit_used: creditUsed,
        remaining_balance: remainingBalance,
        status,
        linked_sale_id: r.linked_sale_id,
        notes: r.notes || "",
        items,
        raw: r,
      };
    });
  }, [effectiveReturns]);

  // Total All-Time Active Credit Calculation
  const totalAccountCredit = useMemo(() => {
    return liveCustomers.reduce(
      (sum, c) => sum + Math.max(0, Number(c.store_credit_balance || (c as any).store_credit || 0)),
      0,
    );
  }, [liveCustomers]);

  const activeVouchersCount = useMemo(() => {
    return returnCreditRows.filter((r) => r.remaining_balance > 0 && r.status !== "VOIDED").length;
  }, [returnCreditRows]);

  const totalVoucherCredit = useMemo(() => {
    return returnCreditRows
      .filter((r) => r.remaining_balance > 0 && r.status !== "VOIDED")
      .reduce((sum, r) => sum + r.remaining_balance, 0);
  }, [returnCreditRows]);

  const customersWithCreditCount = useMemo(() => {
    return liveCustomers.filter(
      (c) => Math.max(0, Number(c.store_credit_balance || (c as any).store_credit || 0)) > 0,
    ).length;
  }, [liveCustomers]);

  // Filtered list based on search and tab
  const filteredRows = useMemo(() => {
    let list = returnCreditRows;

    if (filterTab === "active") {
      list = list.filter((r) => r.remaining_balance > 0 && r.status !== "VOIDED");
    } else if (filterTab === "consumed") {
      list = list.filter((r) => r.remaining_balance <= 0 || r.status === "CONSUMED");
    }

    const q = safeLower(search);
    if (!q) return list;

    return list.filter((r) => {
      const matchName = safeLower(r.customer_name).includes(q);
      const matchPhone = safeLower(r.customer_phone).includes(q);
      const matchNum = safeLower(r.return_number).includes(q);
      const matchToken = safeLower(r.credit_token).includes(q);
      const matchItem = r.items.some(
        (it) => safeLower(it.name).includes(q) || safeLower(it.sku).includes(q),
      );
      return matchName || matchPhone || matchNum || matchToken || matchItem;
    });
  }, [returnCreditRows, filterTab, search]);

  // Settle Mutation
  const settleMutation = useMutation({
    mutationFn: async (row: ReturnCreditRow) => {
      const newNotes = row.notes
        ? `${row.notes}\n[Settled ₹${row.remaining_balance.toFixed(2)} by admin on ${format(new Date(), "MMM dd, yyyy • hh:mm a")}]`
        : `[Settled ₹${row.remaining_balance.toFixed(2)} by admin on ${format(new Date(), "MMM dd, yyyy • hh:mm a")}]`;

      // 1. Update the return record in offline_returns
      const { error: retError } = await supabase
        .from("offline_returns")
        .update({
          credit_used: row.refund_amount,
          credit_balance: 0,
          credit_token_status: "CONSUMED",
          notes: newNotes,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      if (retError) throw retError;

      // 2. Reconcile customer's remaining credit across all other active returns
      const cleanPhone = (row.customer_phone || "").replace(/\D/g, "").slice(-10);
      if (cleanPhone) {
        // Query other active returns for this customer
        const { data: otherReturns } = await supabase
          .from("offline_returns")
          .select("id, refund_amount, credit_used, credit_balance, credit_token_status")
          .neq("id", row.id);

        let remainingForPhone = 0;
        if (otherReturns) {
          for (const oRet of otherReturns) {
            const st = safeUpper((oRet as any).credit_token_status || "ACTIVE");
            if (st === "CONSUMED" || st === "VOIDED") continue;
            const rAmt = Number(oRet.refund_amount || 0);
            const cUsed = Number(oRet.credit_used || 0);
            const rBal =
              oRet.credit_balance !== undefined && oRet.credit_balance !== null
                ? Number(oRet.credit_balance)
                : Math.max(0, rAmt - cUsed);
            if (rBal > 0) remainingForPhone += rBal;
          }
        }

        // Update pos_customers
        await supabase
          .from("pos_customers")
          .update({
            store_credit_balance: remainingForPhone,
            store_credit: remainingForPhone,
            updated_at: new Date().toISOString(),
          })
          .ilike("phone", `%${cleanPhone}%`);

        // Update profiles
        await supabase
          .from("profiles")
          .update({
            store_credit_balance: remainingForPhone,
            updated_at: new Date().toISOString(),
          })
          .ilike("phone", `%${cleanPhone}%`);
      }

      return row;
    },
    onSuccess: (row) => {
      toast.success(
        `Credit voucher ${row.return_number} (₹${row.remaining_balance.toFixed(2)}) settled successfully!`,
      );
      setSettlingVoucher(null);
      refetchReturns();
      refetchCustomers();
      queryClient.invalidateQueries({ queryKey: ["admin-pos-customers-credit"] });
      queryClient.invalidateQueries({ queryKey: ["offline-returns"] });
      queryClient.invalidateQueries({ queryKey: ["admin-drilldown-offline-returns-credits"] });
    },
    onError: (err: any) => {
      console.error("Settlement error:", err);
      toast.error(err?.message || "Failed to settle credit voucher. Please retry.");
    },
  });

  // Edit Balance Mutation
  const editMutation = useMutation({
    mutationFn: async ({
      row,
      newBalance,
      note,
    }: {
      row: ReturnCreditRow;
      newBalance: number;
      note?: string;
    }) => {
      const sanitizedBalance = Math.max(0, Math.min(row.refund_amount, newBalance));
      const newCreditUsed = Math.max(0, row.refund_amount - sanitizedBalance);
      const newStatus = sanitizedBalance <= 0 ? "CONSUMED" : "ACTIVE";
      const timestamp = format(new Date(), "MMM dd, yyyy • hh:mm a");
      const appendNote = note?.trim()
        ? `[Balance updated to ₹${sanitizedBalance.toFixed(2)} on ${timestamp}: ${note.trim()}]`
        : `[Balance updated to ₹${sanitizedBalance.toFixed(2)} by admin on ${timestamp}]`;
      const newNotes = row.notes ? `${row.notes}\n${appendNote}` : appendNote;

      const { error: retError } = await supabase
        .from("offline_returns")
        .update({
          credit_used: newCreditUsed,
          credit_balance: sanitizedBalance,
          credit_token_status: newStatus,
          notes: newNotes,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      if (retError) throw retError;

      // Reconcile customer balances
      const cleanPhone = (row.customer_phone || "").replace(/\D/g, "").slice(-10);
      if (cleanPhone) {
        const { data: otherReturns } = await supabase
          .from("offline_returns")
          .select("id, refund_amount, credit_used, credit_balance, credit_token_status")
          .neq("id", row.id);

        let totalForPhone = sanitizedBalance;
        if (otherReturns) {
          for (const oRet of otherReturns) {
            const st = safeUpper((oRet as any).credit_token_status || "ACTIVE");
            if (st === "CONSUMED" || st === "VOIDED") continue;
            const rAmt = Number(oRet.refund_amount || 0);
            const cUsed = Number(oRet.credit_used || 0);
            const rBal =
              oRet.credit_balance !== undefined && oRet.credit_balance !== null
                ? Number(oRet.credit_balance)
                : Math.max(0, rAmt - cUsed);
            if (rBal > 0) totalForPhone += rBal;
          }
        }

        await supabase
          .from("pos_customers")
          .update({
            store_credit_balance: totalForPhone,
            store_credit: totalForPhone,
            updated_at: new Date().toISOString(),
          })
          .ilike("phone", `%${cleanPhone}%`);

        await supabase
          .from("profiles")
          .update({
            store_credit_balance: totalForPhone,
            updated_at: new Date().toISOString(),
          })
          .ilike("phone", `%${cleanPhone}%`);
      }

      return { row, newBalance: sanitizedBalance };
    },
    onSuccess: ({ row, newBalance }) => {
      toast.success(
        `Voucher ${row.return_number} balance updated to ₹${newBalance.toFixed(2)}`,
      );
      setEditingVoucher(null);
      refetchReturns();
      refetchCustomers();
      queryClient.invalidateQueries({ queryKey: ["admin-pos-customers-credit"] });
      queryClient.invalidateQueries({ queryKey: ["offline-returns"] });
      queryClient.invalidateQueries({ queryKey: ["admin-drilldown-offline-returns-credits"] });
    },
    onError: (err: any) => {
      console.error("Edit balance error:", err);
      toast.error(err?.message || "Failed to update voucher balance. Please retry.");
    },
  });

  const getProductImage = (item: { product_slug?: string; product_id?: string; name: string }) => {
    const prod = products.find(
      (p) =>
        (item.product_id && p.id === item.product_id) ||
        (item.product_slug && p.slug === item.product_slug) ||
        (item.name && safeLower(p.name) === safeLower(item.name)),
    );
    return (
      (prod as any)?.image ||
      (prod as any)?.image_url ||
      prod?.product_images?.[0]?.public_url ||
      imageFor(prod?.category || "clothing", null, prod)
    );
  };

  const copyToClipboard = (text: string, label: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    toast.success(`Copied ${label} to clipboard!`);
  };

  return (
    <div className="space-y-6 text-foreground animate-in fade-in duration-150">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2 rounded-xl border border-border bg-card hover:bg-muted transition text-foreground cursor-pointer shadow-xs"
            title="Back to Executive Dashboard"
            aria-label="Back to Executive Dashboard"
          >
            <ArrowLeft className="size-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                <Coins className="size-5" />
              </span>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">
                Customer Store Credits &amp; Return Vouchers
              </h1>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live inventory of customer return credit vouchers, balances, and 1-click settlement.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              refetchReturns();
              refetchCustomers();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-card text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer shadow-xs"
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Top 3 KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Total Active Return Credit Balance */}
        <div className="rounded-2xl p-5 text-white bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-900 shadow-sm flex flex-col justify-between min-h-[120px]">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-white/80">Total Active Return Credits</p>
              <h2 className="text-3xl font-black tracking-tight mt-1">
                {returnsLoading ? "..." : formatPrice(totalVoucherCredit)}
              </h2>
            </div>
            <div className="opacity-20">
              <Coins className="size-8" />
            </div>
          </div>
          <p className="text-[11px] text-white/70 mt-2">
            Holding across {activeVouchersCount} active return vouchers
          </p>
        </div>

        {/* Active Return Vouchers */}
        <div className="rounded-2xl p-5 text-white bg-gradient-to-br from-emerald-800 to-teal-900 shadow-sm flex flex-col justify-between min-h-[120px]">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-white/80">Active Return Vouchers</p>
              <h2 className="text-3xl font-black tracking-tight mt-1">
                {returnsLoading ? "..." : `${activeVouchersCount} Vouchers`}
              </h2>
            </div>
            <div className="opacity-20">
              <Receipt className="size-8" />
            </div>
          </div>
          <p className="text-[11px] text-white/70 mt-2">
            Total voucher balance: {formatPrice(totalVoucherCredit)}
          </p>
        </div>

        {/* Action Status */}
        <div className="rounded-2xl p-5 text-white bg-gradient-to-br from-slate-800 to-slate-900 shadow-sm flex flex-col justify-between min-h-[120px]">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-white/80">1-Click Settlement Ready</p>
              <h2 className="text-xl font-bold tracking-tight mt-1 flex items-center gap-2">
                <CheckCircle2 className="size-5 text-emerald-400" />
                Audited &amp; Synchronized
              </h2>
            </div>
            <div className="opacity-20">
              <RotateCcw className="size-8" />
            </div>
          </div>
          <p className="text-[11px] text-white/70 mt-2">
            Settling clears voucher to ₹0 and updates customer balance
          </p>
        </div>
      </div>

      {/* Search and Tabs Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-card p-3 rounded-2xl border border-border shadow-xs">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by customer name, phone, return voucher #, or product name..."
            className="w-full pl-10 pr-4 py-2 text-xs rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>

        {/* Tab Selector */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {[
            { id: "active", label: `Active Vouchers (${activeVouchersCount})` },
            { id: "all", label: `All Vouchers (${returnCreditRows.length})` },
            { id: "consumed", label: `Settled / Consumed (${returnCreditRows.length - activeVouchersCount})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterTab(tab.id as any)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                filterTab === tab.id
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Return Vouchers Table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/50 border-b border-border text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Voucher No &amp; Date</th>
                <th className="py-3 px-4">Returned Products</th>
                <th className="py-3 px-4 text-right">Original Value</th>
                <th className="py-3 px-4 text-right">Used</th>
                <th className="py-3 px-4 text-right">Remaining Balance</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {returnsLoading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-muted-foreground">
                    <RefreshCw className="size-6 animate-spin mx-auto mb-2 text-primary" />
                    Loading customer store credits and return vouchers...
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-muted-foreground">
                    <Coins className="size-8 mx-auto mb-2 text-muted-foreground/50" />
                    No credit vouchers found matching your criteria.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const hasRemaining = row.remaining_balance > 0;
                  return (
                    <tr
                      key={row.id}
                      className="hover:bg-muted/40 transition-colors group"
                    >
                      {/* Customer Info */}
                      <td className="py-3 px-4">
                        <div className="font-bold text-foreground text-sm flex items-center gap-1.5">
                          <User className="size-3.5 text-muted-foreground shrink-0" />
                          <span>{row.customer_name}</span>
                        </div>
                        {row.customer_phone && (
                          <div className="flex items-center gap-1.5 mt-0.5 text-muted-foreground">
                            <Phone className="size-3 shrink-0" />
                            <span>{row.customer_phone}</span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(row.customer_phone, "Phone")}
                              className="opacity-0 group-hover:opacity-100 transition p-0.5 hover:text-foreground"
                              title="Copy Phone"
                            >
                              <Copy className="size-2.5" />
                            </button>
                          </div>
                        )}
                      </td>

                      {/* Voucher & Date */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-semibold text-foreground flex items-center gap-1">
                          <Receipt className="size-3 text-indigo-500 shrink-0" />
                          <span>{row.return_number}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{row.date}</p>
                      </td>

                      {/* Returned Products */}
                      <td className="py-3 px-4 min-w-[220px]">
                        {row.items.length === 0 ? (
                          <span className="text-muted-foreground italic">Returned item details</span>
                        ) : (
                          <div className="space-y-1.5">
                            {row.items.map((it, idx) => {
                              const img = getProductImage(it);
                              return (
                                <div key={idx} className="flex items-center gap-2">
                                  <img
                                    src={img}
                                    alt={it.name}
                                    className="size-7 rounded-md object-cover border border-border bg-muted shrink-0"
                                    loading="lazy"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <p className="font-medium text-foreground truncate max-w-[200px]" title={it.name}>
                                      {it.name}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground">
                                      x{it.qty} • {formatPrice(it.refund_price)}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </td>

                      {/* Original Value */}
                      <td className="py-3 px-4 text-right font-medium text-muted-foreground whitespace-nowrap">
                        {formatPrice(row.refund_amount)}
                      </td>

                      {/* Used */}
                      <td className="py-3 px-4 text-right text-muted-foreground whitespace-nowrap">
                        {row.credit_used > 0 ? (
                          <span className="font-semibold text-rose-600 dark:text-rose-400">
                            -{formatPrice(row.credit_used)}
                          </span>
                        ) : (
                          "₹0"
                        )}
                      </td>

                      {/* Remaining Balance */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {hasRemaining ? (
                          <span className="inline-block px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-extrabold text-sm">
                            {formatPrice(row.remaining_balance)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground font-semibold">₹0</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        {row.status === "ACTIVE" ? (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                            ACTIVE
                          </span>
                        ) : row.status === "PARTIALLY_USED" ? (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20">
                            PARTIAL
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-muted text-muted-foreground border border-border">
                            SETTLED
                          </span>
                        )}
                      </td>

                      {/* Settle & Edit Actions */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingVoucher(row);
                              setEditBalance(String(row.remaining_balance));
                              setEditNotes("");
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-border bg-card hover:bg-muted text-foreground font-semibold text-xs transition cursor-pointer"
                            title="Edit remaining balance"
                          >
                            <Edit3 className="size-3.5 text-muted-foreground" />
                            Edit
                          </button>
                          {hasRemaining ? (
                            <button
                              type="button"
                              onClick={() => setSettlingVoucher(row)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-xs hover:shadow transition cursor-pointer"
                              title="Settle this credit voucher to ₹0"
                            >
                              <CheckCircle2 className="size-3.5" />
                              Settle
                            </button>
                          ) : (
                            <span className="text-muted-foreground text-[11px] font-medium px-1">
                              Settled
                            </span>
                          )}
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

      {/* Settle Confirmation Modal */}
      {settlingVoucher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-100">
          <div className="bg-card border border-border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-3 rounded-xl bg-amber-500/15 text-amber-600 shrink-0">
                <AlertCircle className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold text-foreground">
                  Confirm Store Credit Settlement
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Are you sure you want to mark this return voucher as fully settled?
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-muted/60 border border-border space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Customer:</span>
                <span className="font-bold text-foreground">{settlingVoucher.customer_name}</span>
              </div>
              {settlingVoucher.customer_phone && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Phone:</span>
                  <span className="font-medium text-foreground">{settlingVoucher.customer_phone}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Voucher Number:</span>
                <span className="font-medium text-foreground">{settlingVoucher.return_number}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-border/80">
                <span className="font-bold text-foreground">Remaining Balance to Settle:</span>
                <span className="font-black text-rose-600 dark:text-rose-400 text-sm">
                  {formatPrice(settlingVoucher.remaining_balance)}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">
              This action will set the voucher's credit balance to ₹0, mark it as CONSUMED, and update the customer's available store credit across your store.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSettlingVoucher(null)}
                disabled={settleMutation.isPending}
                className="px-4 py-2 rounded-xl border border-border bg-card hover:bg-muted text-xs font-semibold text-foreground transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => settleMutation.mutate(settlingVoucher)}
                disabled={settleMutation.isPending}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                {settleMutation.isPending ? (
                  <>
                    <RefreshCw className="size-3.5 animate-spin" />
                    Settling...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="size-3.5" />
                    Confirm Settle
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Voucher Balance Modal */}
      {editingVoucher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-100">
          <div className="bg-card border border-border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-xl bg-indigo-500/15 text-indigo-600 shrink-0">
                  <Edit3 className="size-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground">
                    Edit Return Credit Balance
                  </h3>
                  <p className="text-xs text-muted-foreground font-mono">
                    {editingVoucher.return_number} • {editingVoucher.credit_token}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingVoucher(null)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-muted/60 border border-border space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Customer:</span>
                <span className="font-bold text-foreground">{editingVoucher.customer_name}</span>
              </div>
              {editingVoucher.customer_phone && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Phone:</span>
                  <span className="font-medium text-foreground">{editingVoucher.customer_phone}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Original Return Value:</span>
                <span className="font-semibold text-foreground">{formatPrice(editingVoucher.refund_amount)}</span>
              </div>
              <div className="flex justify-between pt-1.5 border-t border-border/80">
                <span className="text-muted-foreground">Current Balance:</span>
                <span className="font-bold text-indigo-600 dark:text-indigo-400">
                  {formatPrice(editingVoucher.remaining_balance)}
                </span>
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const num = parseFloat(editBalance);
                if (isNaN(num) || num < 0) {
                  toast.error("Please enter a valid balance amount (≥ 0)");
                  return;
                }
                if (num > editingVoucher.refund_amount) {
                  toast.error(`Balance cannot exceed original refund value of ₹${editingVoucher.refund_amount}`);
                  return;
                }
                editMutation.mutate({
                  row: editingVoucher,
                  newBalance: num,
                  note: editNotes,
                });
              }}
              className="space-y-3.5"
            >
              <div>
                <label className="block text-xs font-bold text-foreground mb-1">
                  New Remaining Balance (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={editingVoucher.refund_amount}
                  value={editBalance}
                  onChange={(e) => setEditBalance(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-border bg-background text-foreground text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="0.00"
                  required
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Enter ₹0 to fully settle/consume this voucher, or enter an adjusted balance.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Reason / Notes (Optional)
                </label>
                <input
                  type="text"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g. In-store adjustment, cash exchange"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setEditingVoucher(null)}
                  disabled={editMutation.isPending}
                  className="px-4 py-2 rounded-xl border border-border bg-card hover:bg-muted text-xs font-semibold text-foreground transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editMutation.isPending}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  {editMutation.isPending ? (
                    <>
                      <RefreshCw className="size-3.5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Check className="size-3.5" />
                      Save Balance
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
