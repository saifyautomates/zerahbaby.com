import { useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AdminNotificationType =
  | "order_new"
  | "order_cancelled"
  | "order_failed"
  | "inventory_low"
  | "email_failed"
  | "contact_message"
  | "pos_sale"
  | "pos_return"
  | "online_return";

export interface AdminNotification {
  id: string;
  event_key: string;
  type: AdminNotificationType;
  title: string;
  message: string;
  timestamp: string;
  tab: string;
  filter?: string;
  read: boolean;
  priority: "high" | "normal" | "low";
}

interface RawAdminNotificationRow {
  id: string;
  event_key: string;
  type: string;
  title: string;
  message: string;
  tab: string;
  filter: string | null;
  priority: string;
  is_read: boolean;
  is_dismissed: boolean;
  created_at: string;
}

export function useAdminNotifications() {
  const qc = useQueryClient();

  // 1. Authoritative Database Fetch (Single Query, Zero Client-Side Heuristics)
  const { data: rawRows = [], isLoading } = useQuery<RawAdminNotificationRow[]>({
    queryKey: ["admin-database-notifications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_notifications")
        .select(
          "id, event_key, type, title, message, tab, filter, priority, is_read, is_dismissed, created_at",
        )
        .eq("is_dismissed", false)
        .order("is_read", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(60);

      if (error) {
        console.error("Failed to fetch admin notifications:", error);
        return [];
      }
      return (data as unknown as RawAdminNotificationRow[]) || [];
    },
    staleTime: 10_000,
  });

  // 2. Realtime Synchronization — Single Authoritative Channel
  useEffect(() => {
    const channel = supabase
      .channel("admin-notifications-stream")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "admin_notifications" },
        () => {
          qc.invalidateQueries({ queryKey: ["admin-database-notifications"] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  // 3. Mark Single Notification as Read
  const markAsReadMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("admin_notifications")
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) throw error;
      return id;
    },
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ["admin-database-notifications"] });
      const prev = qc.getQueryData<RawAdminNotificationRow[]>(["admin-database-notifications"]);
      if (prev) {
        qc.setQueryData<RawAdminNotificationRow[]>(
          ["admin-database-notifications"],
          prev.map((row) => (row.id === id ? { ...row, is_read: true } : row)),
        );
      }
      return { prev };
    },
    onError: (_err, _id, context) => {
      if (context?.prev) {
        qc.setQueryData(["admin-database-notifications"], context.prev);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["admin-database-notifications"] });
    },
  });

  // 4. Mark All Notifications as Read
  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("admin_notifications")
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
        })
        .eq("is_read", false);

      if (error) throw error;
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["admin-database-notifications"] });
      const prev = qc.getQueryData<RawAdminNotificationRow[]>(["admin-database-notifications"]);
      if (prev) {
        qc.setQueryData<RawAdminNotificationRow[]>(
          ["admin-database-notifications"],
          prev.map((row) => ({ ...row, is_read: true })),
        );
      }
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) {
        qc.setQueryData(["admin-database-notifications"], context.prev);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["admin-database-notifications"] });
    },
  });

  // 5. Dismiss Single Notification
  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("admin_notifications")
        .update({
          is_dismissed: true,
          dismissed_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) throw error;
      return id;
    },
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ["admin-database-notifications"] });
      const prev = qc.getQueryData<RawAdminNotificationRow[]>(["admin-database-notifications"]);
      if (prev) {
        qc.setQueryData<RawAdminNotificationRow[]>(
          ["admin-database-notifications"],
          prev.filter((row) => row.id !== id),
        );
      }
      return { prev };
    },
    onError: (_err, _id, context) => {
      if (context?.prev) {
        qc.setQueryData(["admin-database-notifications"], context.prev);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["admin-database-notifications"] });
    },
  });

  // 6. Clear All Notifications (Dismiss all)
  const clearAllMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("admin_notifications")
        .update({
          is_dismissed: true,
          dismissed_at: new Date().toISOString(),
        })
        .eq("is_dismissed", false);

      if (error) throw error;
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["admin-database-notifications"] });
      const prev = qc.getQueryData<RawAdminNotificationRow[]>(["admin-database-notifications"]);
      qc.setQueryData<RawAdminNotificationRow[]>(["admin-database-notifications"], []);
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) {
        qc.setQueryData(["admin-database-notifications"], context.prev);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["admin-database-notifications"] });
    },
  });

  // 7. Hard Delete Single Notification (permanent removal from DB)
  const hardDeleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("admin_notifications").delete().eq("id", id);

      if (error) throw error;
      return id;
    },
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ["admin-database-notifications"] });
      const prev = qc.getQueryData<RawAdminNotificationRow[]>(["admin-database-notifications"]);
      if (prev) {
        qc.setQueryData<RawAdminNotificationRow[]>(
          ["admin-database-notifications"],
          prev.filter((row) => row.id !== id),
        );
      }
      return { prev };
    },
    onError: (_err, _id, context) => {
      if (context?.prev) {
        qc.setQueryData(["admin-database-notifications"], context.prev);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["admin-database-notifications"] });
    },
  });

  // 8. Strict Client-Side Deduplication & Normalization
  const notifications = useMemo<AdminNotification[]>(() => {
    const seenEventKeys = new Set<string>();
    const deduplicated: AdminNotification[] = [];

    for (const row of rawRows) {
      if (seenEventKeys.has(row.event_key)) continue;
      seenEventKeys.add(row.event_key);

      deduplicated.push({
        id: row.id,
        event_key: row.event_key,
        type: row.type as AdminNotificationType,
        title: row.title,
        message: row.message,
        timestamp: row.created_at,
        tab: row.tab || "dashboard",
        filter: row.filter || undefined,
        read: Boolean(row.is_read),
        priority: (row.priority as "high" | "normal" | "low") || "normal",
      });
    }

    return deduplicated;
  }, [rawRows]);

  const unreadCount = useMemo(() => {
    return notifications.filter((n) => !n.read).length;
  }, [notifications]);

  return {
    notifications,
    unreadCount,
    isLoading,
    markAsRead: (id: string) => markAsReadMutation.mutate(id),
    markAllAsRead: () => markAllAsReadMutation.mutate(),
    dismiss: (id: string) => dismissMutation.mutate(id),
    deleteNotification: (id: string) => hardDeleteMutation.mutate(id), // hard DELETE
    clearAll: () => clearAllMutation.mutate(),
    clearAllNotifications: () => clearAllMutation.mutate(),
  };
}
