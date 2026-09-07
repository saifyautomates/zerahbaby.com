import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Search,
  RotateCcw,
  MessageSquare,
  User,
  Shield,
  Trash2,
  Eye,
  Copy,
  Check,
  ExternalLink,
  AlertTriangle,
  Smartphone,
  X,
  ShoppingBag,
  Receipt,
} from "lucide-react";
import { toast } from "sonner";

export type SMSLogRecord = {
  id: string;
  order_id: string | null;
  offline_sale_id: string | null;
  phone: string;
  message_type: string;
  recipient_type?: string | null;
  status: string;
  provider_status: string | null;
  error_details: string | null;
  idempotency_key: string | null;
  message_content: string | null;
  template_id: string | null;
  provider_message_id: string | null;
  retry_count: number;
  last_retried_at: string | null;
  sent_at: string | null;
  created_at: string;
};

export function SMSLogsTab() {
  const qc = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [eventFilter, setEventFilter] = useState<string>("ALL");
  const [selectedLogs, setSelectedLogs] = useState<string[]>([]);
  const [selectedLog, setSelectedLog] = useState<SMSLogRecord | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = useCallback((text: string, label: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(label);
    toast.success(`Copied ${label} to clipboard`);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === label ? null : prev));
    }, 2000);
  }, []);

  // Keyboard listener: Escape closes details modal
  useEffect(() => {
    if (!selectedLog) return undefined;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedLog(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedLog]);

  // Fetch real SMS logs from database
  const {
    data: logs,
    isLoading,
    isFetching,
    refetch,
  } = useQuery<SMSLogRecord[]>({
    queryKey: ["sms_logs"],
    queryFn: async () => {
      // Strategy 1: Direct table query
      const { data, error } = await supabase
        .from("sms_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (!error && data) {
        return (data ?? []) as unknown as SMSLogRecord[];
      }

      // Strategy 2: Secure admin RPC fallback
      const { data: rpcData, error: rpcErr } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: SMSLogRecord[] | null; error: unknown }>
      )("get_admin_sms_logs", { p_limit: 200 });

      if (rpcErr) {
        console.error("[SMSLogsTab] Dual fetch failure:", error || rpcErr);
        throw error || rpcErr;
      }
      return (rpcData ?? []) as unknown as SMSLogRecord[];
    },
    refetchInterval: 15000,
  });

  // Real-time Supabase subscription so newly dispatched logs appear instantly
  useEffect(() => {
    const channel = supabase
      .channel("admin-sms-logs-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "sms_logs" }, () => {
        qc.invalidateQueries({ queryKey: ["sms_logs"] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  // Safe retry mutation
  const retryMutation = useMutation({
    mutationFn: async (logId: string) => {
      const { data, error } = await supabase.functions.invoke("msg91-transactional", {
        body: { action: "retry", log_id: logId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data?.success) {
        toast.success("SMS re-dispatched successfully!");
      } else {
        toast.error(data?.log?.error_details || "Retry request failed at provider");
      }
      qc.invalidateQueries({ queryKey: ["sms_logs"] });
    },
    onError: (err: unknown) => {
      toast.error((err as Error).message || "Failed to trigger retry");
    },
  });

  // Safe delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (logId: string) => {
      const { error } = await supabase.from("sms_logs").delete().eq("id", logId);
      if (error) throw error;
      return logId;
    },
    onSuccess: (logId) => {
      toast.success("SMS log deleted successfully");
      setSelectedLogs((prev) => prev.filter((id) => id !== logId));
      if (selectedLog?.id === logId) {
        setSelectedLog(null);
      }
      qc.invalidateQueries({ queryKey: ["sms_logs"] });
    },
    onError: (err: unknown) => {
      toast.error((err as Error).message || "Failed to delete SMS log");
    },
  });

  // Bulk delete mutation
  const bulkDeleteMutation = useMutation({
    mutationFn: async (logIds: string[]) => {
      const { error } = await supabase.from("sms_logs").delete().in("id", logIds);
      if (error) throw error;
      return logIds;
    },
    onSuccess: () => {
      toast.success("Selected SMS logs deleted successfully");
      setSelectedLogs([]);
      qc.invalidateQueries({ queryKey: ["sms_logs"] });
    },
    onError: (err: unknown) => {
      toast.error((err as Error).message || "Failed to delete selected SMS logs");
    },
  });

  // Filter logs based on user input
  const filteredLogs = (logs || []).filter((log) => {
    // 1. Search term match (phone, order_id, offline_sale_id, message_content)
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();
      const matchPhone = log.phone?.toLowerCase().includes(q);
      const matchOrder = log.order_id?.toLowerCase().includes(q);
      const matchOffline = log.offline_sale_id?.toLowerCase().includes(q);
      const matchMsg = log.message_content?.toLowerCase().includes(q);
      if (!matchPhone && !matchOrder && !matchOffline && !matchMsg) {
        return false;
      }
    }

    // 2. Status filter
    if (statusFilter !== "ALL") {
      const isFailed = log.status === "FAILED" || log.provider_status === "error";
      const isSent =
        log.status === "SENT" ||
        log.provider_status === "sent" ||
        log.provider_status === "mock_success";
      const isPending = log.status === "PENDING" || log.provider_status === "pending";

      if (statusFilter === "SENT" && !isSent) return false;
      if (statusFilter === "FAILED" && !isFailed) return false;
      if (statusFilter === "PENDING" && !isPending) return false;
    }

    // 3. Event filter
    if (eventFilter !== "ALL") {
      if (log.message_type !== eventFilter) return false;
    }

    return true;
  });

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight">Transactional SMS Logs</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Track MSG91 delivery status, retries, and errors for system-generated messages. Click any row to view full details.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {selectedLogs.length > 0 && (
            <button
              onClick={() => bulkDeleteMutation.mutate(selectedLogs)}
              disabled={bulkDeleteMutation.isPending}
              className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2 text-sm font-bold text-red-600 shadow-sm hover:bg-red-100 transition disabled:opacity-50"
            >
              {bulkDeleteMutation.isPending ? (
                <RefreshCw className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Delete ({selectedLogs.length})
            </button>
          )}
          <button
            onClick={() => {
              refetch();
              toast.success("Refreshed from Supabase & RPC fallback");
            }}
            disabled={isFetching}
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-medium shadow-sm hover:bg-muted transition disabled:opacity-50"
          >
            <RefreshCw className={`size-4 ${isFetching ? "animate-spin text-primary" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by phone, Order ID, or POS sale..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-xl border border-border bg-card pl-10 pr-4 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {/* Status Filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by Status"
          className="rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-medium outline-none transition focus:border-primary"
        >
          <option value="ALL">All Statuses</option>
          <option value="SENT">Sent / Accepted</option>
          <option value="FAILED">Failed</option>
          <option value="PENDING">Pending</option>
        </select>

        {/* Event Filter */}
        <select
          value={eventFilter}
          onChange={(e) => setEventFilter(e.target.value)}
          aria-label="Filter by Event"
          className="rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-medium outline-none transition focus:border-primary"
        >
          <option value="ALL">All Events</option>
          <option value="online_sale">Online Sale</option>
          <option value="offline_pos_sale">Offline POS Sale</option>
          <option value="order_cancelled">Order Cancelled</option>
          <option value="pos_return">POS Return</option>
        </select>
      </div>

      {/* Table Container */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-muted-foreground border-b border-border">
              <tr>
                <th className="px-4 py-3.5">
                  <input
                    type="checkbox"
                    checked={filteredLogs.length > 0 && selectedLogs.length === filteredLogs.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedLogs(filteredLogs.map((l) => l.id));
                      } else {
                        setSelectedLogs([]);
                      }
                    }}
                    className="size-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3.5 font-semibold">Timestamp</th>
                <th className="px-4 py-3.5 font-semibold">Recipient</th>
                <th className="px-4 py-3.5 font-semibold">Phone</th>
                <th className="px-4 py-3.5 font-semibold">Event Type</th>
                <th className="px-4 py-3.5 font-semibold">Reference</th>
                <th className="px-4 py-3.5 font-semibold">Status</th>
                <th className="px-4 py-3.5 font-semibold">Error / Details</th>
                <th className="px-4 py-3.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="size-6 animate-spin text-primary" />
                      <span>Loading SMS logs...</span>
                    </div>
                  </td>
                </tr>
              ) : !filteredLogs.length ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center gap-1">
                      <MessageSquare className="size-8 text-muted-foreground/50 mb-1" />
                      <span className="font-medium text-foreground">No SMS logs found.</span>
                      <span className="text-xs">
                        {searchTerm || statusFilter !== "ALL" || eventFilter !== "ALL"
                          ? "Try clearing your filters to see older records."
                          : "Transactional SMS records will automatically appear here when sales are completed."}
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const isFailed = log.status === "FAILED" || log.provider_status === "error";
                  const isSent =
                    log.status === "SENT" ||
                    log.provider_status === "sent" ||
                    log.provider_status === "mock_success";
                  const isOwner = log.recipient_type === "owner";

                  return (
                    <tr
                      key={log.id}
                      onClick={() => setSelectedLog(log)}
                      className="transition-colors hover:bg-primary/5 cursor-pointer group"
                      title="Click row to view full details"
                    >
                      {/* Checkbox */}
                      <td className="px-4 py-3.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedLogs.includes(log.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedLogs((prev) => [...prev, log.id]);
                            } else {
                              setSelectedLogs((prev) => prev.filter((id) => id !== log.id));
                            }
                          }}
                          className="size-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                        />
                      </td>

                      {/* Timestamp */}
                      <td className="px-4 py-3.5 whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(log.created_at).toLocaleString("en-IN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </td>

                      {/* Recipient */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        {isOwner ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/10 px-2 py-0.5 text-[11px] font-semibold text-purple-700 dark:text-purple-300">
                            <Shield className="size-3" />
                            Store Owner
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:text-blue-300">
                            <User className="size-3" />
                            Customer
                          </span>
                        )}
                      </td>

                      {/* Phone */}
                      <td className="px-4 py-3.5 font-mono text-xs font-medium">{log.phone}</td>

                      {/* Event Type */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="inline-flex items-center rounded-lg bg-muted px-2 py-1 text-xs font-medium capitalize">
                          {log.message_type?.replace(/_/g, " ") || "Sale"}
                        </span>
                      </td>

                      {/* Order / Sale Reference */}
                      <td className="px-4 py-3.5 whitespace-nowrap font-mono text-xs text-muted-foreground">
                        {log.order_id ? (
                          <span title={`Order: ${log.order_id}`}>
                            ORD: {log.order_id.substring(0, 8)}
                          </span>
                        ) : log.offline_sale_id ? (
                          <span title={`POS Sale: ${log.offline_sale_id}`}>
                            POS: {log.offline_sale_id.substring(0, 8)}
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {isSent ? (
                            <>
                              <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                              <span className="text-emerald-700 dark:text-emerald-400 font-semibold text-xs">
                                {log.provider_status === "mock_success" ? "Sent (Sandbox)" : "Sent"}
                              </span>
                            </>
                          ) : isFailed ? (
                            <>
                              <XCircle className="size-4 text-destructive shrink-0" />
                              <span className="text-destructive font-semibold text-xs">Failed</span>
                            </>
                          ) : (
                            <>
                              <Clock className="size-4 text-amber-500 shrink-0" />
                              <span className="text-amber-700 dark:text-amber-400 font-semibold text-xs">
                                {log.status || "Pending"}
                              </span>
                            </>
                          )}
                        </div>
                      </td>

                      {/* Error / Details */}
                      <td className="px-4 py-3.5 text-xs max-w-[220px]">
                        {isFailed ? (
                          <span
                            className="text-destructive truncate font-medium block"
                            title={log.error_details || "Error"}
                          >
                            {log.error_details || "Unknown error"}
                          </span>
                        ) : log.message_content ? (
                          <span
                            className="text-primary hover:underline truncate block max-w-[190px] text-left cursor-pointer"
                            title="Click to view message content"
                          >
                            {log.message_content}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="px-4 py-3.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {/* View Details Eye Button */}
                          <button
                            type="button"
                            onClick={() => setSelectedLog(log)}
                            className="inline-flex items-center justify-center size-7 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition shadow-xs"
                            title="View all details"
                          >
                            <Eye className="size-3.5" />
                          </button>

                          {isFailed ? (
                            <button
                              type="button"
                              onClick={() => retryMutation.mutate(log.id)}
                              disabled={retryMutation.isPending}
                              className="inline-flex items-center gap-1 rounded-lg border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs font-semibold text-destructive transition hover:bg-destructive/20 focus:outline-none disabled:opacity-50"
                              title="Retry sending this SMS"
                            >
                              <RotateCcw
                                className={`size-3 ${retryMutation.isPending ? "animate-spin" : ""}`}
                              />
                              <span>Retry</span>
                            </button>
                          ) : log.retry_count > 0 ? (
                            <span className="text-[11px] text-muted-foreground px-1">
                              Retried ({log.retry_count})
                            </span>
                          ) : null}

                          <button
                            type="button"
                            onClick={() => deleteMutation.mutate(log.id)}
                            disabled={deleteMutation.isPending}
                            className="inline-flex items-center justify-center size-7 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400 transition hover:bg-rose-500/20 focus:outline-none disabled:opacity-50"
                            title="Delete SMS Log"
                          >
                            <Trash2 className="size-3.5" />
                            <span className="sr-only">Delete</span>
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

      {/* Complete SMS Details Modal */}
      {selectedLog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-6 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setSelectedLog(null)}
        >
          <div
            className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-3xl border border-border bg-card shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4 bg-muted/20 shrink-0">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                  <MessageSquare className="size-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-display text-lg font-bold text-foreground">
                      Transactional SMS Log
                    </h3>
                    <span className="inline-flex items-center rounded-lg bg-muted px-2.5 py-0.5 text-xs font-semibold capitalize text-foreground/80">
                      {selectedLog.message_type?.replace(/_/g, " ") || "Sale"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <span>
                      {new Date(selectedLog.created_at).toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                    <span>•</span>
                    <span className="font-mono text-[11px]">ID: {selectedLog.id.substring(0, 8)}...</span>
                    <button
                      type="button"
                      onClick={() => handleCopy(selectedLog.id, "Log ID")}
                      className="text-muted-foreground hover:text-foreground transition inline-flex items-center gap-1"
                      title="Copy full UUID"
                    >
                      {copiedKey === "Log ID" ? (
                        <Check className="size-3 text-emerald-600" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="size-8 rounded-xl border border-border flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Delivery Status & Recipient Hero Bar */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 rounded-2xl bg-muted/30 border border-border/80">
                {/* Status */}
                <div className="space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block">
                    Delivery Status
                  </span>
                  <div className="flex items-center gap-1.5">
                    {selectedLog.status === "SENT" ||
                    selectedLog.provider_status === "sent" ||
                    selectedLog.provider_status === "mock_success" ? (
                      <>
                        <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                        <span className="text-emerald-700 dark:text-emerald-400 font-bold text-sm">
                          {selectedLog.provider_status === "mock_success"
                            ? "Sent (Sandbox)"
                            : "Delivered (MSG91)"}
                        </span>
                      </>
                    ) : selectedLog.status === "FAILED" || selectedLog.provider_status === "error" ? (
                      <>
                        <XCircle className="size-4 text-destructive shrink-0" />
                        <span className="text-destructive font-bold text-sm">Failed</span>
                      </>
                    ) : (
                      <>
                        <Clock className="size-4 text-amber-500 shrink-0" />
                        <span className="text-amber-700 dark:text-amber-400 font-bold text-sm">
                          {selectedLog.status || "Pending"}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Recipient Role */}
                <div className="space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block">
                    Recipient Type
                  </span>
                  <div>
                    {selectedLog.recipient_type === "owner" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/10 px-2.5 py-0.5 text-xs font-semibold text-purple-700 dark:text-purple-300">
                        <Shield className="size-3.5" />
                        Store Owner
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                        <User className="size-3.5" />
                        Customer
                      </span>
                    )}
                  </div>
                </div>

                {/* Phone */}
                <div className="space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block">
                    Phone Number
                  </span>
                  <div className="flex items-center gap-1.5 font-mono text-sm font-semibold text-foreground">
                    <Smartphone className="size-3.5 text-muted-foreground" />
                    <span>{selectedLog.phone}</span>
                    <button
                      type="button"
                      onClick={() => handleCopy(selectedLog.phone, "Phone Number")}
                      className="text-muted-foreground hover:text-foreground transition p-0.5"
                      title="Copy phone"
                    >
                      {copiedKey === "Phone Number" ? (
                        <Check className="size-3 text-emerald-600" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* SMS Message Content */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-foreground">
                      Full SMS Message Content
                    </span>
                    <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
                      {selectedLog.message_content?.length ?? 0} chars
                    </span>
                  </div>
                  {selectedLog.message_content && (
                    <button
                      type="button"
                      onClick={() => handleCopy(selectedLog.message_content || "", "SMS Message")}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted transition shadow-xs"
                    >
                      {copiedKey === "SMS Message" ? (
                        <>
                          <Check className="size-3 text-emerald-600" />
                          <span className="text-emerald-600">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="size-3" />
                          <span>Copy Message</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                <div className="rounded-2xl border border-border bg-muted/40 p-4 font-sans text-sm leading-relaxed whitespace-pre-wrap select-text text-foreground shadow-xs">
                  {selectedLog.message_content ? (
                    selectedLog.message_content
                  ) : (
                    <span className="text-muted-foreground italic text-xs">
                      No message text captured in log record.
                    </span>
                  )}
                </div>
              </div>

              {/* Error Details Box (if failed or error is present) */}
              {(selectedLog.status === "FAILED" || selectedLog.error_details) && (
                <div className="rounded-2xl border border-red-200 bg-red-50/70 dark:border-red-900/50 dark:bg-red-950/30 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-red-700 dark:text-red-400 font-semibold text-xs uppercase tracking-wide">
                    <AlertTriangle className="size-4 shrink-0" />
                    <span>Error Details / Gateway Response</span>
                  </div>
                  <div className="font-mono text-xs text-red-900 dark:text-red-300 bg-red-100/50 dark:bg-red-900/20 rounded-xl p-3 select-text overflow-x-auto whitespace-pre-wrap">
                    {selectedLog.error_details || "Unknown dispatch failure"}
                  </div>
                </div>
              )}

              {/* Associated Reference (Order or POS Sale) */}
              {(selectedLog.order_id || selectedLog.offline_sale_id) && (
                <div className="space-y-2">
                  <span className="font-semibold text-sm text-foreground">
                    Associated Reference
                  </span>
                  <div className="rounded-2xl border border-border p-3.5 bg-card flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                    <div className="flex items-center gap-3">
                      <div className="size-9 rounded-xl bg-muted flex items-center justify-center text-muted-foreground shrink-0">
                        {selectedLog.order_id ? (
                          <ShoppingBag className="size-4 text-primary" />
                        ) : (
                          <Receipt className="size-4 text-amber-600" />
                        )}
                      </div>
                      <div>
                        <span className="text-[11px] text-muted-foreground uppercase font-medium tracking-wider block">
                          {selectedLog.order_id ? "Online Store Order" : "Offline POS Sale"}
                        </span>
                        <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-foreground">
                          <span>{selectedLog.order_id || selectedLog.offline_sale_id}</span>
                          <button
                            type="button"
                            onClick={() =>
                              handleCopy(
                                selectedLog.order_id || selectedLog.offline_sale_id || "",
                                "Reference ID",
                              )
                            }
                            className="text-muted-foreground hover:text-foreground transition p-0.5"
                            title="Copy full reference UUID"
                          >
                            {copiedKey === "Reference ID" ? (
                              <Check className="size-3 text-emerald-600" />
                            ) : (
                              <Copy className="size-3" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    {selectedLog.order_id ? (
                      <a
                        href={`/admin?tab=orders&search=${selectedLog.order_id}`}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-muted/50 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition shrink-0"
                      >
                        <ExternalLink className="size-3" />
                        <span>View Order</span>
                      </a>
                    ) : (
                      <a
                        href="/admin?tab=billing"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-muted/50 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition shrink-0"
                      >
                        <ExternalLink className="size-3" />
                        <span>View Billing / POS</span>
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Technical Specifications Grid */}
              <div className="space-y-2">
                <span className="font-semibold text-sm text-foreground">
                  Technical Specifications & Gateway Trace
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {/* Provider Message ID */}
                  <div className="rounded-xl border border-border/70 p-3 bg-muted/20">
                    <span className="text-[11px] text-muted-foreground font-medium block">
                      Provider Request ID (MSG91)
                    </span>
                    <div className="flex items-center justify-between mt-1">
                      <span className="font-mono text-xs font-medium text-foreground truncate max-w-[200px]">
                        {selectedLog.provider_message_id || "None / Local Sandbox"}
                      </span>
                      {selectedLog.provider_message_id && (
                        <button
                          type="button"
                          onClick={() =>
                            handleCopy(selectedLog.provider_message_id || "", "Provider Message ID")
                          }
                          className="text-muted-foreground hover:text-foreground transition"
                        >
                          {copiedKey === "Provider Message ID" ? (
                            <Check className="size-3 text-emerald-600" />
                          ) : (
                            <Copy className="size-3" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Template / Flow ID */}
                  <div className="rounded-xl border border-border/70 p-3 bg-muted/20">
                    <span className="text-[11px] text-muted-foreground font-medium block">
                      DLT Template / MSG91 Flow ID
                    </span>
                    <div className="flex items-center justify-between mt-1">
                      <span className="font-mono text-xs font-medium text-foreground truncate max-w-[200px]">
                        {selectedLog.template_id || "Standard Template"}
                      </span>
                      {selectedLog.template_id && (
                        <button
                          type="button"
                          onClick={() =>
                            handleCopy(selectedLog.template_id || "", "Template ID")
                          }
                          className="text-muted-foreground hover:text-foreground transition"
                        >
                          {copiedKey === "Template ID" ? (
                            <Check className="size-3 text-emerald-600" />
                          ) : (
                            <Copy className="size-3" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Idempotency Key */}
                  <div className="rounded-xl border border-border/70 p-3 bg-muted/20">
                    <span className="text-[11px] text-muted-foreground font-medium block">
                      Idempotency Key
                    </span>
                    <div className="flex items-center justify-between mt-1">
                      <span className="font-mono text-xs font-medium text-foreground truncate max-w-[200px]" title={selectedLog.idempotency_key || ""}>
                        {selectedLog.idempotency_key || "None"}
                      </span>
                      {selectedLog.idempotency_key && (
                        <button
                          type="button"
                          onClick={() =>
                            handleCopy(selectedLog.idempotency_key || "", "Idempotency Key")
                          }
                          className="text-muted-foreground hover:text-foreground transition"
                        >
                          {copiedKey === "Idempotency Key" ? (
                            <Check className="size-3 text-emerald-600" />
                          ) : (
                            <Copy className="size-3" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Sent At Timestamp */}
                  <div className="rounded-xl border border-border/70 p-3 bg-muted/20">
                    <span className="text-[11px] text-muted-foreground font-medium block">
                      Sent / Dispatched At
                    </span>
                    <span className="text-xs font-medium text-foreground mt-1 block">
                      {selectedLog.sent_at
                        ? new Date(selectedLog.sent_at).toLocaleString("en-IN", {
                            dateStyle: "medium",
                            timeStyle: "medium",
                          })
                        : "Pending dispatch"}
                    </span>
                  </div>

                  {/* Retries & Last Attempt */}
                  <div className="rounded-xl border border-border/70 p-3 bg-muted/20 sm:col-span-2">
                    <span className="text-[11px] text-muted-foreground font-medium block">
                      Retry History
                    </span>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs font-medium text-foreground">
                        {selectedLog.retry_count === 0
                          ? "0 retries (Initial delivery attempt)"
                          : `${selectedLog.retry_count} retry attempt(s)`}
                      </span>
                      {selectedLog.last_retried_at && (
                        <span className="text-xs text-muted-foreground">
                          Last retried:{" "}
                          {new Date(selectedLog.last_retried_at).toLocaleString("en-IN", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="border-t border-border px-6 py-4 bg-muted/20 flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("Are you sure you want to delete this SMS log?")) {
                    deleteMutation.mutate(selectedLog.id);
                  }
                }}
                disabled={deleteMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-700 dark:text-rose-400 hover:bg-rose-500/20 transition disabled:opacity-50"
              >
                <Trash2 className="size-3.5" />
                <span>Delete Log</span>
              </button>

              <div className="flex items-center gap-2">
                {(selectedLog.status === "FAILED" || selectedLog.error_details) && (
                  <button
                    type="button"
                    onClick={() => retryMutation.mutate(selectedLog.id)}
                    disabled={retryMutation.isPending}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-destructive text-destructive-foreground px-4 py-2 text-xs font-semibold shadow-xs hover:opacity-90 transition disabled:opacity-50"
                  >
                    <RotateCcw
                      className={`size-3.5 ${retryMutation.isPending ? "animate-spin" : ""}`}
                    />
                    <span>Retry Dispatch</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setSelectedLog(null)}
                  className="rounded-xl border border-border bg-card px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

