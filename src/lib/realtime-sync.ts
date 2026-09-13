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
          ["product"],
          ["admin-products"],
          ["inventory-products"],
          ["pos-products"],
          ["categories"],
          ["admin-search-products"],
          ["product-relations"],
          ["homepage-sections"],
          ["admin-products-count"],
        ]);
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "product_variants" },
        (payload) => {
          notifyListeners("products", payload.eventType, payload);
          debouncedInvalidate(qc, [
            ["products"],
            ["product"],
            ["admin-products"],
            ["inventory-products"],
            ["pos-products"],
            ["categories"],
            ["admin-search-products"],
            ["product-relations"],
            ["homepage-sections"],
            ["admin-products-count"],
          ]);
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "categories" }, (payload) => {
        notifyListeners("categories", payload.eventType, payload);
        debouncedInvalidate(qc, [
          ["categories"],
          ["admin-categories"],
          ["products"],
          ["product"],
          ["homepage-sections"],
        ]);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (payload) => {
        notifyListeners("orders", payload.eventType, payload);
        debouncedInvalidate(qc, [
          ["orders"],
          ["admin-orders"],
          ["admin-dashboard"],
          ["my-orders"],
          ["order-history"],
          ["admin-products"],
          ["admin-products-count"],
          ["inventory-products"],
          ["pos-products"],
          ["products"],
          ["product"],
        ]);
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
            ["admin-products-count"],
            ["inventory-products"],
            ["products"],
            ["product"],
            ["pos-products"],
          ]);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "site_settings" },
        (payload) => {
          notifyListeners("site_settings", payload.eventType, payload);
          debouncedInvalidate(qc, [
            ["site_settings"],
            ["admin-settings"],
            ["payment-settings"],
            ["store-info"],
          ]);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_settings" },
        (payload) => {
          notifyListeners("payment_settings", payload.eventType, payload);
          debouncedInvalidate(qc, [["payment-settings"], ["site_settings"], ["admin-settings"]]);
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, (payload) => {
        notifyListeners("profiles", payload.eventType, payload);
        debouncedInvalidate(qc, [
          ["profiles"],
          ["user-profile"],
          ["admin-customers"],
          ["pos-customers"],
        ]);
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "product_relations" },
        (payload) => {
          notifyListeners("product_relations", payload.eventType, payload);
          debouncedInvalidate(qc, [["product-relations"], ["product"], ["products"]]);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "product_videos" },
        (payload) => {
          notifyListeners("product_videos", payload.eventType, payload);
          debouncedInvalidate(qc, [["product-videos"], ["product"], ["products"]]);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pos_customers" },
        (payload) => {
          notifyListeners("pos_customers", payload.eventType, payload);
          debouncedInvalidate(qc, [
            ["pos-customers"],
            ["offline-sales-customers-badge"],
            ["offline-sales-customers-hub"],
          ]);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "store_credit_ledger" },
        (payload) => {
          notifyListeners("store_credit_ledger", payload.eventType, payload);
          debouncedInvalidate(qc, [["pos-customers"], ["store-credit"], ["offline-sales"]]);
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "reviews" }, (payload) => {
        notifyListeners("reviews", payload.eventType, payload);
        debouncedInvalidate(qc, [["reviews"], ["product-reviews"], ["homepage-reviews"]]);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "coupons" }, (payload) => {
        notifyListeners("coupons", payload.eventType, payload);
        debouncedInvalidate(qc, [["coupons"], ["admin-coupons"], ["pos-coupons"]]);
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "product_variants" },
        (payload) => {
          notifyListeners("product_variants", payload.eventType, payload);
          debouncedInvalidate(qc, [
            ["products"],
            ["product"],
            ["admin-products"],
            ["admin-search-products"],
            ["admin-products-count"],
            ["inventory-products"],
            ["pos-products"],
            ["product-relations"],
            ["homepage-sections"],
          ]);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "product_images" },
        (payload) => {
          notifyListeners("product_images", payload.eventType, payload);
          debouncedInvalidate(qc, [
            ["products"],
            ["product"],
            ["admin-products"],
            ["pos-products"],
            ["homepage-sections"],
          ]);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "homepage_sections" },
        (payload) => {
          notifyListeners("homepage_sections", payload.eventType, payload);
          debouncedInvalidate(qc, [["homepage-sections"]]);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "homepage_section_items" },
        (payload) => {
          notifyListeners("homepage_section_items", payload.eventType, payload);
          debouncedInvalidate(qc, [["homepage-sections"]]);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory_transactions" },
        (payload) => {
          notifyListeners("inventory_transactions", payload.eventType, payload);
          debouncedInvalidate(qc, [
            ["inventory-products"],
            ["admin-products"],
            ["products"],
            ["product"],
            ["pos-products"],
            ["admin-dashboard"],
          ]);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "offline_returns" },
        (payload) => {
          notifyListeners("offline_returns", payload.eventType, payload);
          debouncedInvalidate(qc, [
            ["offline-sales"],
            ["offline-returns"],
            ["pos-customers"],
            ["admin-dashboard"],
            ["pos-products"],
            ["products"],
            ["product"],
          ]);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "online_returns" },
        (payload) => {
          notifyListeners("online_returns", payload.eventType, payload);
          debouncedInvalidate(qc, [
            ["online-returns"],
            ["orders"],
            ["admin-orders"],
            ["my-orders"],
            ["admin-dashboard"],
            ["products"],
            ["product"],
          ]);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "contact_messages" },
        (payload) => {
          notifyListeners("contact_messages", payload.eventType, payload);
          debouncedInvalidate(qc, [["admin-queries"], ["contact-messages"], ["customer-queries"]]);
        },
      )
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
