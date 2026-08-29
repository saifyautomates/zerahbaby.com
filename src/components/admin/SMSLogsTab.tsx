import { useState, useEffect } from "react";
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
  const [activeMessagePreview, setActiveMessagePreview] = useState<string | null>(null);

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
      const { data, error } = await supabase
        .from("sms_logs")
        .delete()
        .eq("id", logId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("SMS log deleted successfully");
      qc.invalidateQueries({ queryKey: ["sms_logs"] });
    },
    onError: (err: unknown) => {
      toast.error((err as Error).message || "Failed to delete SMS log");
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
          <p className="text-sm text-muted-foreground">
            Authoritative delivery audit for online orders, POS sales, cancellations, and returns.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-2 self-start rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-medium transition hover:bg-muted/50 focus:outline-none disabled:opacity-50"
        >
          <RefreshCw
            className={`size-4 ${isFetching ? "animate-spin text-primary" : "text-muted-foreground"}`}
          />
          <span>{isFetching ? "Syncing..." : "Refresh"}</span>
        </button>
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
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="size-6 animate-spin text-primary" />
                      <span>Loading SMS logs...</span>
                    </div>
                  </td>
                </tr>
              ) : !filteredLogs.length ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
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
                    <tr key={log.id} className="transition-colors hover:bg-muted/30">
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
                      <td className="px-4 py-3.5 text-xs max-w-[200px]">
                        {isFailed ? (
                          <span
                            className="text-destructive truncate block"
                            title={log.error_details || "Error"}
                          >
                            {log.error_details || "Unknown error"}
                          </span>
                        ) : log.message_content ? (
                          <button
                            type="button"
                            onClick={() => setActiveMessagePreview(log.message_content)}
                            className="text-primary hover:underline truncate block max-w-[180px] text-left"
                            title="Click to view message content"
                          >
                            {log.message_content}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          {isFailed ? (
                            <button
                              type="button"
                              onClick={() => retryMutation.mutate(log.id)}
                              disabled={retryMutation.isPending}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive transition hover:bg-destructive/20 focus:outline-none disabled:opacity-50"
                              title="Retry sending this SMS"
                            >
                              <RotateCcw
                                className={`size-3 ${retryMutation.isPending ? "animate-spin" : ""}`}
                              />
                              <span>Retry</span>
                            </button>
                          ) : log.retry_count > 0 ? (
                            <span className="text-[11px] text-muted-foreground">
                              Retried ({log.retry_count})
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteMutation.mutate(log.id);
                            }}
                            disabled={deleteMutation.isPending}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:text-rose-400 transition hover:bg-rose-500/20 focus:outline-none disabled:opacity-50 ml-2"
                            title="Delete SMS Log"
                          >
                            <Trash2 className="size-3" />
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

      {/* Message Content Modal / Dialog */}
      {activeMessagePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">SMS Content Preview</h3>
              <button
                type="button"
                onClick={() => setActiveMessagePreview(null)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
              >
                ✕
              </button>
            </div>
            <div className="rounded-xl bg-muted/60 p-4 font-sans text-sm leading-relaxed border border-border">
              {activeMessagePreview}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setActiveMessagePreview(null)}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
