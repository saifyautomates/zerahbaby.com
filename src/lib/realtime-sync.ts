/**
 * Global Realtime Synchronization Engine
 * Listens to Supabase Realtime PostgreSQL CDC events across core business tables:
 * products, categories, orders, offline_sales, site_settings, pos_customers, reviews, coupons.
 *
 * Ensures single source of truth across Admin, Customer storefront, Cart, POS, and all open tabs.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  updateOfflineCatalogProduct,
  removeOfflineCatalogProduct,
} from "@/lib/offline-sync-engine";

type SyncListener = (table: string, eventType: string, payload: unknown) => void;
const listeners = new Set<SyncListener>();

export function subscribeToRealtimeSync(listener: SyncListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyListeners(table: string, eventType: string, payload: unknown) {
  listeners.forEach((fn) => {
    try {
      fn(table, eventType, payload);
    } catch (e) {
      console.warn("[RealtimeSync] Listener notification error:", e);
    }
  });
}

// Debounce map to prevent refetch storms on rapid bulk updates
const debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};

function debouncedInvalidate(
  qc: ReturnType<typeof useQueryClient>,
  queryKeys: string[][],
  delay = 300,
) {
  const keyIdentifier = queryKeys.map((k) => k.join(":")).join("|");
  if (debounceTimers[keyIdentifier]) {
    clearTimeout(debounceTimers[keyIdentifier]);
  }

  debounceTimers[keyIdentifier] = setTimeout(() => {
    queryKeys.forEach((key) => {
      qc.invalidateQueries({ queryKey: key });
    });
    delete debounceTimers[keyIdentifier];
  }, delay);
}

/**
 * Hook to mount the singleton Realtime multi-table sync channel at the app root.
 */
export function useGlobalRealtimeSync() {
  const qc = useQueryClient();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const channel = supabase
      .channel("global-db-realtime-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, (payload) => {
        const { eventType, new: newRow, old: oldRow } = payload;
        notifyListeners("products", eventType, payload);

        // Update local offline cache
        if (eventType === "DELETE" && oldRow && (oldRow as { id?: string }).id) {
          removeOfflineCatalogProduct((oldRow as { id: string }).id);
        } else if (newRow && (newRow as { id?: string }).id) {
          updateOfflineCatalogProduct(newRow as Record<string, unknown>);
        }

        debouncedInvalidate(qc, [
          ["products"],
          ["admin-products"],
          ["inventory-products"],
          ["pos-products"],
          ["categories"],
          ["admin-search-products"],
          ["product-relations"],
        ]);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "categories" }, (payload) => {
        notifyListeners("categories", payload.eventType, payload);
        debouncedInvalidate(qc, [["categories"], ["admin-categories"], ["products"]]);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (payload) => {
        notifyListeners("orders", payload.eventType, payload);
        debouncedInvalidate(qc, [["orders"], ["admin-orders"], ["admin-dashboard"], ["my-orders"]]);
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "offline_sales" },
        (payload) => {
          notifyListeners("offline_sales", payload.eventType, payload);
          debouncedInvalidate(qc, [
            ["offline-sales"],
            ["offline-sales-badge-count"],
            ["admin-dashboard"],
            ["admin-products"],
            ["products"],
          ]);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "site_settings" },
        (payload) => {
          notifyListeners("site_settings", payload.eventType, payload);
          debouncedInvalidate(qc, [["site_settings"]]);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pos_customers" },
        (payload) => {
          notifyListeners("pos_customers", payload.eventType, payload);
          debouncedInvalidate(qc, [["pos-customers"]]);
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "reviews" }, (payload) => {
        notifyListeners("reviews", payload.eventType, payload);
        debouncedInvalidate(qc, [["reviews"], ["product-reviews"]]);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "coupons" }, (payload) => {
        notifyListeners("coupons", payload.eventType, payload);
        debouncedInvalidate(qc, [["coupons"]]);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.info("[RealtimeSync] Global real-time channel active.");
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
}

/** Global host component mounted in root route */
export function GlobalRealtimeSyncHost() {
  useGlobalRealtimeSync();
  return null;
}
