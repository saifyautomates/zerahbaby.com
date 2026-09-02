# DASHBOARD, SALES DETAILS & POS REPORTING FINAL RECONCILIATION AUDIT

## 1. Executive Summary

In prior sessions, the omnichannel dashboard displayed:
- **Total Sales = ₹0**
- **My Cost = ₹0**
- **Total Profit = ₹0**

Even while transactions appeared inside **Sales Details** and **POS History**. 

This document certifies the complete root-cause audit, architectural reconciliation, cache invalidation unification, and real database verification performed across **Zérah Baby & Kids** (https://zerahkids.com).

---

## 2. Complete Reporting Trace & Root Cause Analysis

### End-to-End Trace of Reporting Path
```
Database (`offline_sales`, `orders`, `product_costs`)
  ↓
Unified Canonical Reporting Service (`src/lib/canonical-reporting.ts`)
  ↓
Standardized IST Calendar Date Bounds (`getISTPeriodBounds` in `src/lib/financial-reporting.ts`)
  ↓
Strict State Machine Validation (`isValidPOSSale`, `isValidOnlineOrder`)
  ↓
Omnichannel Financial Engine (`calculateFinancialMetrics`)
  ↓
React Query Cache (`["admin-canonical-pos-sales"]`, `["admin-orders"]`, `["admin-products"]`)
  ↓
UI Presentation (`DashboardTab`, `OfflineAnalyticsTab`, `DashboardDrillDown`)
```

### The 5 Root Causes Identified & Eliminated:

1. **Query Key Fragmentation & Missing Local Queue in Dashboard**:
   - **Before**: `DashboardTab.tsx` queried `["admin-dashboard-offline-sales"]` with a 3-minute stale time directly against remote `offline_sales`, completely ignoring locally queued sales in IndexedDB. Conversely, `OfflineAnalyticsTab.tsx` (Sales Details) queried `["admin-offline-sales-with-queue"]` and merged IndexedDB queued transactions with remote sales.
   - **Fix**: Created centralized `useCanonicalPOSSales()` hook in `src/lib/canonical-reporting.ts` with query key `["admin-canonical-pos-sales"]`. Both Dashboard and Sales Details now read from the identical authoritative data source.

2. **Absence of Synchronous Cache Invalidation on POS Checkout**:
   - **Before**: When a sale was completed in `POSTab.tsx`, query invalidations were fragmented. The dashboard cache was never invalidated, leaving it stuck showing old data until a hard reload or 3 minutes elapsed.
   - **Fix**: Implemented `invalidateCanonicalReportingQueries(qc)` and `notifyPOSSaleChanged()` which synchronously invalidate all canonical and legacy keys across both screens, and broadcast a `zerah:pos-sale-updated` event to trigger instant live updates without full-page reloads.

3. **Timezone & Date Boundary Mismatch (UTC vs IST)**:
   - **Before**: Dashboard KPI cards filtered sales through `inCurrentPeriod(s.created_at)` using client-local `startOfDay(new Date())` and `endOfDay(new Date())`. In non-IST environments (e.g., UTC containers or browsers outside India), transactions created at early IST hours (UTC+05:30) fell outside the local day boundary and were zeroed out. In contrast, `OfflineAnalyticsTab.tsx` filtered by IST `todayIST()` (`Asia/Kolkata`) or showed all-time sales.
   - **Fix**: Implemented `getISTPeriodBounds(datePreset)` in `src/lib/financial-reporting.ts`. All date filtering across presets (`today`, `yesterday`, `7d`, `30d`, `this_month`, `all`) now uses canonical milliseconds aligned strictly to India Standard Time (+05:30).

4. **Silent Error Fallbacks (`return []`, `catch => 0`)**:
   - **Before**: `useAllOrders` in `src/lib/orders.ts` had `if (error) { console.warn(...); return [] as Order[]; }`. Queries for products and returns in `DashboardTab.tsx` similarly had `if (error) return [];`. When any network or auth error occurred, it silently zeroed out sales or products, giving `Total Sales = ₹0` and `My Cost = ₹0` without indicating a failure.
   - **Fix**: Removed all silent error swallowing. Queries re-throw errors, activating React Query's `isError` state. `DashboardTab.tsx` now displays an Error Banner with a "Retry Connection" button when any query fails.

5. **Divergent Financial Formulas**:
   - **Before**: `OfflineAnalyticsTab.tsx` used raw `.reduce((sum, s) => sum + s.total, 0)`, `DashboardTab.tsx` used `calculateFinancialMetrics`, and `DashboardDrillDown.tsx` used custom item iteration.
   - **Fix**: Standardized all screens on `calculateFinancialMetrics()` and canonical validity predicates (`isValidPOSSale`, `isValidOnlineOrder`, `isValidReturn`).

---

## 3. Canonical Financial Definitions & Equality Mandate

All reporting screens strictly adhere to the following financial contracts:

$$\text{Total Sales} = \text{Online Gross Revenue} + \text{Offline POS Gross Revenue}$$
$$\text{My Cost} = \sum_{\text{sold items}} (\text{historical\_buying\_price} \times \text{qty})$$
$$\text{Total Profit} = \text{Total Sales} - \text{My Cost}$$

- **Valid Completed Sales**:
  - `status === "completed"` OR `sync_status === "SYNCED"` OR `transaction_status === "COMPLETED"`.
  - Excludes `cancelled`, `voided`, `failed`, `FAILED_REQUIRES_ACTION`.
- **Authoritative Sold-Item Cost**:
  - Captured at transaction commit time into `offline_sale_items.buying_price` from `product_costs.buying_price`.
  - Falls back to catalog buying price if historical cost was not snapshotted.

---

## 4. Real Database Reconciliation Test Results

A live transaction test was conducted using canonical RPC `place_offline_sale`:

### Test Transaction Details:
- **Product**: `saify` (ID: `32f01744-8589-4902-a016-8f1a1b9fd6aa`)
- **Selling Price**: ₹699.00
- **Quantity**: 2
- **Authoritative Historical Buying Price** (`product_costs`): ₹199.00
- **Canonical RPC Result**:
  - `sale_id`: `69679b26-adb1-4f14-a186-7fcc545c8c5e`
  - `sale_number`: `POS-2609-54724`
  - `total`: ₹1,398.00
  - `status`: `completed`

### Verification Results:
| Metric | Calculated Value | Expected Value | Status |
| :--- | :--- | :--- | :--- |
| **Total Sales** | ₹1,398.00 | ₹1,398.00 | **MATCH [PASSED]** |
| **Sales Details Total Sales** | ₹1,398.00 | ₹1,398.00 | **MATCH [PASSED]** |
| **Sum of Valid Transaction Totals** | ₹1,398.00 | ₹1,398.00 | **MATCH [PASSED]** |
| **My Cost (COGS)** | ₹398.00 (₹199 × 2) | ₹398.00 | **MATCH [PASSED]** |
| **Total Profit** | ₹1,000.00 | ₹1,000.00 (₹1,398 − ₹398) | **MATCH [PASSED]** |
| **Formula Check** | ₹1,000.00 === ₹1,398.00 − ₹398.00 | True | **MATCH [PASSED]** |

### Rollback & Cleanup Verification:
- Executed `admin_delete_offline_sale` for `POS-2609-54724`.
- Verified `offline_sales` row deleted, `offline_sale_items` deleted, stock restored.
- Final `offline_sales` count in database: `0` (clean state).

---

## 5. Build & Compilation Certification

- **TypeScript Typecheck**: `npx tsc --noEmit` $\rightarrow$ **0 errors (clean exit code 0)**.
- **Production Build**: `npm run build` $\rightarrow$ **Built client & SSR production bundles in 2.21s (clean exit code 0)**.
