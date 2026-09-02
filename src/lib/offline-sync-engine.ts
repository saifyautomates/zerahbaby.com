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

export type TransactionStatus = "COMPLETED" | "PENDING_CONFIRMATION" | "FAILED" | "CANCELLED";
export type SyncStatus =
  | "PENDING_SYNC"
  | "PENDING"
  | "SYNCING"
  | "SYNCED"
  | "FAILED"
  | "FAILED_REQUIRES_ACTION"
  | "RETRY_REQUIRED";
export type QueueStatus = SyncStatus;

export type OfflineQueueItem = {
  id: string;
  operation_id: string;
  idempotency_key: string;
  server_sale_id?: string;
  server_sale_number?: string;
  transaction_status?: TransactionStatus;
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
  status: SyncStatus;
  retry_count: number;
  last_error?: string;
  synced_at?: string;
  next_retry_at?: number;
  is_permanent_error?: boolean;
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
  item: Omit<OfflineQueueItem, "status" | "retry_count"> & {
    status?: SyncStatus;
    transaction_status?: TransactionStatus;
  },
): Promise<OfflineQueueItem> {
  const record: OfflineQueueItem = {
    ...item,
    status: item.status || "PENDING_SYNC",
    transaction_status: item.transaction_status || "PENDING_CONFIRMATION",
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
  meta?: {
    server_sale_id?: string;
    server_sale_number?: string;
    transaction_status?: TransactionStatus;
    next_retry_at?: number;
    is_permanent_error?: boolean;
  },
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
            last_error: errorMsg !== undefined ? errorMsg : req.result.last_error,
            retry_count:
              req.result.retry_count +
              (status === "FAILED" || status === "FAILED_REQUIRES_ACTION" ? 1 : 0),
            synced_at: status === "SYNCED" ? new Date().toISOString() : req.result.synced_at,
            next_retry_at:
              meta?.next_retry_at !== undefined ? meta.next_retry_at : req.result.next_retry_at,
            is_permanent_error:
              meta?.is_permanent_error !== undefined
                ? meta.is_permanent_error
                : status === "FAILED_REQUIRES_ACTION"
                  ? true
                  : req.result.is_permanent_error,
            server_sale_id: meta?.server_sale_id || req.result.server_sale_id,
            server_sale_number: meta?.server_sale_number || req.result.server_sale_number,
            transaction_status:
              meta?.transaction_status ||
              (status === "SYNCED"
                ? "COMPLETED"
                : req.result.transaction_status || "PENDING_CONFIRMATION"),
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
      if (errorMsg !== undefined) items[idx].last_error = errorMsg;
      if (status === "FAILED" || status === "FAILED_REQUIRES_ACTION") items[idx].retry_count++;
      if (status === "SYNCED") items[idx].synced_at = new Date().toISOString();
      if (meta?.next_retry_at !== undefined) items[idx].next_retry_at = meta.next_retry_at;
      if (meta?.is_permanent_error !== undefined)
        items[idx].is_permanent_error = meta.is_permanent_error;
      else if (status === "FAILED_REQUIRES_ACTION") items[idx].is_permanent_error = true;
      if (meta?.server_sale_id) items[idx].server_sale_id = meta.server_sale_id;
      if (meta?.server_sale_number) items[idx].server_sale_number = meta.server_sale_number;
      items[idx].transaction_status =
        meta?.transaction_status ||
        (status === "SYNCED"
          ? "COMPLETED"
          : items[idx].transaction_status || "PENDING_CONFIRMATION");
      localStorage.setItem("zerah_offline_sales_queue", JSON.stringify(items));
    }
  }
  notifySyncStatusChange();
}

/**
 * Reconciles local queued offline sales against canonical database records.
 * If a queued sale's idempotency_key, server_sale_id, or sale_number is found in cloudSales,
 * marks the local record as SYNCED with transaction_status COMPLETED,
 * preventing any duplicate display or erroneous SYNC_FAILED state.
 */
export async function reconcileLocalQueueWithCloudSales(
  cloudSales: Array<{ id: string; sale_number: string; idempotency_key?: string | null }>,
): Promise<number> {
  if (!cloudSales || cloudSales.length === 0) return 0;

  const cloudByIdem = new Map<string, { id: string; sale_number: string }>();
  const cloudById = new Map<string, { id: string; sale_number: string }>();
  const cloudByNumber = new Map<string, { id: string; sale_number: string }>();

  for (const s of cloudSales) {
    if (s.idempotency_key)
      cloudByIdem.set(s.idempotency_key, { id: s.id, sale_number: s.sale_number });
    if (s.id) cloudById.set(s.id, { id: s.id, sale_number: s.sale_number });
    if (s.sale_number) cloudByNumber.set(s.sale_number, { id: s.id, sale_number: s.sale_number });
  }

  const queued = await getAllQueuedSales();
  let reconciled = 0;

  for (const item of queued) {
    if (item.status === "SYNCED") continue;

    const match =
      (item.idempotency_key ? cloudByIdem.get(item.idempotency_key) : undefined) ||
      (item.server_sale_id ? cloudById.get(item.server_sale_id) : undefined) ||
      (item.server_sale_number ? cloudByNumber.get(item.server_sale_number) : undefined) ||
      (item.sale_number && !item.sale_number.startsWith("POS-OFF-")
        ? cloudByNumber.get(item.sale_number)
        : undefined);

    if (match) {
      await updateQueuedSaleStatus(item.operation_id, "SYNCED", undefined, {
        server_sale_id: match.id,
        server_sale_number: match.sale_number,
        transaction_status: "COMPLETED",
      });
      reconciled++;
    }
  }

  return reconciled;
}

/**
 * Remove a single offline queued sale by operation_id
 */
export async function deleteQueuedSale(operationId: string): Promise<boolean> {
  let removed = false;
  // 1. Remove from IndexedDB
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(SALES_STORE, "readwrite");
      const store = tx.objectStore(SALES_STORE);
      const req = store.delete(operationId);
      req.onsuccess = () => {
        removed = true;
        resolve();
      };
      req.onerror = () => resolve();
    });
  } catch {
    // ignore
  }

  // 2. Remove from LocalStorage
  try {
    const items = fallbackGetFromLS();
    const filtered = items.filter((i) => i.operation_id !== operationId);
    if (filtered.length !== items.length) {
      localStorage.setItem("zerah_offline_sales_queue", JSON.stringify(filtered));
      removed = true;
    }
  } catch {
    // ignore
  }

  notifySyncStatusChange();
  return removed;
}

/**
 * Clear all local offline queued sales and tokens
 */
export async function clearAllQueuedSales(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction([SALES_STORE, TOKENS_STORE], "readwrite");
      tx.objectStore(SALES_STORE).clear();
      tx.objectStore(TOKENS_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }

  try {
    localStorage.removeItem("zerah_offline_sales_queue");
    localStorage.removeItem("zerah_pos_cart");
    localStorage.removeItem("zerah_offline_tokens");
  } catch {
    // ignore
  }

  notifySyncStatusChange();
}

/**
 * Prune locally stored sales that have already synced successfully
 */
export async function clearAllSyncedSales(): Promise<number> {
  const all = await getAllQueuedSales();
  let count = 0;
  for (const item of all) {
    if (item.status === "SYNCED") {
      await deleteQueuedSale(item.operation_id);
      count++;
    }
  }
  return count;
}

/**
 * Automatically prune obsolete test drafts or permanent validation failures
 * to ensure dirty local IndexedDB queues are cleanly purged.
 */
export async function pruneObsoleteTestDrafts(): Promise<number> {
  const all = await getAllQueuedSales();
  let count = 0;
  for (const item of all) {
    const isTestItem = (item.items || []).some(
      (i) =>
        i.name === "saifyyy" ||
        i.name === "dhch fgj" ||
        i.name === "necker set" ||
        (i.name && i.name.toLowerCase().includes("test")),
    );
    if (
      item.is_permanent_error ||
      item.status === "FAILED_REQUIRES_ACTION" ||
      item.status === "FAILED" ||
      item.status === "SYNCED" ||
      isTestItem
    ) {
      await deleteQueuedSale(item.operation_id);
      count++;
    }
  }
  return count;
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

export async function processOfflineSyncQueue(options?: {
  silent?: boolean;
  forceRetry?: boolean;
}): Promise<{ synced: number; failed: number }> {
  if (isSyncInProgress || (typeof navigator !== "undefined" && !navigator.onLine)) {
    return { synced: 0, failed: 0 };
  }

  // Use Web Locks API if available to prevent multiple browser tabs concurrently syncing
  if (typeof navigator !== "undefined" && (navigator as any).locks?.request) {
    try {
      return await (navigator as any).locks.request(
        "zerah_pos_offline_sync_lock",
        { ifAvailable: true },
        async (lock: any) => {
          if (!lock) {
            // Another browser tab is currently syncing the queue
            return { synced: 0, failed: 0 };
          }
          return executeSyncLoop(options);
        },
      );
    } catch {
      return executeSyncLoop(options);
    }
  }

  return executeSyncLoop(options);
}

async function executeSyncLoop(options?: {
  silent?: boolean;
  forceRetry?: boolean;
}): Promise<{ synced: number; failed: number }> {
  isSyncInProgress = true;
  notifySyncStatusChange();

  let syncedCount = 0;
  let failedCount = 0;

  try {
    const all = await getAllQueuedSales();
    const now = Date.now();
    const pending = all.filter((i) => {
      // 1. Synced items never sync again
      if (i.status === "SYNCED") return false;

      // 2. User explicitly triggered "Retry Sync"
      if (options?.forceRetry) return true;

      // 3. Permanent validation failures: STOP infinite retry loops!
      if (i.status === "FAILED_REQUIRES_ACTION" || i.is_permanent_error) return false;

      // 4. Exponential backoff active for temporary network failure: wait
      if (i.next_retry_at && i.next_retry_at > now) return false;

      // 5. Queued items ready for sync
      return (
        i.status === "PENDING_SYNC" ||
        i.status === "PENDING" ||
        i.status === "RETRY_REQUIRED" ||
        (i.status === "FAILED" && !i.is_permanent_error && i.retry_count < 5)
      );
    });

    for (const item of pending) {
      await updateQueuedSaleStatus(item.operation_id, "SYNCING");

      try {
        // 1. Idempotency Pre-Check: Was this sale already committed in Supabase?
        // This covers cases where prior network dropped AFTER PostgreSQL committed!
        if (item.idempotency_key) {
          const { data: existingSale } = await (supabase.from("offline_sales") as any)
            .select("id, sale_number, total, created_at")
            .eq("idempotency_key", item.idempotency_key)
            .maybeSingle();

          if (existingSale?.id) {
            await updateQueuedSaleStatus(item.operation_id, "SYNCED", undefined, {
              server_sale_id: existingSale.id,
              server_sale_number: existingSale.sale_number,
              transaction_status: "COMPLETED",
              next_retry_at: undefined,
              is_permanent_error: false,
            });
            syncedCount++;
            continue;
          }
        }

        // 2. Invoke Canonical place_offline_sale RPC with identical idempotency key
        const rpcRes = await (
          supabase.rpc as unknown as (
            fn: string,
            args: Record<string, unknown>,
          ) => Promise<{
            data: { sale_id: string; sale_number: string; duplicate?: boolean } | null;
            error: { message: string } | null;
          }>
        )("place_offline_sale", {
          _customer_name: item.customer_name || "Walk-in Customer",
          _customer_phone: item.customer_phone || "",
          _customer_email: item.customer_email || "",
          _payment_method: item.payment_method || "cash",
          _notes: item.notes || "",
          _discount_type: item.discount_type || "none",
          _discount_value: item.discount_value || 0,
          _customer_id: item.customer_id || null,
          _items: item.items,
          _idempotency_key: item.idempotency_key,
          _store_credit_used: (item as any).store_credit_used || 0,
          _credit_token: (item as any).credit_token || null,
        });

        if (rpcRes.error) {
          throw new Error(rpcRes.error.message);
        }

        const data = rpcRes.data;

        await updateQueuedSaleStatus(item.operation_id, "SYNCED", undefined, {
          server_sale_id: data?.sale_id,
          server_sale_number: data?.sale_number,
          transaction_status: "COMPLETED",
          next_retry_at: undefined,
          is_permanent_error: false,
        });
        syncedCount++;

        // 3. Trigger transactional SMS (non-blocking, failure NEVER compromises sale status)
        if (data?.sale_id && !data.duplicate) {
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
            .catch((notifyErr) => {
              console.warn("[OfflineSync] Non-blocking notification delivery failed:", notifyErr);
            });
        }
      } catch (err: unknown) {
        const msg = (err as Error).message || "Sync error";
        console.warn(`[OfflineSync] Sync paused/failed for sale ${item.operation_id}:`, msg);

        const isNetDrop =
          (typeof navigator !== "undefined" && !navigator.onLine) ||
          msg.includes("Failed to fetch") ||
          msg.includes("NetworkError") ||
          msg.includes("network disconnected") ||
          msg.includes("connection refused") ||
          msg.includes("AbortError") ||
          msg.includes("timeout") ||
          msg.includes("Failed to execute 'fetch'");

        if (isNetDrop) {
          // Temporary connectivity failure: schedule exponential backoff (5s, 10s, 20s, 40s... max 5 min)
          const backoffDelay = Math.min(300000, 5000 * Math.pow(2, Math.min(item.retry_count, 5)));
          await updateQueuedSaleStatus(item.operation_id, "PENDING_SYNC", msg, {
            transaction_status: "PENDING_CONFIRMATION",
            next_retry_at: Date.now() + backoffDelay,
            is_permanent_error: false,
          });
        } else {
          // Permanent business validation or server rejection: stop infinite retry!
          await updateQueuedSaleStatus(item.operation_id, "FAILED_REQUIRES_ACTION", msg, {
            transaction_status: "FAILED",
            next_retry_at: undefined,
            is_permanent_error: true,
          });
          failedCount++;
        }
      }
    }

    if (syncedCount > 0) {
      toast.success(
        `Synced ${syncedCount} offline POS sale${syncedCount > 1 ? "s" : ""} to cloud!`,
      );
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("zerah:pos-sale-updated"));
      }
    }

    if (failedCount > 0 && !options?.silent) {
      toast.error(
        `${failedCount} offline POS sale${failedCount > 1 ? "s" : ""} could not be synchronized due to validation errors. Please check Sales History.`,
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
    (i) =>
      i.status === "PENDING_SYNC" ||
      i.status === "PENDING" ||
      i.status === "RETRY_REQUIRED" ||
      i.status === "SYNCING",
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
