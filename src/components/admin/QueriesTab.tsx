import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  MessageSquareText,
  Search,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Mail,
  Phone,
  ShoppingBag,
  User,
  Send,
  Save,
  ChevronRight,
  Filter,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

export interface ContactMessageRecord {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  order_number: string | null;
  message: string;
  status: "new" | "in_progress" | "resolved" | "closed";
  priority: "low" | "normal" | "high" | "urgent";
  admin_notes: string | null;
  handled: boolean;
  resolved_at: string | null;
  updated_at: string;
  created_at: string;
}

interface QueriesTabProps {
  onOpenOrder?: (orderId: string) => void;
}

export function QueriesTab({ onOpenOrder }: QueriesTabProps) {
  const qc = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [priorityFilter, setPriorityFilter] = useState<string>("ALL");
  const [selectedQuery, setSelectedQuery] = useState<ContactMessageRecord | null>(null);
  const [adminNotesDraft, setAdminNotesDraft] = useState("");
  const [selectedQueries, setSelectedQueries] = useState<string[]>([]);

  // Fetch real queries from database
  const {
    data: queries = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery<ContactMessageRecord[]>({
    queryKey: ["admin-queries"],
    queryFn: async () => {
      // Strategy 1: Direct table query
      const { data, error } = await supabase
        .from("contact_messages")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (!error && data) {
        return (data ?? []) as unknown as ContactMessageRecord[];
      }

      // Strategy 2: Secure admin RPC fallback
      const { data: rpcData, error: rpcErr } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: ContactMessageRecord[] | null; error: unknown }>
      )("get_admin_queries", { p_limit: 200 });

      if (rpcErr) {
        console.error("[QueriesTab] Dual fetch failure:", error || rpcErr);
        throw error || rpcErr;
      }
      return (rpcData ?? []) as unknown as ContactMessageRecord[];
    },
    refetchInterval: 15000,
  });

  // Real-time Supabase subscription
  useEffect(() => {
    const channel = supabase
      .channel("admin-queries-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "contact_messages" }, () => {
        qc.invalidateQueries({ queryKey: ["admin-queries"] });
        qc.invalidateQueries({ queryKey: ["admin-notif-contact-messages"] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  // Sync draft notes when selected query changes
  useEffect(() => {
    if (selectedQuery) {
      setAdminNotesDraft(selectedQuery.admin_notes || "");
    }
  }, [selectedQuery]);

  // Mutation: Update status, priority, and notes
  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      status,
      priority,
      admin_notes,
    }: {
      id: string;
      status: string;
      priority?: string;
      admin_notes?: string;
    }) => {
      const { data, error } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: ContactMessageRecord | null; error: { message: string } | null }>
      )("update_query_status", {
        p_query_id: id,
        p_status: status,
        p_priority: priority || null,
        p_admin_notes: admin_notes !== undefined ? admin_notes : null,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (updatedRecord) => {
      toast.success("Query updated successfully");
      qc.invalidateQueries({ queryKey: ["admin-queries"] });
      if (updatedRecord && selectedQuery?.id === updatedRecord.id) {
        setSelectedQuery(updatedRecord);
      }
    },
    onError: (err: unknown) => {
      toast.error((err as Error).message || "Failed to update query");
    },
  });

  // Mutation: Delete query
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("contact_messages")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      toast.success("Query deleted successfully");
      qc.invalidateQueries({ queryKey: ["admin-queries"] });
      setSelectedQuery(null);
    },
    onError: (err: unknown) => {
      toast.error((err as Error).message || "Failed to delete query");
    },
  });

  // Mutation: Bulk Delete queries
  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from("contact_messages")
        .delete()
        .in("id", ids);
      if (error) throw error;
      return ids;
    },
    onSuccess: () => {
      toast.success("Selected queries deleted successfully");
      setSelectedQueries([]);
      qc.invalidateQueries({ queryKey: ["admin-queries"] });
      setSelectedQuery(null);
    },
    onError: (err: unknown) => {
      toast.error((err as Error).message || "Failed to delete selected queries");
    },
  });

  // Metrics computation
  const metrics = {
    total: queries.length,
    new: queries.filter((q) => q.status === "new").length,
    inProgress: queries.filter((q) => q.status === "in_progress").length,
    resolved: queries.filter((q) => q.status === "resolved" || q.status === "closed").length,
  };

  // Client-side filtering
  const filteredQueries = queries.filter((q) => {
    // 1. Status Filter
    if (statusFilter !== "ALL") {
      if (statusFilter === "ACTIVE") {
        if (q.status === "resolved" || q.status === "closed") return false;
      } else if (q.status !== statusFilter) {
        return false;
      }
    }

    // 2. Priority Filter
    if (priorityFilter !== "ALL" && q.priority !== priorityFilter) {
      return false;
    }

    // 3. Search Filter
    if (searchTerm.trim()) {
      const query = searchTerm.toLowerCase().trim();
      const matchName = q.name?.toLowerCase().includes(query);
      const matchEmail = q.email?.toLowerCase().includes(query);
      const matchPhone = q.phone?.toLowerCase().includes(query);
      const matchOrder = q.order_number?.toLowerCase().includes(query);
      const matchMsg = q.message?.toLowerCase().includes(query);
      const matchId = q.id?.toLowerCase().includes(query);
      if (!matchName && !matchEmail && !matchPhone && !matchOrder && !matchMsg && !matchId) {
        return false;
      }
    }

    return true;
  });

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight">
            Customer Inquiries &amp; Support
          </h2>
          <p className="text-sm text-muted-foreground">
            Authoritative inbox for customer questions, order support, and contact form messages.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {selectedQueries.length > 0 && (
            <button
              onClick={() => bulkDeleteMutation.mutate(selectedQueries)}
              disabled={bulkDeleteMutation.isPending}
              className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2 text-sm font-bold text-red-600 shadow-sm hover:bg-red-100 transition disabled:opacity-50"
            >
              {bulkDeleteMutation.isPending ? (
                <RefreshCw className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Delete ({selectedQueries.length})
            </button>
          )}
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-2 self-start rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-medium transition hover:bg-muted/50 focus:outline-none disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw
              className={`size-4 ${isFetching ? "animate-spin text-primary" : "text-muted-foreground"}`}
            />
            <span>{isFetching ? "Syncing..." : "Refresh"}</span>
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-xs">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Total Queries
          </span>
          <p className="text-2xl font-black mt-1">{metrics.total}</p>
        </div>
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 shadow-xs">
          <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
            New / Unread
          </span>
          <p className="text-2xl font-black text-amber-700 dark:text-amber-400 mt-1">
            {metrics.new}
          </p>
        </div>
        <div className="rounded-2xl border border-blue-500/30 bg-blue-500/5 p-4 shadow-xs">
          <span className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wider">
            In Progress
          </span>
          <p className="text-2xl font-black text-blue-700 dark:text-blue-400 mt-1">
            {metrics.inProgress}
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 shadow-xs">
          <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
            Resolved
          </span>
          <p className="text-2xl font-black text-emerald-700 dark:text-emerald-400 mt-1">
            {metrics.resolved}
          </p>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by customer name, email, order #, or query..."
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
          className="rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-medium outline-none transition focus:border-primary cursor-pointer"
        >
          <option value="ALL">All Statuses</option>
          <option value="ACTIVE">Active (New &amp; In Progress)</option>
          <option value="new">New</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>

        {/* Priority Filter */}
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          aria-label="Filter by Priority"
          className="rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-medium outline-none transition focus:border-primary cursor-pointer"
        >
          <option value="ALL">All Priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* Queries Table */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-muted-foreground border-b border-border">
              <tr>
                <th className="px-4 py-3.5 w-10">
                  <input
                    type="checkbox"
                    checked={
                      filteredQueries.length > 0 && selectedQueries.length === filteredQueries.length
                    }
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedQueries(filteredQueries.map((q) => q.id));
                      } else {
                        setSelectedQueries([]);
                      }
                    }}
                    className="size-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                </th>
                <th className="px-4 py-3.5 font-semibold">Date</th>
                <th className="px-4 py-3.5 font-semibold">Customer</th>
                <th className="px-4 py-3.5 font-semibold">Order Ref</th>
                <th className="px-4 py-3.5 font-semibold">Message Preview</th>
                <th className="px-4 py-3.5 font-semibold">Priority</th>
                <th className="px-4 py-3.5 font-semibold">Status</th>
                <th className="px-4 py-3.5 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="size-6 animate-spin text-primary" />
                      <span>Loading customer inquiries...</span>
                    </div>
                  </td>
                </tr>
              ) : !filteredQueries.length ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center gap-1">
                      <MessageSquareText className="size-8 text-muted-foreground/50 mb-1" />
                      <span className="font-medium text-foreground">
                        No customer queries found.
                      </span>
                      <span className="text-xs">
                        {searchTerm || statusFilter !== "ALL" || priorityFilter !== "ALL"
                          ? "Try clearing filters to see more results."
                          : "Customer messages submitted via the 'Talk to Us' form will appear here automatically."}
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredQueries.map((q) => {
                  const isNew = q.status === "new";
                  const isInProgress = q.status === "in_progress";
                  const isResolved = q.status === "resolved";

                  return (
                    <tr
                      key={q.id}
                      onClick={() => setSelectedQuery(q)}
                      className={`group transition-colors hover:bg-muted/30 cursor-pointer ${
                        selectedQuery?.id === q.id ? "bg-muted/50" : ""
                      } ${isNew ? "bg-amber-500/[0.03] font-medium" : ""}`}
                    >
                      <td className="px-4 py-4 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedQueries.includes(q.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedQueries((prev) => [...prev, q.id]);
                            } else {
                              setSelectedQueries((prev) => prev.filter((id) => id !== q.id));
                            }
                          }}
                          className="size-4 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                      </td>
                      {/* Date */}
                      <td className="px-4 py-3.5 whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(q.created_at).toLocaleString("en-IN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </td>

                      {/* Customer */}
                      <td className="px-4 py-3.5">
                        <div className="leading-tight">
                          <span className="font-semibold text-foreground block">{q.name}</span>
                          <span className="text-xs text-muted-foreground block truncate max-w-[180px]">
                            {q.email}
                          </span>
                          {q.phone && (
                            <span className="text-[11px] text-muted-foreground font-mono block">
                              {q.phone}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Order Ref */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        {q.order_number ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-xs font-semibold text-primary">
                            <ShoppingBag className="size-3" />
                            {q.order_number}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>

                      {/* Message Preview */}
                      <td className="px-4 py-3.5 max-w-[240px]">
                        <p className="line-clamp-2 text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                          {q.message}
                        </p>
                      </td>

                      {/* Priority */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
                            q.priority === "urgent"
                              ? "bg-rose-500/10 text-rose-700 dark:text-rose-400"
                              : q.priority === "high"
                                ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                : q.priority === "low"
                                  ? "bg-slate-500/10 text-slate-700 dark:text-slate-400"
                                  : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {q.priority}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-xs">
                          {isNew ? (
                            <>
                              <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
                              <span className="font-bold text-amber-700 dark:text-amber-400">
                                New
                              </span>
                            </>
                          ) : isInProgress ? (
                            <>
                              <Clock className="size-3.5 text-blue-500" />
                              <span className="font-semibold text-blue-700 dark:text-blue-400">
                                In Progress
                              </span>
                            </>
                          ) : isResolved ? (
                            <>
                              <CheckCircle2 className="size-3.5 text-emerald-600" />
                              <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                Resolved
                              </span>
                            </>
                          ) : (
                            <>
                              <XCircle className="size-3.5 text-slate-500" />
                              <span className="font-semibold text-slate-700 dark:text-slate-400">
                                Closed
                              </span>
                            </>
                          )}
                        </div>
                      </td>

                      {/* Action */}
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedQuery(q);
                          }}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline cursor-pointer"
                        >
                          <span>View</span>
                          <ChevronRight className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Query Detail Modal */}
      {selectedQuery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-2xl rounded-3xl border border-border bg-card p-6 sm:p-8 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-border pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-display text-xl font-bold text-foreground">
                    Inquiry from {selectedQuery.name}
                  </h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                      selectedQuery.status === "new"
                        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        : selectedQuery.status === "in_progress"
                          ? "bg-blue-500/10 text-blue-700 dark:text-blue-400"
                          : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    }`}
                  >
                    {selectedQuery.status.replace("_", " ")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Received on{" "}
                  {new Date(selectedQuery.created_at).toLocaleString("en-IN", {
                    dateStyle: "full",
                    timeStyle: "medium",
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedQuery(null)}
                className="rounded-xl p-1.5 text-muted-foreground hover:bg-muted transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Customer Information Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-2xl border border-border bg-muted/40 p-3 text-xs">
                <span className="text-muted-foreground block font-medium">Customer Email</span>
                <a
                  href={`mailto:${selectedQuery.email}`}
                  className="font-semibold text-primary hover:underline break-all mt-0.5 block"
                >
                  {selectedQuery.email}
                </a>
              </div>
              <div className="rounded-2xl border border-border bg-muted/40 p-3 text-xs">
                <span className="text-muted-foreground block font-medium">Phone Number</span>
                {selectedQuery.phone ? (
                  <a
                    href={`tel:${selectedQuery.phone}`}
                    className="font-semibold text-foreground hover:text-primary mt-0.5 block font-mono"
                  >
                    {selectedQuery.phone}
                  </a>
                ) : (
                  <span className="text-muted-foreground mt-0.5 block">Not provided</span>
                )}
              </div>
              <div className="rounded-2xl border border-border bg-muted/40 p-3 text-xs">
                <span className="text-muted-foreground block font-medium">Order Number</span>
                {selectedQuery.order_number ? (
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="font-mono font-bold text-foreground">
                      {selectedQuery.order_number}
                    </span>
                    {onOpenOrder && (
                      <button
                        type="button"
                        onClick={() => {
                          onOpenOrder(selectedQuery.order_number || "");
                          setSelectedQuery(null);
                        }}
                        className="text-[11px] font-semibold text-primary hover:underline cursor-pointer"
                      >
                        View Order
                      </button>
                    )}
                  </div>
                ) : (
                  <span className="text-muted-foreground mt-0.5 block">None</span>
                )}
              </div>
            </div>

            {/* Message Body */}
            <div>
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block mb-1.5">
                Message
              </label>
              <div className="rounded-2xl border border-border bg-muted/30 p-4 text-sm leading-relaxed whitespace-pre-wrap font-sans text-foreground">
                {selectedQuery.message}
              </div>
            </div>

            {/* Status & Priority Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-border pt-4">
              <div>
                <label className="text-xs font-semibold text-foreground block mb-1.5">
                  Update Status
                </label>
                <select
                  value={selectedQuery.status}
                  onChange={(e) =>
                    updateMutation.mutate({
                      id: selectedQuery.id,
                      status: e.target.value,
                      admin_notes: adminNotesDraft,
                    })
                  }
                  disabled={updateMutation.isPending}
                  className="w-full rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-medium outline-none transition focus:border-primary cursor-pointer"
                >
                  <option value="new">New</option>
                  <option value="in_progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground block mb-1.5">
                  Priority
                </label>
                <select
                  value={selectedQuery.priority}
                  onChange={(e) =>
                    updateMutation.mutate({
                      id: selectedQuery.id,
                      status: selectedQuery.status,
                      priority: e.target.value,
                      admin_notes: adminNotesDraft,
                    })
                  }
                  disabled={updateMutation.isPending}
                  className="w-full rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-medium outline-none transition focus:border-primary cursor-pointer"
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>

            {/* Internal Admin Notes */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-foreground">
                  Internal Team Notes (Admin only)
                </label>
                {selectedQuery.admin_notes !== adminNotesDraft && (
                  <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                    Unsaved changes
                  </span>
                )}
              </div>
              <textarea
                rows={3}
                placeholder="Write private notes about this inquiry (call outcome, resolution details)..."
                value={adminNotesDraft}
                onChange={(e) => setAdminNotesDraft(e.target.value)}
                className="w-full rounded-xl border border-border bg-background p-3 text-xs outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <div className="flex justify-end mt-2">
                <button
                  type="button"
                  disabled={
                    updateMutation.isPending || selectedQuery.admin_notes === adminNotesDraft
                  }
                  onClick={() =>
                    updateMutation.mutate({
                      id: selectedQuery.id,
                      status: selectedQuery.status,
                      admin_notes: adminNotesDraft,
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-xl bg-muted px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted/80 disabled:opacity-40 cursor-pointer"
                >
                  <Save className="size-3.5" />
                  <span>Save Notes</span>
                </button>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-border pt-4">
              <a
                href={`mailto:${selectedQuery.email}?subject=${encodeURIComponent(
                  `Re: Your inquiry at Zérah Baby & Kids [Ticket #${selectedQuery.id.substring(0, 8).toUpperCase()}]`,
                )}`}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground transition hover:opacity-90 cursor-pointer shadow-xs"
              >
                <Mail className="size-4" />
                <span>Reply via Email</span>
              </a>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    deleteMutation.mutate(selectedQuery.id);
                  }}
                  disabled={deleteMutation.isPending}
                  className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs font-semibold text-rose-700 dark:text-rose-400 transition hover:bg-rose-500/20 cursor-pointer flex items-center gap-1"
                >
                  <Trash2 className="size-3.5" />
                  <span>{deleteMutation.isPending ? "Deleting..." : "Delete"}</span>
                </button>
                {selectedQuery.status !== "resolved" && (
                  <button
                    type="button"
                    onClick={() =>
                      updateMutation.mutate({
                        id: selectedQuery.id,
                        status: "resolved",
                        admin_notes: adminNotesDraft,
                      })
                    }
                    disabled={updateMutation.isPending}
                    className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 transition hover:bg-emerald-500/20 cursor-pointer"
                  >
                    Mark as Resolved
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedQuery(null)}
                  className="rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-semibold text-muted-foreground transition hover:bg-muted cursor-pointer"
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
