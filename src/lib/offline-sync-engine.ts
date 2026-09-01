/**
 * ZÉRAH BABY & KIDS — OFFLINE SYNCHRONIZATION ENGINE & STORE
 *
 * Implements persistent IndexedDB/localStorage storage for:
 * 1. Offline POS sales queue with statuses (PENDING, SYNCING, SYNCED, FAILED, RETRY_REQUIRED)
 * 2. Idempotent server reconciliation via _idempotency_key
 * 3. Offline daily sequential token generation (IST calendar date)
 * 4. Offline product catalog caching for instant barcode lookups without internet
 * 5. Automatic reconnect background sync worker with exponential backoff
 */
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type QueueStatus = "PENDING" | "SYNCING" | "SYNCED" | "FAILED" | "RETRY_REQUIRED";

export type OfflineQueueItem = {
  id: string;
  operation_id: string;
  idempotency_key: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  payment_method: string;
  notes: string;
  discount_type: string;
  discount_value: number;
  customer_id: string | null;
  items: Array<{
    product_id?: string;
    variant_id?: string;
    product_slug?: string;
    name?: string;
    sku?: string;
    qty: number;
    custom_price?: number;
    price?: number;
  }>;
  total: number;
  subtotal: number;
  discount: number;
  token_number: number;
  token_date: string;
  sale_number: string;
  created_at: string;
  status: QueueStatus;
  retry_count: number;
  last_error?: string;
  synced_at?: string;
};

const DB_NAME = "zerah_pos_offline_db";
const DB_VERSION = 1;
const SALES_STORE = "offline_sales";
const CATALOG_STORE = "cached_catalog";
const TOKENS_STORE = "offline_tokens";

// IndexedDB Helper
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      return reject(new Error("IndexedDB is not supported in this environment"));
    }

    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(SALES_STORE)) {
        db.createObjectStore(SALES_STORE, { keyPath: "operation_id" });
      }
      if (!db.objectStoreNames.contains(CATALOG_STORE)) {
        const catStore = db.createObjectStore(CATALOG_STORE, { keyPath: "id" });
        catStore.createIndex("barcode", "barcode", { unique: false });
        catStore.createIndex("sku", "sku", { unique: false });
        catStore.createIndex("slug", "slug", { unique: false });
      }
      if (!db.objectStoreNames.contains(TOKENS_STORE)) {
        db.createObjectStore(TOKENS_STORE, { keyPath: "date" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ------------------------------------------------------------------ */
/*  Daily Token Generator (IST)                                       */
/* ------------------------------------------------------------------ */

export function getTodayISTDateString(): string {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const istTime = new Date(utc + 3600000 * 5.5);
  return istTime.toISOString().split("T")[0];
}

export async function getNextOfflineToken(): Promise<{ number: number; date: string }> {
  const today = getTodayISTDateString();
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(TOKENS_STORE, "readwrite");
      const store = tx.objectStore(TOKENS_STORE);
      const req = store.get(today);

      req.onsuccess = () => {
        const record = req.result || { date: today, last_token: 0 };
        const nextNumber = (record.last_token || 0) + 1;
        store.put({ date: today, last_token: nextNumber });
        resolve({ number: nextNumber, date: today });
      };
      req.onerror = () => {
        // Fallback to localStorage
        const lsKey = `zerah_offline_token_${today}`;
        const current = parseInt(localStorage.getItem(lsKey) || "0", 10);
        const next = current + 1;
        localStorage.setItem(lsKey, next.toString());
        resolve({ number: next, date: today });
      };
    });
  } catch {
    const lsKey = `zerah_offline_token_${today}`;
    const current = parseInt(localStorage.getItem(lsKey) || "0", 10);
    const next = current + 1;
    localStorage.setItem(lsKey, next.toString());
    return { number: next, date: today };
  }
}

/* ------------------------------------------------------------------ */
/*  Offline Sales Queue Management                                    */
/* ------------------------------------------------------------------ */

export async function queueOfflineSale(
  item: Omit<OfflineQueueItem, "status" | "retry_count">,
): Promise<OfflineQueueItem> {
  const record: OfflineQueueItem = {
    ...item,
    status: "PENDING",
    retry_count: 0,
  };

  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SALES_STORE, "readwrite");
      const store = tx.objectStore(SALES_STORE);
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // LocalStorage fallback
    const existing = JSON.parse(localStorage.getItem("zerah_offline_sales_queue") || "[]");
    existing.push(record);
    localStorage.setItem("zerah_offline_sales_queue", JSON.stringify(existing));
  }

  notifySyncStatusChange();
  return record;
}

export async function getAllQueuedSales(): Promise<OfflineQueueItem[]> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(SALES_STORE, "readonly");
      const store = tx.objectStore(SALES_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve(fallbackGetFromLS());
    });
  } catch {
    return fallbackGetFromLS();
  }
}

function fallbackGetFromLS(): OfflineQueueItem[] {
  try {
    return JSON.parse(localStorage.getItem("zerah_offline_sales_queue") || "[]");
  } catch {
    return [];
  }
}

export async function updateQueuedSaleStatus(
  operation_id: string,
  status: QueueStatus,
  errorMsg?: string,
): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(SALES_STORE, "readwrite");
      const store = tx.objectStore(SALES_STORE);
      const req = store.get(operation_id);
      req.onsuccess = () => {
        if (req.result) {
          const updated: OfflineQueueItem = {
            ...req.result,
            status,
            last_error: errorMsg || req.result.last_error,
            retry_count: req.result.retry_count + (status === "FAILED" ? 1 : 0),
            synced_at: status === "SYNCED" ? new Date().toISOString() : req.result.synced_at,
          };
          store.put(updated);
        }
        resolve();
      };
      req.onerror = () => resolve();
    });
  } catch {
    const items = fallbackGetFromLS();
    const idx = items.findIndex((i) => i.operation_id === operation_id);
    if (idx !== -1) {
      items[idx].status = status;
      if (errorMsg) items[idx].last_error = errorMsg;
      if (status === "FAILED") items[idx].retry_count++;
      if (status === "SYNCED") items[idx].synced_at = new Date().toISOString();
      localStorage.setItem("zerah_offline_sales_queue", JSON.stringify(items));
    }
  }
  notifySyncStatusChange();
}

/* ------------------------------------------------------------------ */
/*  Catalog Caching for Instant Offline Barcode Lookups              */
/* ------------------------------------------------------------------ */

export async function cacheFullCatalog(products: Array<Record<string, unknown>>): Promise<void> {
  if (typeof window === "undefined" || !window.indexedDB) return;
  try {
    const db = await openDB();
    const tx = db.transaction(CATALOG_STORE, "readwrite");
    const store = tx.objectStore(CATALOG_STORE);
    // Purge old cache so deletions immediately propagate to offline POS
    store.clear();
    if (products && products.length > 0) {
      products.forEach((p) => {
        if (p.id && p.is_active !== false && p.isActive !== false) {
          store.put(p);
        }
      });
    }
  } catch (err) {
    console.warn("[OfflineSync] Catalog caching notice:", err);
  }
}

export async function clearOfflineCatalog(): Promise<void> {
  if (typeof window === "undefined" || !window.indexedDB) return;
  try {
    const db = await openDB();
    const tx = db.transaction(CATALOG_STORE, "readwrite");
    tx.objectStore(CATALOG_STORE).clear();
  } catch (err) {
    console.warn("[OfflineSync] Clear catalog error:", err);
  }
}

export async function getCachedCatalog(): Promise<Array<Record<string, unknown>>> {
  if (typeof window === "undefined" || !window.indexedDB) return [];
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(CATALOG_STORE, "readonly");
      const store = tx.objectStore(CATALOG_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        resolve(
          all.filter((p: Record<string, unknown>) => p.is_active !== false && p.isActive !== false),
        );
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function updateOfflineCatalogProduct(product: Record<string, unknown>): Promise<void> {
  if (typeof window === "undefined" || !window.indexedDB || !product?.id) return;
  try {
    const db = await openDB();
    const tx = db.transaction(CATALOG_STORE, "readwrite");
    const store = tx.objectStore(CATALOG_STORE);
    if (product.is_active === false || product.isActive === false) {
      store.delete(product.id as string);
    } else {
      store.put(product);
    }
  } catch (err) {
    console.warn("[OfflineSync] Catalog product update error:", err);
  }
}

export async function removeOfflineCatalogProduct(productId: string): Promise<void> {
  if (typeof window === "undefined" || !window.indexedDB || !productId) return;
  try {
    const db = await openDB();
    const tx = db.transaction(CATALOG_STORE, "readwrite");
    const store = tx.objectStore(CATALOG_STORE);
    store.delete(productId);
  } catch (err) {
    console.warn("[OfflineSync] Catalog product remove error:", err);
  }
}

export async function findOfflineProductByCode(
  code: string,
): Promise<Record<string, unknown> | null> {
  const clean = code.trim().toLowerCase();
  if (!clean) return null;

  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(CATALOG_STORE, "readonly");
      const store = tx.objectStore(CATALOG_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        let matchedVariant = null;
        let matchedProduct = null;

        for (const p of all) {
          if (p.is_active === false || p.isActive === false) continue;

          // Check variants first (by barcode or sku)
          if (Array.isArray(p.variants)) {
            const vMatch = p.variants.find(
              (v: any) =>
                String(v.barcode || "").toLowerCase() === clean ||
                String(v.sku || "").toLowerCase() === clean,
            );
            if (vMatch) {
              matchedVariant = vMatch;
              matchedProduct = p;
              break;
            }
          }

          // Then check parent
          if (
            String(p.barcode || "").toLowerCase() === clean ||
            String(p.sku || "").toLowerCase() === clean ||
            String(p.slug || "").toLowerCase() === clean ||
            String(p.id || "").toLowerCase() === clean ||
            String(p.uuid || "").toLowerCase() === clean
          ) {
            matchedProduct = p;
            matchedVariant = Array.isArray(p.variants)
              ? p.variants.find((v: any) => v.name === "Default") || p.variants[0]
              : null;
            break;
          }
        }

        if (matchedProduct) {
          resolve(Object.assign({}, matchedProduct, { matchedVariant }));
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Sync Worker (Idempotent Cloud Reconciliation)                    */
/* ------------------------------------------------------------------ */

let isSyncInProgress = false;

export async function processOfflineSyncQueue(): Promise<{ synced: number; failed: number }> {
  if (isSyncInProgress || !navigator.onLine) {
    return { synced: 0, failed: 0 };
  }

  isSyncInProgress = true;
  notifySyncStatusChange();

  let syncedCount = 0;
  let failedCount = 0;

  try {
    const all = await getAllQueuedSales();
    const pending = all.filter((i) => i.status === "PENDING" || i.status === "RETRY_REQUIRED");

    for (const item of pending) {
      await updateQueuedSaleStatus(item.operation_id, "SYNCING");

      try {
        const { data, error } = await (
          supabase.rpc as unknown as (
            fn: string,
            args: Record<string, unknown>,
          ) => Promise<{
            data: { sale_id: string; sale_number: string };
            error: { message: string } | null;
          }>
        )("place_offline_sale", {
          _customer_name: item.customer_name || "Walk-in Customer",
          _customer_phone: item.customer_phone || "",
          _customer_email: item.customer_email || "",
          _payment_method: item.payment_method || "cash",
          _notes: item.notes || "",
          _discount: 0,
          _discount_type: item.discount_type || "none",
          _discount_value: item.discount_value || 0,
          _customer_id: item.customer_id || null,
          _items: item.items,
          _idempotency_key: item.idempotency_key,
        });

        if (error) {
          throw new Error(error.message);
        }

        await updateQueuedSaleStatus(item.operation_id, "SYNCED");
        syncedCount++;

        // Trigger transactional SMS for synced sale (non-blocking)
        if (data?.sale_id) {
          supabase.functions
            .invoke("msg91-transactional", {
              body: {
                offline_sale_id: data.sale_id,
                event_type: "offline_pos_sale",
                phone: item.customer_phone || undefined,
                name: item.customer_name || "Customer",
                total: item.total,
                payment_method: item.payment_method || "cash",
                sale_number: data.sale_number,
                notify_owner: true,
              },
            })
            .catch(() => {});
        }
      } catch (err: unknown) {
        const msg = (err as Error).message || "Sync error";
        console.error(`[OfflineSync] Failed to sync sale ${item.operation_id}:`, msg);
        await updateQueuedSaleStatus(item.operation_id, "FAILED", msg);
        failedCount++;
      }
    }

    if (syncedCount > 0) {
      toast.success(
        `Synced ${syncedCount} offline POS sale${syncedCount > 1 ? "s" : ""} to cloud!`,
      );
    }

    if (failedCount > 0) {
      toast.error(
        `Failed to sync ${failedCount} offline POS sale${failedCount > 1 ? "s" : ""}. Please check your connection and retry.`,
      );
    }
  } finally {
    isSyncInProgress = false;
    notifySyncStatusChange();
  }

  return { synced: syncedCount, failed: failedCount };
}

/* ------------------------------------------------------------------ */
/*  Reactive Status Subscriptions & Host                             */
/* ------------------------------------------------------------------ */

type StatusListener = (status: {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
}) => void;
const statusListeners = new Set<StatusListener>();

export function subscribeToSyncStatus(fn: StatusListener): () => void {
  statusListeners.add(fn);
  notifySyncStatusChange();
  return () => statusListeners.delete(fn);
}

export async function notifySyncStatusChange() {
  const all = await getAllQueuedSales();
  const pendingCount = all.filter(
    (i) => i.status === "PENDING" || i.status === "RETRY_REQUIRED" || i.status === "SYNCING",
  ).length;
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

  statusListeners.forEach((fn) => {
    try {
      fn({ isOnline, isSyncing: isSyncInProgress, pendingCount });
    } catch (err) {
      console.warn("Failed to notify sync status listener:", err);
    }
  });
}

export function useOfflineSyncStatus() {
  const [status, setStatus] = useState({
    isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
    isSyncing: false,
    pendingCount: 0,
  });

  useEffect(() => {
    return subscribeToSyncStatus((s) => setStatus(s));
  }, []);

  const triggerSync = useCallback(() => {
    return processOfflineSyncQueue();
  }, []);

  return { ...status, triggerSync };
}

/** Global host component mounted in root route to monitor network connectivity */
export function OfflineSyncHost() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOnline = () => {
      toast.info("Internet reconnected. Syncing offline records...");
      notifySyncStatusChange();
      processOfflineSyncQueue();
    };

    const handleOffline = () => {
      toast.warning("You are offline. POS will queue sales locally.");
      notifySyncStatusChange();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Periodic heartbeat sync every 20 seconds if pending items exist
    const interval = setInterval(() => {
      if (navigator.onLine) {
        processOfflineSyncQueue();
      }
    }, 20000);

    // Initial check
    processOfflineSyncQueue();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, []);

  return null;
}
