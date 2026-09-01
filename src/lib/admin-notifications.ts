import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AdminNotificationType =
  | "order_new"
  | "order_cancelled"
  | "order_failed"
  | "inventory_low"
  | "email_failed"
  | "contact_message"
  | "pos_sale"
  | "pos_return";

export interface AdminNotification {
  id: string;
  type: AdminNotificationType;
  title: string;
  message: string;
  timestamp: string;
  tab: string;
  filter?: string;
  read: boolean;
  priority: "high" | "normal" | "low";
}

const READ_NOTIFS_STORAGE_KEY = "zerah-admin-read-notifs";
const DISMISSED_NOTIFS_STORAGE_KEY = "zerah-admin-dismissed-notifs";

function getStoredReadIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(READ_NOTIFS_STORAGE_KEY);
    if (raw) {
      return new Set(JSON.parse(raw));
    }
  } catch {
    // Ignore storage parse error
  }
  return new Set();
}

function persistReadIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(READ_NOTIFS_STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // Ignore storage write error
  }
}

function getStoredDismissedIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(DISMISSED_NOTIFS_STORAGE_KEY);
    if (raw) {
      return new Set(JSON.parse(raw));
    }
  } catch {
    // Ignore storage parse error
  }
  return new Set();
}

function persistDismissedIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DISMISSED_NOTIFS_STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // Ignore storage write error
  }
}

export function useAdminNotifications() {
  const qc = useQueryClient();
  const [readIds, setReadIds] = useState<Set<string>>(() => getStoredReadIds());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => getStoredDismissedIds());

  // 1. Fetch actionable orders (placed, processing, cancelled, or failed payment)
  const { data: rawOrders = [] } = useQuery({
    queryKey: ["admin-notif-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, full_name, total, status, payment_status, cancellation_reason, created_at, cancelled_at",
        )
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) return [];
      return data ?? [];
    },
    staleTime: 15_000,
  });

  // 2. Fetch low-stock products (stock <= 5)
  const { data: rawLowStock = [] } = useQuery({
    queryKey: ["admin-notif-low-stock"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, slug, stock, sku")
        .lte("stock", 5)
        .order("stock", { ascending: true })
        .limit(10);
      if (error) return [];
      return data ?? [];
    },
    staleTime: 60_000,
  });

  // 3. Fetch failed owner notification emails
  const { data: rawFailedLogs = [] } = useQuery({
    queryKey: ["admin-notif-failed-emails"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("owner_notification_logs")
        .select("id, reference_number, event_type, created_at, error_message")
        .eq("status", "failed")
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) return [];
      return data ?? [];
    },
    staleTime: 60_000,
  });

  // 4. Fetch new customer queries (status = 'new')
  const { data: rawQueries = [] } = useQuery({
    queryKey: ["admin-notif-contact-messages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contact_messages")
        .select("id, name, email, order_number, message, priority, created_at, status")
        .eq("status", "new")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) return [];
      return data ?? [];
    },
    staleTime: 15_000,
  });

  // 5. Fetch recent offline POS sales
  const { data: rawOfflineSales = [] } = useQuery({
    queryKey: ["admin-notif-offline-sales"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("offline_sales")
        .select("id, sale_number, customer_name, total, payment_method, pos_token_number, created_at, status")
        .order("created_at", { ascending: false })
        .limit(15);
      if (error) return [];
      return (data ?? []) as {
        id: string;
        sale_number: string;
        customer_name: string | null;
        total: number;
        payment_method: string;
        pos_token_number: number | null;
        created_at: string;
        status?: string;
      }[];
    },
    staleTime: 10_000,
  });

  // 6. Fetch recent offline POS returns
  const { data: rawOfflineReturns = [] } = useQuery({
    queryKey: ["admin-notif-offline-returns"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("offline_returns")
        .select("id, return_number, customer_name, refund_amount, refund_method, return_reason, created_at, status")
        .order("created_at", { ascending: false })
        .limit(15);
      if (error) return [];
      return (data ?? []) as {
        id: string;
        return_number: string;
        customer_name: string | null;
        refund_amount: number;
        refund_method: string;
        return_reason: string | null;
        created_at: string;
        status?: string;
      }[];
    },
    staleTime: 10_000,
  });

  // Realtime subscription to invalidate notifications immediately on new sales/orders/returns
  useEffect(() => {
    const channel = supabase
      .channel("admin-notifications-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "offline_sales" },
        () => {
          qc.invalidateQueries({ queryKey: ["admin-notif-offline-sales"] });
          qc.invalidateQueries({ queryKey: ["offline-sales"] });
          qc.invalidateQueries({ queryKey: ["offline-sales-badge-count"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "offline_returns" },
        () => {
          qc.invalidateQueries({ queryKey: ["admin-notif-offline-returns"] });
          qc.invalidateQueries({ queryKey: ["offline-returns"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => {
          qc.invalidateQueries({ queryKey: ["admin-notif-orders"] });
          qc.invalidateQueries({ queryKey: ["admin-orders"] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);


  // Combine and sort notifications
  const notifications = useMemo<AdminNotification[]>(() => {
    const list: AdminNotification[] = [];

    // Process Orders
    for (const ord of rawOrders) {
      const shortId = ord.id.slice(0, 8).toUpperCase();
      if (ord.status === "placed" || ord.status === "processing") {
        list.push({
          id: `order-new-${ord.id}`,
          type: "order_new",
          title: `New Online Order #${shortId}`,
          message: `${ord.full_name || "Customer"} placed an order (₹${ord.total})`,
          timestamp: ord.created_at,
          tab: "orders",
          filter: ord.status,
          read: readIds.has(`order-new-${ord.id}`),
          priority: "high",
        });
      } else if (ord.status === "cancelled") {
        list.push({
          id: `order-cancel-${ord.id}`,
          type: "order_cancelled",
          title: `Order Cancelled #${shortId}`,
          message: `${ord.full_name || "Customer"}: ${ord.cancellation_reason || "No reason given"}`,
          timestamp: ord.cancelled_at || ord.created_at,
          tab: "orders",
          filter: "cancelled",
          read: readIds.has(`order-cancel-${ord.id}`),
          priority: "normal",
        });
      }

      if (ord.payment_status === "failed") {
        list.push({
          id: `order-failed-${ord.id}`,
          type: "order_failed",
          title: `Payment Failed #${shortId}`,
          message: `Payment attempt failed for ${ord.full_name}`,
          timestamp: ord.created_at,
          tab: "orders",
          filter: "all",
          read: readIds.has(`order-failed-${ord.id}`),
          priority: "high",
        });
      }
    }

    // Process Offline POS Sales
    for (const sale of rawOfflineSales) {
      if (sale.status === "cancelled") continue;
      const tokenStr = sale.pos_token_number != null ? ` (Token #${sale.pos_token_number})` : "";
      list.push({
        id: `pos-sale-${sale.id}`,
        type: "pos_sale",
        title: `POS Offline Sale #${sale.sale_number}${tokenStr}`,
        message: `${sale.customer_name || "Walk-in Customer"} • ₹${Number(sale.total).toLocaleString("en-IN")} via ${sale.payment_method?.toUpperCase() || "CASH"}`,
        timestamp: sale.created_at,
        tab: "billing",
        filter: "sales",
        read: readIds.has(`pos-sale-${sale.id}`),
        priority: "high",
      });
    }

    // Process Offline POS Returns
    for (const ret of rawOfflineReturns) {
      if (ret.status === "cancelled") continue;
      list.push({
        id: `pos-return-${ret.id}`,
        type: "pos_return",
        title: `POS Return #${ret.return_number}`,
        message: `${ret.customer_name || "Walk-in Customer"} • Refunded ₹${Number(ret.refund_amount).toLocaleString("en-IN")} via ${ret.refund_method?.toUpperCase() || "CASH"}${ret.return_reason ? ` (${ret.return_reason})` : ""}`,
        timestamp: ret.created_at,
        tab: "billing",
        filter: "returns",
        read: readIds.has(`pos-return-${ret.id}`),
        priority: "normal",
      });
    }

    // Process Low Stock
    for (const prod of rawLowStock) {
      list.push({
        id: `stock-${prod.id}`,
        type: "inventory_low",
        title: `Low Stock Alert`,
        message: `"${prod.name}" has only ${prod.stock} unit${prod.stock === 1 ? "" : "s"} left in stock.`,
        timestamp: new Date().toISOString(),
        tab: "products",
        read: readIds.has(`stock-${prod.id}`),
        priority: prod.stock === 0 ? "high" : "normal",
      });
    }

    // Process Failed Emails
    for (const log of rawFailedLogs) {
      list.push({
        id: `email-failed-${log.id}`,
        type: "email_failed",
        title: `Owner Email Failed`,
        message: `Alert for ${log.reference_number || log.event_type} failed: ${log.error_message || "Delivery error"}`,
        timestamp: log.created_at || new Date().toISOString(),
        tab: "orders",
        read: readIds.has(`email-failed-${log.id}`),
        priority: "normal",
      });
    }

    // Process Contact Inquiries
    for (const q of rawQueries) {
      list.push({
        id: `query-${q.id}`,
        type: "contact_message",
        title: `Inquiry: ${q.name}`,
        message: q.order_number ? `[Order #${q.order_number}] ${q.message}` : q.message,
        timestamp: q.created_at,
        tab: "queries",
        read: readIds.has(`query-${q.id}`),
        priority: q.priority === "urgent" || q.priority === "high" ? "high" : "normal",
      });
    }

    // Filter out dismissed notifications and sort by unread first, then date descending
    return list
      .filter((n) => !dismissedIds.has(n.id))
      .sort((a, b) => {
        if (a.read !== b.read) return a.read ? 1 : -1;
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });
  }, [rawOrders, rawOfflineSales, rawOfflineReturns, rawLowStock, rawFailedLogs, rawQueries, readIds, dismissedIds]);

  const unreadCount = useMemo(() => {
    return notifications.filter((n) => !n.read).length;
  }, [notifications]);

  const markAsRead = useCallback((id: string) => {
    setReadIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      persistReadIds(next);
      return next;
    });
  }, []);

  const markAllAsRead = useCallback(() => {
    setReadIds((prev) => {
      const next = new Set(prev);
      notifications.forEach((n) => next.add(n.id));
      persistReadIds(next);
      return next;
    });
  }, [notifications]);

  const deleteNotification = useCallback(
    async (id: string) => {
      setDismissedIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        persistDismissedIds(next);
        return next;
      });

      if (id.startsWith("query-")) {
        const rawId = id.replace("query-", "");
        try {
          await supabase.from("contact_messages").delete().eq("id", rawId);
          qc.invalidateQueries({ queryKey: ["admin-notif-contact-messages"] });
          qc.invalidateQueries({ queryKey: ["admin-queries"] });
        } catch {
          // Ignore DB error, already dismissed locally
        }
      }
    },
    [qc],
  );

  const clearAllNotifications = useCallback(async () => {
    const currentNotifs = notifications;
    setDismissedIds((prev) => {
      const next = new Set(prev);
      currentNotifs.forEach((n) => next.add(n.id));
      persistDismissedIds(next);
      return next;
    });

    const queryIds = currentNotifs
      .filter((n) => n.id.startsWith("query-"))
      .map((n) => n.id.replace("query-", ""));

    if (queryIds.length > 0) {
      try {
        await supabase.from("contact_messages").delete().in("id", queryIds);
        qc.invalidateQueries({ queryKey: ["admin-notif-contact-messages"] });
        qc.invalidateQueries({ queryKey: ["admin-queries"] });
      } catch {
        // Ignore
      }
    }
  }, [notifications, qc]);

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["admin-notif-orders"] });
    qc.invalidateQueries({ queryKey: ["admin-notif-offline-sales"] });
    qc.invalidateQueries({ queryKey: ["admin-notif-offline-returns"] });
    qc.invalidateQueries({ queryKey: ["admin-notif-low-stock"] });
    qc.invalidateQueries({ queryKey: ["admin-notif-failed-emails"] });
    qc.invalidateQueries({ queryKey: ["admin-notif-contact-messages"] });
    qc.invalidateQueries({ queryKey: ["offline-sales"] });
    qc.invalidateQueries({ queryKey: ["offline-returns"] });
  }, [qc]);


  return {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAllNotifications,
    refresh,
  };
}
