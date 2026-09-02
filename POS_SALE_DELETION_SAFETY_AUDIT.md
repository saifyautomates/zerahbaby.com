# ZÉRAH BABY & KIDS — POS SALE DELETION, VOID/REVERSAL & INVENTORY RESTORATION SAFETY AUDIT

## 1. Executive Summary & Problem Diagnosis

### The Issue
Previously, the POS and Sales management UI presented an unsafe destructive action on completed retail transactions:
- **Dialog text**: *"Delete POS Sale... This will permanently delete the transaction and automatically restore inventory stock for all products."*
- **Action label**: *"Delete & Restore Stock"*
- **Success toast**: *"Sale deleted and stock restored successfully!"*

### Audit Findings & Root Causes
1. **Destructive Obliteration of Completed Transactions**:
   A completed POS sale is an immutable historical financial event and legal invoice. Physically executing `DELETE FROM offline_sales` obliterated the record, destroying the audit trail, corrupting customer lifetime purchase metrics, orphaning past inventory transactions, and preventing future returns (which require `original_sale_item_id` in `offline_sale_items`).
2. **Conflation of Distinct Business Operations**:
   The system treated a administrative deletion as a synthetic "return", silently incrementing inventory (`SET stock = stock + target_item.qty`) without an inspection, store credit ledger entry, or reason code. If goods remained with a customer or were lost/damaged, stock figures became artificially inflated.
3. **Database Triggers vs RPC Side Effects**:
   - Schema audit confirmed **zero** `ON DELETE` database triggers on `offline_sales` or `offline_sale_items`.
   - The stock restoration was exclusively coded inside PL/pgSQL function `public.admin_delete_offline_sale`.
4. **Dangerous Client-Side Fallback Deletion**:
   In `OfflineAnalyticsTab.tsx` and `OnlineSalesTab.tsx`, if the RPC failed, the client executed:
   `await supabase.from("offline_sales").delete().eq("id", saleId);`
   This bypassed the RPC entirely, deleting the sale row with **zero stock restoration**, leaving the system in an inconsistent state.

---

## 2. Separation of Retail Financial Concepts

We have cleanly decoupled and formally defined the four retail lifecycle operations:

| Concept | Trigger / Context | Financial Ledger | Inventory Effect | Customer / Credit Effect | Row Retention |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Return** | Customer brings back purchased items with receipt | Creates `offline_returns` record linked to `original_sale_item_id` | +qty via canonical `offline_return` transaction | Generates store credit voucher in `store_credit_ledger` | Original sale remains `completed`; return items logged |
| **Exchange** | Customer swaps item A for item B | Return voucher for item A + new POS sale for item B | Item A (+qty restocked), Item B (-qty deducted) | Delta settled via cash/UPI or store credit voucher | Both transactions remain 100% intact |
| **Void / Reversal** | Cashier / Admin corrects clerical error (duplicate punch, counter cancellation) | Sale status set to `'voided'`, sets `is_voided = true`, logs `void_reason` & `voided_at` | Atomically creates compensating ledger entry (`type = 'adjustment'`, `reference_type = 'offline_sale_void'`) | Reverts `pos_customers` total spend and purchase count | **Sale and items are permanently preserved** |
| **Draft Discard** | Local client draft unsynced queue item (`off_...`) | Dropped purely from local IndexedDB queue | Zero database / stock mutations | Zero | Deleted from local browser queue only |

---

## 3. Database Schema & Migration Architecture

Forward SQL migration applied:
[`supabase/migrations/20260928000043_harden_pos_sale_void_reversal_safety.sql`](file:///d:/final%20products/zerah%20baby/supabase/migrations/20260928000043_harden_pos_sale_void_reversal_safety.sql)

### 1. Audit Columns on `public.offline_sales`
```sql
ALTER TABLE public.offline_sales 
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS is_voided boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_offline_sales_is_voided 
  ON public.offline_sales(is_voided) 
  WHERE is_voided = true;
```

### 2. Canonical RPC: `admin_void_offline_sale`
- **Security**: `SECURITY DEFINER SET search_path = public`. Strictly checks authenticated roles (`admin`, `staff`, `manager`, `owner`).
- **Row Locking**: Queries `offline_sales WHERE id = _sale_id FOR UPDATE` to eliminate race conditions.
- **Idempotency Guard**: If `target_sale.status IN ('voided', 'cancelled') OR target_sale.is_voided = true`, immediately exits with `{ "already_voided": true }`, guaranteeing that double-voiding or network retries never multiply inventory restorations.
- **Partial Return Reconciliation**: Queries existing `offline_return_items` for the sale to calculate `net_restore_qty = GREATEST(0, item.qty - already_returned_qty)`. Items already returned through the return workflow are not double-restored.
- **Compensating Inventory Movement**:
  Restores `products.stock` and `product_variants.stock`, and logs an explicit audit transaction in `public.inventory_transactions`:
  - `type`: `'adjustment'::public.inventory_tx_type`
  - `reference_type`: `'offline_sale_void'`
  - `reference_id`: `_sale_id`
  - `note`: `'Compensating void reversal for POS sale #' || sale_number || ' (' || reason || ')'`
- **Customer Lifetime Spend Reversion**: Safely decrements `pos_customers.total_purchases` and `total_spend` using `GREATEST(0, ...)`.
- **Permanent Evidence Preservation**:
  Executes `UPDATE public.offline_sales SET status = 'voided', is_voided = true...`. **Does NOT execute SQL DELETE.**

### 3. Safe Deprecation of `admin_delete_offline_sale`
The legacy `admin_delete_offline_sale(_sale_id uuid)` was reprogrammed to forward directly to `admin_void_offline_sale`, completely extinguishing physical deletions from any legacy clients.

### 4. Row Level Security (RLS) Direct Delete Restriction
```sql
DROP POLICY IF EXISTS "allow_delete_offline_sales" ON public.offline_sales;
CREATE POLICY "allow_delete_only_draft_offline_sales" ON public.offline_sales
  FOR DELETE
  USING (status = 'draft');
```
Direct client `.delete()` queries on completed sales are strictly rejected by PostgreSQL RLS.

---

## 4. Frontend UI & Operational Workflow Overhaul

### 1. Replaced Destructive "Delete" with "Void Sale" in `OfflineAnalyticsTab.tsx`
- **Button**: Replaced red `<Trash2 /> Delete` with `<RotateCcw className="size-4" /> Void Sale`.
- **Status Indicator**: If a sale is already voided (`sale.status === 'voided' || sale.is_voided`), renders an unambiguous badge: `🚫 Voided` and displays the audit note directly in the expanded row (`Audit: Reason`).
- **Void Modal Dialog (`VoidSaleModal`)**:
  - Educational notice:
    *"Historical Record Preservation: A completed POS sale is a permanent legal and financial record. Voiding this transaction will cancel the invoice and exclude it from revenue reporting while preserving the historical audit trail. The sale will not be erased."*
  - Mandatory Audit Reason: Requires cashier/admin to input or select an audit reason (e.g. "Cashier item ring-up error", "Accidental duplicate punch", "Customer cancelled at counter", "POS payment failed / voided").
  - Compensating Restock Checkbox: Allows toggling whether physical inventory should be returned to the shelf (default: checked).
  - Confirm Button: "Confirm Void & Reversal".

### 2. Elimination of Fallback Destructive Deletions
- Removed all `supabase.from("offline_sales").delete()` fallbacks from `OfflineAnalyticsTab.tsx` and `OnlineSalesTab.tsx`.
- All operations flow exclusively through `admin_void_offline_sale` or local queue discard (`deleteQueuedSale`).

---

## 5. Reporting & Analytics Alignment

1. **Predicate Verification (`src/lib/financial-reporting.ts`)**:
   `isValidPOSSale(s)` was updated to check:
   ```ts
   if (s.status === "cancelled" || s.status === "voided" || s.is_voided === true) return false;
   ```
2. **Dashboard & Drilldowns**:
   - Total Sales, Gross Revenue, COGS (My Cost), and Gross Profit instantly exclude voided transactions.
   - Offline Analytics table renders voided sales with 60% opacity and clear status badges so managers can review the cancellation audit history.

---

## 6. Regression Testing & Verification

A dedicated automated test suite was created in [`tests/pos-sale-void-reversal.spec.ts`](file:///d:/final%20products/zerah%20baby/tests/pos-sale-void-reversal.spec.ts) covering all requested edge cases:

```
Running 15 tests using 8 workers
✓ [Desktop Chrome] 1. Separation of Concepts: isValidPOSSale rejects voided and cancelled sales
✓ [Desktop Chrome] 2. Reporting Exclusion: Voided transactions do not contribute to revenue or profit
✓ [Desktop Chrome] 3. Idempotent Void Request: Double-voiding does not duplicate stock restorations
✓ [Desktop Chrome] 4. Compatibility Layer: admin_delete_offline_sale aliases to admin_void_offline_sale
✓ [Desktop Chrome] 5. Direct SQL DELETE Restriction: Completed sales cannot be directly deleted via client
...
15 passed (16.0s)
```

### Static Analysis & Build Results:
- `npx tsc --noEmit`: Passed with **0 errors**.
- `npx eslint`: Passed with **0 errors**.
- `npm run build`: Production client & SSR builds passed cleanly in 5.5s / 4.1s.

---

## 7. Operational Summary

| Before | After |
| :--- | :--- |
| Clicking "Delete" physically deleted `offline_sales` row. | Sale row is preserved with `status = 'voided'` and full audit trail. |
| Silently inflated inventory via unrecorded stock addition. | Compensating adjustment logged in `inventory_transactions`. |
| No reason recorded; un-auditable. | Mandatory audit reason recorded with `voided_at` and `voided_by`. |
| Erased parent invoice, breaking customer returns. | Parent invoice preserved; line items and returnability intact. |
| Failed RPC triggered unsafe client fallback delete. | Fallbacks removed; client direct DELETE blocked by database RLS. |
