# POS Transaction Status & Offline Sync Architecture: Final Production Audit & Resolution

## Executive Summary

This document records the comprehensive architectural resolution for POS transactions, offline sales synchronization, and business accounting reporting in **Zérah Baby & Kids**. 

Prior to this fix, offline POS transactions experienced status ambiguity: local draft sales could appear as `SYNC_FAILED` in the UI while either already committed on the backend or counting twice across sales history and dashboard analytics.

The system now enforces a **single, authoritative state machine** with a strict decoupling of **Business Transaction Status** from **Network / Transport Delivery Status**.

---

## 1. Root Cause Analysis

Four distinct root causes were uncovered during the end-to-end lifecycle audit:

### Root Cause 1: Semantic Conflation of Business Status and Transport Status
In `OfflineAnalyticsTab.tsx`, a single `status` property was overloaded. When an offline transaction was queued, `status` was set to `"sync_pending"`; upon network timeout or exception, it was set to `"sync_failed"`. Simultaneously, cloud sales carried business statuses (`"completed"`, `"cancelled"`). 
Because of this conflation:
- If a committed cloud sale had an auxiliary delivery failure (e.g. transactional SMS failure), the transaction could incorrectly present as failed.
- The UI could not differentiate between an uncommitted local sale and a committed sale awaiting background reconciliation.

### Root Cause 2: Asymmetric Sale Number Mismatches in Offline Analytics Deduplication
When merging remote sales with locally queued sales:
- The local queue generates temporary identifiers: `POS-OFF-XXXXXX`.
- The backend canonical RPC (`place_offline_sale`) issues sequential date-based receipt numbers: `POS-YYMM-XXXXX`.
- `OfflineAnalyticsTab.tsx` attempted to deduplicate using `existingNumbers = new Set(dbSales.map(s => s.sale_number))`. Because `POS-OFF-XXXXXX` never matched `POS-YYMM-XXXXX`, any sale that committed in Postgres but whose client timed out before receiving the response remained permanently in the local queue as `sync_failed` **AND** appeared as a committed cloud sale in the list, double-counting items and revenue.

### Root Cause 3: Queue Sync Skipping `FAILED` Items
In `processOfflineSyncQueue()` (`src/lib/offline-sync-engine.ts`), the query for actionable items filtered strictly by `status === "PENDING_SYNC" || status === "PENDING"`. It excluded `FAILED` items. Consequently, when cashiers clicked "Retry Sync" in the UI, the queue loop ignored the failed sale, leaving it trapped in `FAILED` state unless manually wiped.

### Root Cause 4: Cache Key Collision and Metric Infiltration
Both `DashboardTab.tsx` and `OfflineAnalyticsTab.tsx` consumed the query key `["offline-sales"]`. In `DashboardTab.tsx`, `posSales` filtered simply by `s.status !== "cancelled"`. Because `sync_pending` and `sync_failed` are not `"cancelled"`, any local drafts leaking into cache directly distorted top-level dashboard revenue, order counts, and analytics before the transaction was verified or committed by the server.

---

## 2. The Authoritative State Machine

The architecture strictly decouples **Business Transaction Status** from **Sync / Delivery Status**:

```
[POS Checkout]
       │
       ▼
Local Queue:
  • transaction_status: PENDING_CONFIRMATION
  • sync_status: PENDING_SYNC
       │
       ▼
Pre-RPC Idempotency Check (Does idempotent sale exist in DB?)
       ├─────────────────────────────────┐
       │ (Yes - Timeout Recovery)        │ (No - First Attempt)
       ▼                                 ▼
Reconcile directly                Call canonical RPC: place_offline_sale()
       │                                 ├───────────────────────────────┐
       │                                 │ (Commit Success / Duplicate)  │ (Transient Error / 5xx)
       │                                 ▼                               ▼
       └─────────────────────────► Local Queue Update:              Local Queue Update:
                                   • transaction_status: COMPLETED   • transaction_status: PENDING_CONFIRMATION
                                   • sync_status: SYNCED             • sync_status: PENDING_SYNC (or FAILED if retries exceeded)
                                   • server_sale_id: <UUID>          • last_error: <Error Msg>
                                   • server_sale_number: <POS-YYMM>
```

### Authoritative Types (`src/lib/offline-sync-engine.ts`):

```typescript
export type TransactionStatus = 
  | "COMPLETED"             // Canonical, committed sale in database with stock deducted
  | "PENDING_CONFIRMATION"  // Awaiting backend verification
  | "FAILED"                // Transaction rejected (e.g., negative stock, invalid customer)
  | "CANCELLED";            // Cancelled or voided

export type SyncStatus = 
  | "PENDING_SYNC"          // In queue, waiting for network or sync cycle
  | "PENDING"               // Alias for backwards compatibility
  | "SYNCING"               // Currently being transmitted over network
  | "SYNCED"                // Successfully acknowledged and reconciled with backend
  | "FAILED"                // Network or delivery failed (eligible for retry)
  | "RETRY_REQUIRED";
```

### Invariant Guarantee
A transaction **NEVER** simultaneously behaves like `COMPLETED` and `SYNC_FAILED`:
- If `sync_status === "FAILED"`, `transaction_status` is `PENDING_CONFIRMATION` or `FAILED`.
- If `transaction_status === "COMPLETED"`, `sync_status` is `SYNCED`.
- If non-blocking secondary operations (like MSG91 SMS) fail, the error is logged to the SMS audit table; it does **NOT** downgrade or mutate the completed sale status.

---

## 3. Database Schema & RPC Idempotency Behavior

### Table `public.offline_sales`
- `id`: `UUID PRIMARY KEY`
- `sale_number`: `TEXT UNIQUE` (Canonical server format `POS-YYMM-XXXXX`)
- `idempotency_key`: `TEXT UNIQUE` (Index: `idx_offline_sales_idempotency_key`)
- `status`: `TEXT NOT NULL DEFAULT 'completed'` (`'completed'` or `'cancelled'`)
- `subtotal`, `discount`, `total`: `NUMERIC(10,2)`
- `payment_method`: `TEXT` (`'cash'`, `'upi'`, `'card'`, `'split'`)
- `notes`: `TEXT` (includes `[idem:<key>]` tag)

### Canonical RPC: `place_offline_sale`
1. **Idempotency Lookup**:
   Before performing stock decrements or ledger entries, the RPC checks for existing sales matching `p_idempotency_key` or `notes ILIKE '%[idem:' || p_idempotency_key || ']%'`.
2. **Duplicate Detection**:
   If an existing sale is found, the RPC returns immediately:
   ```json
   {
     "sale_id": "<existing_uuid>",
     "sale_number": "<existing_sale_number>",
     "duplicate": true,
     "total": ...
   }
   ```
   **Crucial invariant**: Inventory is **NOT** decremented a second time, and duplicate sales records are never inserted.

3. **Client Pre-RPC Re-check**:
   Before dispatching the RPC call, `processOfflineSyncQueue` executes a direct `maybeSingle()` query against `public.offline_sales` using `idempotency_key`. If the sale is already present in the database (e.g. from a prior connection that succeeded on the server but dropped before returning the response to the client), it immediately transitions the local queue item to `SYNCED` and assigns `server_sale_id` without issuing another RPC.

---

## 4. Multi-Tab Concurrency & Cross-Tab Locking

To eliminate race conditions when multiple browser tabs or POS terminals are open:
- `processOfflineSyncQueue` uses the standard **Web Locks API** (`navigator.locks.request("zerah_pos_offline_sync_lock", ...)`).
- If another tab is actively executing the sync loop, concurrent sync requests abort gracefully without issuing duplicate requests or stepping over the local queue.

---

## 5. Reporting & Dashboard Accounting Behavior

### Separation of Concerns:
1. **`activeSales` (`OfflineAnalyticsTab.tsx`)**:
   Filtered strictly to authoritative business sales:
   ```typescript
   const activeSales = useMemo(
     () => (sales ?? []).filter((s) => (s as { status?: string }).status === "completed"),
     [sales],
   );
   ```
2. **`uncommittedSales` (`OfflineAnalyticsTab.tsx`)**:
   Filtered to local uncommitted sales (`status === "sync_pending" || status === "sync_failed"`). These are displayed in an amber alert banner above the table with their total value separated from accounting revenue.
3. **`posSales` (`DashboardTab.tsx`)**:
   Migrated from query key `["offline-sales"]` to `["admin-dashboard-offline-sales"]`.
   Filtered strictly:
   ```typescript
   const posSales = useMemo(() => {
     return rawPosSales.filter((s) => s.status === "completed");
   }, [rawPosSales]);
   ```
4. **Deduplication Matrix**:
   When rendering `sales` in `OfflineAnalyticsTab`, local queue items are filtered out if matched by:
   - `idempotency_key`
   - `server_sale_id`
   - `server_sale_number`
   - `sale_number`

This eliminates duplicate counting under all circumstances.

---

## 6. Verification and Test Results

### Automated Test Suite: `tests/pos-sync-state-machine.spec.ts`
All 9 test cases passed across Desktop Chrome, iPad (Tablet), and Mobile Chrome viewports:
- **Test 1**: Explicit State Machine separates `transaction_status` (`PENDING_CONFIRMATION` -> `COMPLETED`) from `sync_status` (`PENDING_SYNC` -> `SYNCING` -> `SYNCED`).
- **Test 2**: Cloud reconciliation correctly associates server UUID and server sale number with local queue items based on `idempotency_key` and marks them `SYNCED`.
- **Test 3**: Local deletion prunes offline records cleanly from IndexedDB/localStorage without database exceptions.

### Static Analysis & Build Verification:
- `npx tsc --noEmit`: Exited with code 0 (Zero type errors).
- `npx eslint` on modified files: Exited with code 0 (Zero errors).
- `npm run build`: Exited with code 0 (Client & SSR builds successful in 5.7s and 4.45s).
