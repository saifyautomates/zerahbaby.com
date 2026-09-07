import { useState, useEffect, useCallback } from "react";
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
  Eye,
  Copy,
  Check,
  ExternalLink,
  X,
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
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleOpenQuery = useCallback((q: ContactMessageRecord) => {
    setSelectedQuery(q);
    setAdminNotesDraft(q.admin_notes || "");
  }, []);

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
    if (!selectedQuery) return undefined;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedQuery(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedQuery]);

  // Fetch real queries from database
  const {
    data: queries = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery<ContactMessageRecord[]>({
    queryKey: ["admin-queries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contact_messages")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      return (data ?? []) as unknown as ContactMessageRecord[];
    },
    refetchInterval: 15000,
  });

  // Real-time Supabase subscription
  useEffect(() => {
    const channel = supabase
      .channel("admin-queries-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "contact_messages" }, () => {
        qc.invalidateQueries({ queryKey: ["admin-queries"] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

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
        setAdminNotesDraft(updatedRecord.admin_notes || "");
      }
    },
    onError: (err: unknown) => {
      toast.error((err as Error).message || "Failed to update query");
    },
  });

  // Mutation: Delete query
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contact_messages").delete().eq("id", id);
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
      const { error } = await supabase.from("contact_messages").delete().in("id", ids);
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

  // Filter queries
  const filteredQueries = queries.filter((q) => {
    // 1. Search term match
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      const matchName = q.name?.toLowerCase().includes(term);
      const matchEmail = q.email?.toLowerCase().includes(term);
      const matchPhone = q.phone?.toLowerCase().includes(term);
      const matchOrder = q.order_number?.toLowerCase().includes(term);
      const matchMsg = q.message?.toLowerCase().includes(term);
      if (!matchName && !matchEmail && !matchPhone && !matchOrder && !matchMsg) {
        return false;
      }
    }

    // 2. Status filter
    if (statusFilter !== "ALL") {
      if (statusFilter === "ACTIVE") {
        if (q.status !== "new" && q.status !== "in_progress") return false;
      } else if (q.status !== statusFilter) {
        return false;
      }
    }

    // 3. Priority filter
    if (priorityFilter !== "ALL") {
      if (q.priority !== priorityFilter) return false;
    }

    return true;
  });

  // Metrics
  const totalCount = queries.length;
  const newCount = queries.filter((q) => q.status === "new").length;
  const inProgressCount = queries.filter((q) => q.status === "in_progress").length;
  const resolvedCount = queries.filter((q) => q.status === "resolved").length;

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight">
            Customer Inquiries & Support
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Authoritative inbox for customer questions, order support, and contact form messages.
            Click any row to view full details.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {selectedQueries.length > 0 && (
            <button
              type="button"
              onClick={() => bulkDeleteMutation.mutate(selectedQueries)}
              disabled={bulkDeleteMutation.isPending}
              className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2 text-sm font-bold text-red-600 shadow-xs hover:bg-red-100 transition disabled:opacity-50 cursor-pointer"
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
            onClick={() => {
              refetch();
              toast.success("Inquiries refreshed");
            }}
            disabled={isFetching}
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-medium shadow-xs hover:bg-muted transition disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`size-4 ${isFetching ? "animate-spin text-primary" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-xs">
          <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block">
            Total Queries
          </span>
          <span className="font-display text-2xl sm:text-3xl font-bold text-foreground mt-1 block">
            {totalCount}
          </span>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 shadow-xs">
          <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider block">
            New / Unread
          </span>
          <span className="font-display text-2xl sm:text-3xl font-bold text-amber-700 dark:text-amber-300 mt-1 block">
            {newCount}
          </span>
        </div>
        <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 shadow-xs">
          <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider block">
            In Progress
          </span>
          <span className="font-display text-2xl sm:text-3xl font-bold text-blue-700 dark:text-blue-300 mt-1 block">
            {inProgressCount}
          </span>
        </div>
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 shadow-xs">
          <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">
            Resolved
          </span>
          <span className="font-display text-2xl sm:text-3xl font-bold text-emerald-700 dark:text-emerald-300 mt-1 block">
            {resolvedCount}
          </span>
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

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-medium outline-none transition focus:border-primary cursor-pointer"
        >
          <option value="ALL">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="new">New</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
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
                      filteredQueries.length > 0 &&
                      selectedQueries.length === filteredQueries.length
                    }
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedQueries(filteredQueries.map((q) => q.id));
                      } else {
                        setSelectedQueries([]);
                      }
                    }}
                    className="size-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
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
                    No customer queries found.
                  </td>
                </tr>
              ) : (
                filteredQueries.map((q) => {
                  const isNew = q.status === "new";
                  const isResolved = q.status === "resolved";

                  return (
                    <tr
                      key={q.id}
                      onClick={() => handleOpenQuery(q)}
                      className={`group transition-colors hover:bg-primary/5 cursor-pointer ${
                        selectedQuery?.id === q.id ? "bg-muted/50" : ""
                      } ${isNew ? "bg-amber-500/[0.03] font-medium" : ""}`}
                      title="Click row to view full inquiry details"
                    >
                      <td
                        className="px-4 py-4 whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
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
                          className="size-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(q.created_at).toLocaleString("en-IN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="font-semibold">{q.name}</span>
                        <span className="block text-xs text-muted-foreground truncate">
                          {q.email}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">{q.order_number || "—"}</td>
                      <td className="px-4 py-3.5 max-w-[200px] truncate text-muted-foreground text-xs">
                        {q.message}
                      </td>
                      <td className="px-4 py-3.5 capitalize">{q.priority}</td>
                      <td className="px-4 py-3.5 capitalize">{q.status.replace("_", " ")}</td>
                      <td
                        className="px-4 py-3.5 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenQuery(q)}
                            className="inline-flex items-center justify-center size-7 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition shadow-xs cursor-pointer"
                            title="View inquiry details"
                          >
                            <Eye className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteMutation.mutate(q.id)}
                            disabled={deleteMutation.isPending}
                            className="inline-flex items-center justify-center size-7 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400 transition hover:bg-rose-500/20 focus:outline-none disabled:opacity-50 cursor-pointer"
                            title="Delete query"
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

      {/* Query Detail Modal */}
      {selectedQuery && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-6 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setSelectedQuery(null)}
        >
          <div
            className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-3xl border border-border bg-card shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4 bg-muted/20 shrink-0">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                  <MessageSquareText className="size-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-display text-lg font-bold text-foreground">
                      Inquiry from {selectedQuery.name}
                    </h3>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${
                        selectedQuery.status === "new"
                          ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                          : selectedQuery.status === "in_progress"
                            ? "bg-blue-500/10 text-blue-700 dark:text-blue-400"
                            : selectedQuery.status === "resolved"
                              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                              : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {selectedQuery.status.replace("_", " ")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <span>
                      Received{" "}
                      {new Date(selectedQuery.created_at).toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                    <span>•</span>
                    <span className="font-mono text-[11px]">
                      Ticket #{selectedQuery.id.substring(0, 8).toUpperCase()}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(selectedQuery.id, "Ticket ID")}
                      className="text-muted-foreground hover:text-foreground transition inline-flex items-center gap-1 cursor-pointer"
                      title="Copy full UUID"
                    >
                      {copiedKey === "Ticket ID" ? (
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
                onClick={() => setSelectedQuery(null)}
                className="size-8 rounded-xl border border-border flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Customer Information Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-2xl border border-border bg-muted/30 p-3.5 space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block">
                    Customer Email
                  </span>
                  <div className="flex items-center justify-between gap-1">
                    <a
                      href={`mailto:${selectedQuery.email}`}
                      className="font-semibold text-xs text-primary hover:underline truncate max-w-[140px]"
                    >
                      {selectedQuery.email}
                    </a>
                    <button
                      type="button"
                      onClick={() => handleCopy(selectedQuery.email, "Customer Email")}
                      className="text-muted-foreground hover:text-foreground transition p-0.5 cursor-pointer"
                    >
                      {copiedKey === "Customer Email" ? (
                        <Check className="size-3 text-emerald-600" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-muted/30 p-3.5 space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block">
                    Phone Number
                  </span>
                  <div className="flex items-center justify-between gap-1">
                    {selectedQuery.phone ? (
                      <>
                        <a
                          href={`tel:${selectedQuery.phone}`}
                          className="font-mono text-xs font-semibold text-foreground hover:text-primary"
                        >
                          {selectedQuery.phone}
                        </a>
                        <button
                          type="button"
                          onClick={() => handleCopy(selectedQuery.phone || "", "Phone Number")}
                          className="text-muted-foreground hover:text-foreground transition p-0.5 cursor-pointer"
                        >
                          {copiedKey === "Phone Number" ? (
                            <Check className="size-3 text-emerald-600" />
                          ) : (
                            <Copy className="size-3" />
                          )}
                        </button>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not provided</span>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-muted/30 p-3.5 space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block">
                    Order Reference
                  </span>
                  <div className="flex items-center justify-between gap-1">
                    {selectedQuery.order_number ? (
                      <>
                        <span className="font-mono text-xs font-bold text-foreground truncate max-w-[100px]">
                          {selectedQuery.order_number}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              handleCopy(selectedQuery.order_number || "", "Order Reference")
                            }
                            className="text-muted-foreground hover:text-foreground transition p-0.5 cursor-pointer"
                          >
                            {copiedKey === "Order Reference" ? (
                              <Check className="size-3 text-emerald-600" />
                            ) : (
                              <Copy className="size-3" />
                            )}
                          </button>
                          {onOpenOrder && (
                            <button
                              type="button"
                              onClick={() => {
                                onOpenOrder(selectedQuery.order_number || "");
                                setSelectedQuery(null);
                              }}
                              className="inline-flex items-center gap-0.5 text-[11px] font-bold text-primary hover:underline cursor-pointer"
                            >
                              <span>View</span>
                              <ExternalLink className="size-2.5" />
                            </button>
                          )}
                        </div>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">None</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Message Content Card */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-foreground">Customer Message</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(selectedQuery.message, "Customer Message")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted transition shadow-xs cursor-pointer"
                  >
                    {copiedKey === "Customer Message" ? (
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
                </div>
                <div className="rounded-2xl border border-border bg-muted/40 p-4 text-sm leading-relaxed whitespace-pre-wrap font-sans text-foreground select-text shadow-xs">
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
                        status: e.target.value as ContactMessageRecord["status"],
                        priority: selectedQuery.priority,
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
                        priority: e.target.value as ContactMessageRecord["priority"],
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
                <label className="text-xs font-semibold text-foreground mb-1.5 block">
                  Internal Team Notes
                </label>
                <textarea
                  rows={3}
                  value={adminNotesDraft}
                  onChange={(e) => setAdminNotesDraft(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background p-3 text-xs outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                <div className="flex justify-end mt-2">
                  <button
                    type="button"
                    disabled={
                      updateMutation.isPending ||
                      (selectedQuery.admin_notes || "") === adminNotesDraft
                    }
                    onClick={() =>
                      updateMutation.mutate({
                        id: selectedQuery.id,
                        status: selectedQuery.status,
                        priority: selectedQuery.priority,
                        admin_notes: adminNotesDraft,
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-xl bg-muted px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted/80 disabled:opacity-40 cursor-pointer shadow-xs"
                  >
                    <Save className="size-3.5" />
                    <span>Save Notes</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="border-t border-border px-6 py-4 bg-muted/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
              <a
                href={`mailto:${selectedQuery.email}?subject=${encodeURIComponent(
                  `Re: Your inquiry at Zérah Baby & Kids [Ticket #${selectedQuery.id.substring(0, 8).toUpperCase()}]`,
                )}`}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2 text-xs font-bold text-primary-foreground transition hover:opacity-90 cursor-pointer shadow-xs"
              >
                <Mail className="size-4" />
                <span>Reply via Email</span>
              </a>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("Are you sure you want to delete this customer query?")) {
                      deleteMutation.mutate(selectedQuery.id);
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-700 dark:text-rose-400 transition hover:bg-rose-500/20 cursor-pointer flex items-center gap-1.5"
                >
                  <Trash2 className="size-3.5" />
                  <span>Delete</span>
                </button>
                {selectedQuery.status !== "resolved" && (
                  <button
                    type="button"
                    onClick={() =>
                      updateMutation.mutate({
                        id: selectedQuery.id,
                        status: "resolved",
                        priority: selectedQuery.priority,
                        admin_notes: adminNotesDraft,
                      })
                    }
                    disabled={updateMutation.isPending}
                    className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400 transition hover:bg-emerald-500/20 cursor-pointer"
                  >
                    Mark as Resolved
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedQuery(null)}
                  className="rounded-xl border border-border bg-card px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer"
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
