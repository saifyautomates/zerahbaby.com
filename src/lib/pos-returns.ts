/**
 * POS-Returns — Types, queries, mutations, and return discovery helpers
 * for the Offline POS Returns & Exchange System.
 * Supports: Customer Search, Walk-in Product Barcode Historical Lookup, and Invoice/Transaction QR Scanning.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  generateClientStoreCreditCode,
  generateClientReturnNumber,
  queueOfflineReturn,
} from "@/lib/offline-sync-engine";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ReturnCartItem = {
  product_id: string | null;
  variant_id?: string | null;
  product_slug: string;
  name: string;
  sku: string;
  barcode: string;
  image_url: string | null;
  current_price: number;
  recent_sold_price?: number | null;
  /** final_unit_paid_price from offline_sale_items snapshot — the single source of truth for return credit */
  refund_price: number;
  mrp: number;
  current_stock: number;
  variant_info: string;
  qty: number;
  // Link to original historical transaction line item
  original_sale_id?: string | null;
  original_sale_item_id?: string | null;
  original_sale_number?: string | null;
  original_qty?: number;
  already_returned_qty?: number;
  max_returnable_qty?: number;
  // Historical pricing snapshot (from offline_sale_items)
  unit_mrp?: number;
  unit_selling_price?: number;
  line_gross_amount?: number;
  product_discount_amount?: number;
  allocated_bill_discount?: number;
  allocated_coupon_discount?: number;
  final_unit_paid_price?: number;
  quantity_sold?: number;
  quantity_returned?: number;
  quantity_returnable?: number;
};

export type OfflineReturnItem = {
  id: string;
  return_id: string;
  product_id: string | null;
  variant_id?: string | null;
  product_slug: string;
  name: string;
  sku: string;
  barcode: string;
  variant_info: string;
  refund_price: number;
  qty: number;
  subtotal: number;
  unit_mrp?: number;
  mrp_snapshot: number;
  original_sale_item_id?: string | null;
  created_at: string;
};

export type OfflineReturn = {
  id: string;
  return_number: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  customer_id: string | null;
  refund_amount: number;
  refund_method: string;
  refund_status: string;
  return_reason: string;
  notes: string;
  status: string;
  created_by?: string;
  owner_notification_status?: string | null;
  owner_notified_at?: string | null;
  credit_token?: string | null;
  credit_balance?: number;
  credit_used?: number;
  original_sale_id?: string | null;
  original_sale_number?: string | null;
  linked_sale_id?: string | null;
  created_at: string;
  updated_at: string;
  offline_return_items?: OfflineReturnItem[];
};

export type ReturnResult = {
  return_id: string;
  return_number: string;
  refund_amount: number;
  refund_method?: string;
  credit_token: string;
  customer_name: string;
  customer_phone?: string;
  customer_id?: string | null;
  available_credit?: number;
  customer_credit_balance?: number;
  items_count?: number;
  items_restocked?: number;
  original_sale_id?: string | null;
  original_sale_number?: string | null;
  expires_at?: string;
  duplicate?: boolean;
  is_offline_queued?: boolean;
  is_pending_sync?: boolean;
};

export type ProcessReturnInput = {
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  customer_id: string | null;
  refund_method: string;
  refund_status: string;
  return_reason: string;
  notes: string;
  original_sale_id?: string | null;
  items: Array<{
    product_id: string | null;
    variant_id?: string | null;
    product_slug: string;
    name: string;
    sku: string;
    barcode: string;
    variant_info: string;
    /** refund_price sent to RPC — for invoice-linked items, RPC ignores this and uses historical snapshot */
    refund_price: number;
    qty: number;
    mrp: number;
    /** When set, RPC uses historical final_unit_paid_price for this item */
    original_sale_item_id?: string | null;
  }>;
  idempotency_key: string;
};

export const RETURN_REASONS = [
  "Customer changed mind",
  "Wrong size / fit",
  "Wrong product selected",
  "Damaged product",
  "Defective / manufacturing fault",
  "Fabric / quality issue",
  "Gift return",
  "Other",
] as const;

/* ------------------------------------------------------------------ */
/*  Enriched Sale & Return Metrics Types                               */
/* ------------------------------------------------------------------ */

export type OfflineSaleItemWithReturnStatus = {
  id: string;
  sale_id: string;
  product_id: string | null;
  variant_id?: string | null;
  product_slug?: string;
  name: string;
  sku: string;
  barcode: string;
  variant_info?: string;
  color?: string;
  size?: string;
  qty: number;
  price: number;
  mrp?: number;
  created_at: string;
  already_returned_qty: number;
  returnable_qty: number;
  is_fully_returned: boolean;
  // ── Historical Pricing Snapshot ──
  unit_mrp: number;
  unit_selling_price: number;
  line_gross_amount: number;
  product_discount_amount: number;
  allocated_bill_discount: number;
  allocated_coupon_discount: number;
  final_unit_paid_price: number;
  quantity_sold: number;
  quantity_returned: number;
  quantity_returnable: number;
};

export type OfflineSaleWithReturnMetrics = {
  id: string;
  sale_number: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  customer_id: string | null;
  total: number;
  subtotal: number;
  discount: number;
  tax?: number;
  payment_method: string;
  status: string;
  pos_token_number?: number | null;
  notes?: string;
  created_at: string;
  offline_sale_items: OfflineSaleItemWithReturnStatus[];
  has_returnable_items: boolean;
  total_items_count: number;
  total_returnable_count: number;
};

/* ------------------------------------------------------------------ */
/*  Barcode & QR Code Parser Helper                                   */
/* ------------------------------------------------------------------ */

export type ScanCodeType = "invoice_qr" | "credit_token" | "product_barcode";

export function parseReturnScanCode(raw: string): { type: ScanCodeType; value: string } {
  const trimmed = raw.trim();

  // 1. Invoice Number format (e.g. POS-2609-00012, INV-2026-...)
  if (/^POS-\d{4}-\d+/i.test(trimmed) || /^INV-/i.test(trimmed)) {
    return { type: "invoice_qr", value: trimmed.toUpperCase() };
  }

  // 2. Store Credit Token format (e.g. 4-character tokens like 7J5X, K9M2, or legacy ZRH-..., A123, P258)
  if (
    /^[2-9A-HJ-NP-Z]{4}$/i.test(trimmed) ||
    /^[A-Z0-9]{4}$/i.test(trimmed) ||
    /^ZRH-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(trimmed) ||
    /^ZRH-[A-Z0-9-]+/i.test(trimmed) ||
    /^[A-Z][0-9]{3}$/i.test(trimmed) ||
    /^ZCR-[A-Z0-9]+/i.test(trimmed) ||
    /^CR-[A-Z0-9-]+/i.test(trimmed)
  ) {
    return { type: "credit_token", value: trimmed.toUpperCase() };
  }

  // 3. URL containing invoice query param (e.g. https://.../receipt?invoice=POS-2609-00012)
  if (trimmed.includes("invoice=") || trimmed.includes("sale_number=")) {
    try {
      const url = new URL(trimmed);
      const inv = url.searchParams.get("invoice") || url.searchParams.get("sale_number");
      if (inv) return { type: "invoice_qr", value: inv.toUpperCase() };
    } catch {
      // Not a valid URL, treat as barcode
    }
  }

  // 4. Default to Product Barcode / SKU
  return { type: "product_barcode", value: trimmed };
}

/**
 * Generates standardized ZRH-XXXX-XXXX Store Credit Voucher Token (e.g. ZRH-7B89-K29P)
 */
export function generateStoreCreditCode(): string {
  return generateClientStoreCreditCode();
}

/* ------------------------------------------------------------------ */
/*  Barcode / Product Lookup for Returns                              */
/* ------------------------------------------------------------------ */

export type ReturnProductLookupResult = {
  found: boolean;
  error?: string;
  product_id?: string;
  variant_id?: string | null;
  product_slug?: string;
  name?: string;
  sku?: string;
  barcode?: string;
  image_url?: string | null;
  current_price?: number;
  recent_sold_price?: number | null;
  /** final_unit_paid_price from most recent offline_sale_items row — used as refund price for barcode-scan walk-in returns */
  historical_paid_price?: number | null;
  historical_unit_mrp?: number | null;
  historical_unit_selling_price?: number | null;
  historical_allocated_bill_discount?: number | null;
  historical_allocated_coupon_discount?: number | null;
  mrp?: number;
  stock?: number;
  variant_info?: string;
};

export async function lookupProductForReturn(code: string): Promise<ReturnProductLookupResult> {
  const trimmed = code.trim();
  if (!trimmed) {
    return { found: false, error: "Empty barcode" };
  }

  // 1. Try resolving through products table (by barcode, sku, slug, or id)
  const { data: barcodeProduct, error: prodErr } = await supabase
    .from("products")
    .select(
      "id, slug, name, price, mrp, stock, sku, barcode, is_active, age_group, product_images(public_url, is_primary, sort_order)",
    )
    .eq("barcode", trimmed)
    .maybeSingle();

  let product = barcodeProduct;

  if (!product && !prodErr) {
    const { data: skuProduct } = await supabase
      .from("products")
      .select(
        "id, slug, name, price, mrp, stock, sku, barcode, is_active, age_group, product_images(public_url, is_primary, sort_order)",
      )
      .eq("sku", trimmed)
      .maybeSingle();
    product = skuProduct;
  }

  if (!product && !prodErr) {
    const { data: slugProduct } = await supabase
      .from("products")
      .select(
        "id, slug, name, price, mrp, stock, sku, barcode, is_active, age_group, product_images(public_url, is_primary, sort_order)",
      )
      .eq("slug", trimmed)
      .maybeSingle();
    product = slugProduct;
  }

  // Also check product_variants table by barcode or SKU
  let matchedVariant: {
    id: string;
    product_id: string | null;
    name: string;
    sku?: string | null;
    barcode?: string | null;
    color?: string | null;
    size?: string | null;
    price_override?: number | null;
    mrp_override?: number | null;
    stock?: number | null;
    image_url?: string | null;
  } | null = null;

  if (!product && !prodErr) {
    const { data: varBarcode } = await supabase
      .from("product_variants")
      .select(
        "id, product_id, name, sku, barcode, color, size, price_override, mrp_override, stock, image_url",
      )
      .eq("barcode", trimmed)
      .maybeSingle();

    matchedVariant = varBarcode;

    if (!matchedVariant) {
      const { data: varSku } = await supabase
        .from("product_variants")
        .select(
          "id, product_id, name, sku, barcode, color, size, price_override, mrp_override, stock, image_url",
        )
        .eq("sku", trimmed)
        .maybeSingle();
      matchedVariant = varSku;
    }

    if (matchedVariant?.product_id) {
      const { data: parentProd } = await supabase
        .from("products")
        .select(
          "id, slug, name, price, mrp, stock, sku, barcode, is_active, age_group, product_images(public_url, is_primary, sort_order)",
        )
        .eq("id", matchedVariant.product_id)
        .maybeSingle();
      product = parentProd;
    }
  }

  if (!product) {
    return { found: false, error: `Product not found for barcode '${trimmed}'` };
  }

  // 2. Fetch most recent offline sale item for this product — use historical snapshot
  //    final_unit_paid_price is the exact net amount paid per unit after all discounts.
  //    This is the ONLY correct source for walk-in barcode return pricing.
  let recentSoldPrice: number | null = null;
  let historicalPaidPrice: number | null = null;
  let historicalUnitMrp: number | null = null;
  let historicalUnitSellingPrice: number | null = null;
  let historicalAllocatedBill: number | null = null;
  let historicalAllocatedCoupon: number | null = null;

  try {
    const { data: recentSaleItem } = await (supabase as any)
      .from("offline_sale_items")
      .select(
        "price, final_unit_paid_price, unit_mrp, unit_selling_price, allocated_bill_discount, allocated_coupon_discount, created_at, offline_sales(subtotal, discount, total)",
      )
      .eq("product_id", product.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentSaleItem) {
      recentSoldPrice = typeof recentSaleItem.price === "number" ? recentSaleItem.price : null;
      const unitSell =
        typeof recentSaleItem.unit_selling_price === "number" &&
        recentSaleItem.unit_selling_price > 0
          ? recentSaleItem.unit_selling_price
          : recentSoldPrice || 0;
      const parentSale = recentSaleItem.offline_sales;
      const saleSubtotal = Number(parentSale?.subtotal) || 0;
      const saleDiscount = Number(parentSale?.discount) || 0;

      let calcPaid = Number(recentSaleItem.final_unit_paid_price) || 0;
      let allocBill = Number(recentSaleItem.allocated_bill_discount) || 0;

      if (calcPaid <= 0 || (saleDiscount > 0 && Math.abs(calcPaid - unitSell) < 0.001)) {
        if (saleSubtotal > 0 && saleDiscount > 0) {
          const propDisc = (saleDiscount * unitSell) / saleSubtotal;
          calcPaid = Math.max(0, Number((unitSell - propDisc).toFixed(2)));
          allocBill = Number(propDisc.toFixed(2));
        } else {
          calcPaid = unitSell;
        }
      }

      historicalPaidPrice = calcPaid;
      historicalUnitMrp =
        typeof recentSaleItem.unit_mrp === "number" && recentSaleItem.unit_mrp > 0
          ? recentSaleItem.unit_mrp
          : null;
      historicalUnitSellingPrice = unitSell;
      historicalAllocatedBill = allocBill;
      historicalAllocatedCoupon =
        typeof recentSaleItem.allocated_coupon_discount === "number"
          ? recentSaleItem.allocated_coupon_discount
          : null;
    }
  } catch {
    // Non-fatal, fallback to current_price
  }

  const currentPrice = Number(matchedVariant?.price_override || product.price || 0);
  const mrp = Number(matchedVariant?.mrp_override || product.mrp || currentPrice);
  const variantInfo = matchedVariant
    ? [matchedVariant.color, matchedVariant.size].filter(Boolean).join(" / ") || matchedVariant.name
    : product.age_group || "";

  return {
    found: true,
    product_id: product.id,
    variant_id: matchedVariant?.id || null,
    product_slug: product.slug,
    name: product.name,
    sku: matchedVariant?.sku || product.sku || "",
    barcode: matchedVariant?.barcode || product.barcode || trimmed,
    image_url:
      matchedVariant?.image_url ||
      (product as { product_images?: { public_url: string }[] }).product_images?.[0]?.public_url ||
      null,
    current_price: currentPrice,
    recent_sold_price: recentSoldPrice,
    historical_paid_price: historicalPaidPrice,
    historical_unit_mrp: historicalUnitMrp,
    historical_unit_selling_price: historicalUnitSellingPrice,
    historical_allocated_bill_discount: historicalAllocatedBill,
    historical_allocated_coupon_discount: historicalAllocatedCoupon,
    mrp: mrp,
    stock: Number(matchedVariant ? matchedVariant.stock : product.stock || 0),
    variant_info: variantInfo,
  };
}

/* ------------------------------------------------------------------ */
/*  Query Hook: Enriched Offline Sales with Return Status              */
/* ------------------------------------------------------------------ */

export function useOfflineSalesForReturnsLookup() {
  return useQuery<OfflineSaleWithReturnMetrics[]>({
    queryKey: ["offline-sales-with-return-metrics"],
    queryFn: async () => {
      // 1. Fetch offline sales with items (excluding cancelled and voided sales)
      const { data: rawSales, error: salesErr } = await (supabase as any)
        .from("offline_sales")
        .select("*, offline_sale_items(*)")
        .not("status", "in", '("cancelled","voided")')
        .order("created_at", { ascending: false })
        .limit(300);

      if (salesErr || !rawSales) return [];

      // 2. Fetch all return items to calculate already returned quantities
      const { data: rawReturnItems } = await (supabase as any)
        .from("offline_return_items")
        .select("id, return_id, product_id, sku, barcode, qty, original_sale_item_id");

      // Map: original_sale_item_id -> total returned qty
      const returnedQtyByItemId = new Map<string, number>();

      ((rawReturnItems || []) as Array<{ original_sale_item_id?: string; qty?: number }>).forEach(
        (ri) => {
          if (ri.original_sale_item_id) {
            const prev = returnedQtyByItemId.get(ri.original_sale_item_id) || 0;
            returnedQtyByItemId.set(ri.original_sale_item_id, prev + (Number(ri.qty) || 1));
          }
        },
      );

      // Filter out voided/cancelled sales defensively in memory
      const validSales = (rawSales as any[]).filter(
        (s) =>
          s.status !== "cancelled" &&
          s.status !== "voided" &&
          !s.is_voided &&
          !(typeof s.notes === "string" && s.notes.toUpperCase().startsWith("[VOIDED]")),
      );

      // 3. Enrich sales with item-level returnable calculations
      const enriched: OfflineSaleWithReturnMetrics[] = validSales.map((s) => {
        let totalReturnableCount = 0;
        let totalItemsCount = 0;

        const enrichedItems: OfflineSaleItemWithReturnStatus[] = (s.offline_sale_items || []).map(
          (it: any) => {
            const itemQty = Number(it.qty) || 1;
            totalItemsCount += itemQty;

            // DB is now authoritative for quantity_returned — use it directly
            // Fall back to returnedQtyByItemId join for pre-migration rows
            const alreadyReturned = returnedQtyByItemId.get(it.id) || 0;

            // Historical pricing snapshot — prefer DB columns, fall back to price
            const dbFinalUnitPaid = Number(it.final_unit_paid_price) || 0;
            const dbUnitMrp =
              Number(it.unit_mrp) || Number(it.mrp_snapshot) || Number(it.price) || 0;
            const dbUnitSelling = Number(it.unit_selling_price) || Number(it.price) || 0;
            let dbAllocBill = Number(it.allocated_bill_discount) || 0;
            const dbAllocCoupon = Number(it.allocated_coupon_discount) || 0;
            const dbQuantitySold = Math.max(1, Number(it.quantity_sold) || Number(it.quantity) || itemQty);
            const dbQuantityReturned = Math.max(0, Math.max(Number(it.quantity_returned) || 0, alreadyReturned));

            // Strict quantity math: remaining returnable quantity is sold minus valid returned
            const calculatedReturnable = Math.max(0, dbQuantitySold - dbQuantityReturned);
            const rawReturnable = it.quantity_returnable != null ? Number(it.quantity_returnable) : null;

            // Defensive fallback: If rawReturnable from DB is 0 but NO return was ever recorded (dbQuantityReturned === 0),
            // do NOT allow schema default 0 to falsely claim the item was returned!
            const dbQuantityReturnable =
              rawReturnable != null && (dbQuantityReturned > 0 || rawReturnable > 0)
                ? Math.min(rawReturnable, calculatedReturnable)
                : calculatedReturnable;

            totalReturnableCount += dbQuantityReturnable;

            const saleSubtotal = Number(s.subtotal) || Number(s.total) || 0;
            const saleDiscount = Number(s.discount) || 0;

            let finalUnitPaid = dbFinalUnitPaid;
            if (
              finalUnitPaid <= 0 ||
              (saleDiscount > 0 && Math.abs(finalUnitPaid - dbUnitSelling) < 0.001)
            ) {
              if (saleSubtotal > 0 && saleDiscount > 0) {
                const propDiscount = (saleDiscount * dbUnitSelling) / saleSubtotal;
                finalUnitPaid = Math.max(0, Number((dbUnitSelling - propDiscount).toFixed(2)));
                if (dbAllocBill === 0 && dbAllocCoupon === 0) {
                  dbAllocBill = Number(propDiscount.toFixed(2));
                }
              } else {
                finalUnitPaid = dbUnitSelling;
              }
            }

            return {
              id: it.id,
              sale_id: it.sale_id,
              product_id: it.product_id,
              variant_id: it.variant_id || null,
              product_slug: it.product_slug,
              name: it.name || "Item",
              sku: it.sku || "",
              barcode: it.barcode || it.barcode_snapshot || "",
              variant_info: it.variant_info || "",
              color: it.color || "",
              size: it.size || "",
              qty: itemQty,
              price: dbUnitSelling, // show historical selling price, not current
              mrp: dbUnitMrp,
              created_at: it.created_at || s.created_at,
              already_returned_qty: dbQuantityReturned,
              returnable_qty: dbQuantityReturnable,
              is_fully_returned: dbQuantityReturned >= dbQuantitySold && dbQuantityReturned > 0,
              // ── Historical Pricing Snapshot ──
              unit_mrp: dbUnitMrp,
              unit_selling_price: dbUnitSelling,
              line_gross_amount: Number(it.line_gross_amount) || dbUnitSelling * itemQty,
              product_discount_amount: Number(it.product_discount_amount) || 0,
              allocated_bill_discount: dbAllocBill,
              allocated_coupon_discount: dbAllocCoupon,
              final_unit_paid_price: finalUnitPaid,
              quantity_sold: dbQuantitySold,
              quantity_returned: dbQuantityReturned,
              quantity_returnable: dbQuantityReturnable,
            };
          },
        );

        return {
          id: s.id,
          sale_number: s.sale_number,
          customer_name: s.customer_name || "Walk-in Customer",
          customer_phone: s.customer_phone || "",
          customer_email: s.customer_email || "",
          customer_id: s.customer_id || null,
          total: Number(s.total) || 0,
          subtotal: Number(s.subtotal) || Number(s.total) || 0,
          discount: Number(s.discount) || 0,
          tax: Number(s.tax || 0),
          payment_method: s.payment_method || "cash",
          status: s.status,
          pos_token_number: s.pos_token_number,
          notes: s.notes || "",
          created_at: s.created_at,
          offline_sale_items: enrichedItems,
          has_returnable_items: totalReturnableCount > 0,
          total_items_count: totalItemsCount,
          total_returnable_count: totalReturnableCount,
        };
      });

      return enriched;
    },
    staleTime: 5_000,
  });
}

/* ------------------------------------------------------------------ */
/*  Process Return Mutation Hook                                      */
/* ------------------------------------------------------------------ */

export function useProcessOfflineReturn() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: ProcessReturnInput): Promise<ReturnResult> => {
      // 1. Generate client-side deterministic return number and store credit token
      const clientCreditCode = generateStoreCreditCode();
      const clientReturnNumber = generateClientReturnNumber();
      const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

      const refundAmount = input.items.reduce(
        (sum, item) => sum + (Number(item.refund_price) || 0) * (Number(item.qty) || 1),
        0,
      );

      // 2. Direct offline path if navigator reports offline
      if (!isOnline) {
        const queued = await queueOfflineReturn({
          idempotency_key: input.idempotency_key,
          return_number: clientReturnNumber,
          credit_token: clientCreditCode,
          customer_id: input.customer_id || null,
          customer_name: input.customer_name || "Walk-in Customer",
          customer_phone: input.customer_phone || "",
          customer_email: input.customer_email || "",
          refund_method: input.refund_method || "exchange_credit",
          refund_status: input.refund_status || "completed",
          return_reason: input.return_reason || "Customer Return",
          notes: input.notes || "",
          original_sale_id: input.original_sale_id || null,
          items: input.items.map((it) => ({
            product_id: it.product_id || null,
            variant_id: it.variant_id || null,
            product_slug: it.product_slug || "",
            name: it.name,
            sku: it.sku || "",
            barcode: it.barcode || "",
            variant_info: it.variant_info || "",
            refund_price: Number(it.refund_price) || 0,
            qty: Number(it.qty) || 1,
            mrp: Number(it.mrp) || 0,
            original_sale_item_id: it.original_sale_item_id || null,
          })),
          refund_amount: refundAmount,
        });

        return {
          return_id: queued.id,
          return_number: clientReturnNumber,
          refund_amount: refundAmount,
          refund_method: input.refund_method || "exchange_credit",
          credit_token: clientCreditCode,
          customer_name: input.customer_name || "Walk-in Customer",
          customer_phone: input.customer_phone || "",
          customer_id: input.customer_id || null,
          available_credit: refundAmount,
          customer_credit_balance: refundAmount,
          items_count: input.items.length,
          items_restocked: input.items.reduce((s, it) => s + (Number(it.qty) || 1), 0),
          original_sale_id: input.original_sale_id || null,
          is_offline_queued: true,
          is_pending_sync: true,
        };
      }

      // 3. Online RPC execution with fallback to offline queue on network failures
      try {
        const { data, error } = await (
          supabase.rpc as unknown as (
            fn: string,
            args: Record<string, unknown>,
          ) => Promise<{ data: ReturnResult; error: { message: string } | null }>
        )("process_offline_return", {
          _customer_name: input.customer_name,
          _customer_phone: input.customer_phone,
          _customer_email: input.customer_email,
          _customer_id: input.customer_id,
          _refund_method: input.refund_method || "exchange_credit",
          _refund_status: input.refund_status,
          _return_reason: input.return_reason,
          _notes: input.notes,
          _original_sale_id: input.original_sale_id || null,
          _items: input.items,
          _idempotency_key: input.idempotency_key,
          _custom_return_number: clientReturnNumber,
          _custom_credit_token: clientCreditCode,
        });

        if (error) {
          const errMsg = error.message.toLowerCase();
          const isNetworkErr =
            errMsg.includes("network") ||
            errMsg.includes("fetch") ||
            errMsg.includes("timeout") ||
            errMsg.includes("abort") ||
            errMsg.includes("failed to fetch");

          if (isNetworkErr) {
            const queued = await queueOfflineReturn({
              idempotency_key: input.idempotency_key,
              return_number: clientReturnNumber,
              credit_token: clientCreditCode,
              customer_id: input.customer_id || null,
              customer_name: input.customer_name || "Walk-in Customer",
              customer_phone: input.customer_phone || "",
              customer_email: input.customer_email || "",
              refund_method: input.refund_method || "exchange_credit",
              refund_status: input.refund_status || "completed",
              return_reason: input.return_reason || "Customer Return",
              notes: input.notes || "",
              original_sale_id: input.original_sale_id || null,
              items: input.items.map((it) => ({
                product_id: it.product_id || null,
                variant_id: it.variant_id || null,
                product_slug: it.product_slug || "",
                name: it.name,
                sku: it.sku || "",
                barcode: it.barcode || "",
                variant_info: it.variant_info || "",
                refund_price: Number(it.refund_price) || 0,
                qty: Number(it.qty) || 1,
                mrp: Number(it.mrp) || 0,
                original_sale_item_id: it.original_sale_item_id || null,
              })),
              refund_amount: refundAmount,
            });

            return {
              return_id: queued.id,
              return_number: clientReturnNumber,
              refund_amount: refundAmount,
              refund_method: input.refund_method || "exchange_credit",
              credit_token: clientCreditCode,
              customer_name: input.customer_name || "Walk-in Customer",
              customer_phone: input.customer_phone || "",
              customer_id: input.customer_id || null,
              available_credit: refundAmount,
              customer_credit_balance: refundAmount,
              items_count: input.items.length,
              items_restocked: input.items.reduce((s, it) => s + (Number(it.qty) || 1), 0),
              original_sale_id: input.original_sale_id || null,
              is_offline_queued: true,
              is_pending_sync: true,
            };
          }

          throw new Error(error.message);
        }

        return data as ReturnResult;
      } catch (err: unknown) {
        const errMsg = (err as Error)?.message?.toLowerCase() || "";
        const isNetworkErr =
          errMsg.includes("network") ||
          errMsg.includes("fetch") ||
          errMsg.includes("timeout") ||
          errMsg.includes("abort") ||
          errMsg.includes("failed to fetch");

        if (isNetworkErr) {
          const queued = await queueOfflineReturn({
            idempotency_key: input.idempotency_key,
            return_number: clientReturnNumber,
            credit_token: clientCreditCode,
            customer_id: input.customer_id || null,
            customer_name: input.customer_name || "Walk-in Customer",
            customer_phone: input.customer_phone || "",
            customer_email: input.customer_email || "",
            refund_method: input.refund_method || "exchange_credit",
            refund_status: input.refund_status || "completed",
            return_reason: input.return_reason || "Customer Return",
            notes: input.notes || "",
            original_sale_id: input.original_sale_id || null,
            items: input.items.map((it) => ({
              product_id: it.product_id || null,
              variant_id: it.variant_id || null,
              product_slug: it.product_slug || "",
              name: it.name,
              sku: it.sku || "",
              barcode: it.barcode || "",
              variant_info: it.variant_info || "",
              refund_price: Number(it.refund_price) || 0,
              qty: Number(it.qty) || 1,
              mrp: Number(it.mrp) || 0,
              original_sale_item_id: it.original_sale_item_id || null,
            })),
            refund_amount: refundAmount,
          });

          return {
            return_id: queued.id,
            return_number: clientReturnNumber,
            refund_amount: refundAmount,
            refund_method: input.refund_method || "exchange_credit",
            credit_token: clientCreditCode,
            customer_name: input.customer_name || "Walk-in Customer",
            customer_phone: input.customer_phone || "",
            customer_id: input.customer_id || null,
            available_credit: refundAmount,
            customer_credit_balance: refundAmount,
            items_count: input.items.length,
            items_restocked: input.items.reduce((s, it) => s + (Number(it.qty) || 1), 0),
            original_sale_id: input.original_sale_id || null,
            is_offline_queued: true,
            is_pending_sync: true,
          };
        }

        throw err;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["offline-returns"] });
      qc.invalidateQueries({ queryKey: ["offline-sales"] });
      qc.invalidateQueries({ queryKey: ["offline-sales-with-return-metrics"] });
      qc.invalidateQueries({ queryKey: ["offline-sales-for-returns-history-lookup"] });
      qc.invalidateQueries({ queryKey: ["offline-analytics"] });
      qc.invalidateQueries({ queryKey: ["offline-analytics-timeseries"] });
      qc.invalidateQueries({ queryKey: ["admin-products"] });
      qc.invalidateQueries({ queryKey: ["admin-products-count"] });
      qc.invalidateQueries({ queryKey: ["inventory-transactions"] });
      qc.invalidateQueries({ queryKey: ["offline-sales-badge-count"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product"] });
      qc.invalidateQueries({ queryKey: ["pos-products"] });
      qc.invalidateQueries({ queryKey: ["admin-search-products"] });
      qc.invalidateQueries({ queryKey: ["pos-customer-credit"] });
      qc.invalidateQueries({ queryKey: ["pos-customers"] });
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Customer Store Credit Query Hook                                  */
/* ------------------------------------------------------------------ */

export type CustomerCreditInfo = {
  customer_id: string | null;
  customer_name: string;
  customer_phone?: string;
  available_credit: number;
  credit_token?: string;
  active_returns?: Array<{
    id: string;
    return_number?: string;
    credit_token?: string;
    refund_amount?: number;
    credit_used?: number;
    credit_balance?: number;
    created_at?: string;
    expires_at?: string;
  }>;
  history: Array<{
    id: string;
    type: "CREDIT_ISSUED" | "CREDIT_USED" | "CREDIT_ADJUSTED";
    amount: number;
    balance_before: number;
    balance_after: number;
    credit_token: string;
    notes: string;
    created_at: string;
  }>;
};

export type StoreCreditVoucherResult = {
  valid: boolean;
  error?: string;
  voucher_id?: string;
  token?: string;
  customer_id?: string | null;
  customer_name?: string;
  customer_phone?: string;
  original_sale_id?: string | null;
  original_sale_number?: string | null;
  original_return_number?: string;
  original_amount?: number;
  credit_used?: number;
  remaining_balance?: number;
  available_credit?: number;
  issued_at?: string;
  expires_at?: string;
  days_remaining?: number;
  status?: string;
  expired?: boolean;
  ownership_mismatch?: boolean;
  is_coupon?: boolean;
  coupon_code?: string;
  discount_type?: "percentage" | "fixed";
  discount_value?: number;
  min_cart_value?: number;
  max_discount?: number | null;
};

export function useStoreCreditVoucher(params: {
  token?: string | null;
  customerId?: string | null;
  phone?: string | null;
}) {
  const { token, customerId, phone } = params;
  const cleanToken = token?.trim().toUpperCase() || "";
  const enabled = cleanToken.length >= 3;

  return useQuery<StoreCreditVoucherResult>({
    queryKey: ["pos-store-credit-voucher", cleanToken, customerId, phone],
    queryFn: async () => {
      // 1. Primary: Attempt get_store_credit_voucher RPC
      try {
        const { data, error } = await (
          supabase.rpc as unknown as (
            fn: string,
            args: Record<string, unknown>,
          ) => Promise<{ data: StoreCreditVoucherResult | null; error: { message: string } | null }>
        )("get_store_credit_voucher", {
          _token: cleanToken,
          _customer_id: customerId || null,
          _phone: phone || "",
        });

        if (!error && data) {
          return data;
        }
      } catch {
        // Fall through to resilient fallback
      }

      // 2. Resilient Fallback: Query get_customer_store_credit with _token
      try {
        const { data: creditData, error: creditErr } = await (
          supabase.rpc as unknown as (
            fn: string,
            args: Record<string, unknown>,
          ) => Promise<{ data: any; error: any }>
        )("get_customer_store_credit", {
          _token: cleanToken,
          _customer_id: customerId || null,
          _phone: phone || "",
        });

        if (!creditErr && creditData) {
          const matchingReturn =
            creditData.active_returns?.find(
              (r: any) => r.credit_token?.toUpperCase() === cleanToken,
            ) || creditData.active_returns?.[0];

          const creditAvail = Math.max(
            Number(creditData.available_credit) || 0,
            Number(matchingReturn?.credit_balance) || 0,
          );

          if (creditAvail > 0) {
            return {
              valid: true,
              is_coupon: false,
              token: cleanToken,
              voucher_id: matchingReturn?.id,
              customer_id: creditData.customer_id,
              customer_name: creditData.customer_name || "Walk-in Customer",
              customer_phone: creditData.customer_phone || "",
              original_amount: matchingReturn?.refund_amount ?? creditAvail,
              remaining_balance: matchingReturn?.credit_balance ?? creditAvail,
              available_credit: creditAvail,
              expires_at: matchingReturn?.expires_at,
              status: "active",
            };
          }
        }
      } catch {
        // Fall through
      }

      // 3. Resilient Fallback: Check promotional coupons table
      try {
        const { data: coupon, error: coupErr } = await supabase
          .from("coupons")
          .select("*")
          .eq("code", cleanToken)
          .eq("is_active", true)
          .maybeSingle();

        if (!coupErr && coupon) {
          return {
            valid: true,
            is_coupon: true,
            coupon_code: coupon.code,
            token: coupon.code,
            discount_type: coupon.discount_type as "percentage" | "fixed",
            discount_value: Number(coupon.discount_value) || 0,
            min_cart_value: Number(coupon.minimum_order_value) || 0,
            max_discount: coupon.maximum_discount ? Number(coupon.maximum_discount) : null,
            remaining_balance: Number(coupon.discount_value) || 0,
            available_credit: Number(coupon.discount_value) || 0,
            status: "active",
          };
        }
      } catch {
        // Fall through
      }

      return { valid: false, error: `Voucher or Coupon ${cleanToken} not found` };
    },
    enabled,
    staleTime: 5_000,
  });
}

export function useCustomerStoreCredit(params: {
  customerId?: string | null;
  phone?: string | null;
  token?: string | null;
}) {
  const { customerId, phone, token } = params;
  const enabled = Boolean(
    customerId ||
    (phone && phone.replace(/\D/g, "").length >= 10) ||
    (token && token.trim().length >= 3),
  );

  return useQuery<CustomerCreditInfo>({
    queryKey: ["pos-customer-credit", customerId, phone, token],
    queryFn: async () => {
      const { data, error } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: CustomerCreditInfo | null; error: { message: string } | null }>
      )("get_customer_store_credit", {
        _customer_id: customerId || null,
        _phone: phone || "",
        _token: token || "",
      });

      if (error) throw new Error(error.message);

      const raw = data || {
        customer_id: null,
        customer_name: "Walk-in Customer",
        available_credit: 0,
        history: [],
      };

      // Calculate true available credit from raw balance and active returns
      const activeReturnsBalance =
        (raw.active_returns as any[])?.reduce(
          (sum: number, r: any) => sum + (Number(r.credit_balance) || 0),
          0,
        ) ?? 0;

      const effectiveAvailableCredit = Math.max(
        Number(raw.available_credit) || 0,
        activeReturnsBalance,
      );

      const resolvedToken =
        raw.credit_token || (raw.active_returns as any[])?.[0]?.credit_token || "";

      return {
        ...raw,
        available_credit: effectiveAvailableCredit,
        credit_token: resolvedToken,
      };
    },
    enabled,
    staleTime: 5_000,
  });
}

/* ------------------------------------------------------------------ */
/*  Offline Returns List Query Hook                                    */
/* ------------------------------------------------------------------ */

export function useOfflineReturnsList() {
  return useQuery<OfflineReturn[]>({
    queryKey: ["offline-returns"],
    queryFn: async () => {
      const { data, error } = await (
        supabase as unknown as {
          from: (t: string) => {
            select: (cols: string) => {
              order: (
                col: string,
                opts: { ascending: boolean },
              ) => {
                limit: (n: number) => Promise<{
                  data: OfflineReturn[] | null;
                  error: { message: string } | null;
                }>;
              };
            };
          };
        }
      )
        .from("offline_returns")
        .select("*, offline_return_items(*)")
        .order("created_at", { ascending: false })
        .limit(1000);

      if (error) throw error;
      return (data ?? []) as unknown as OfflineReturn[];
    },
  });
}

export function useDeleteOfflineReturns() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      returnIds,
      revertStock = false,
    }: {
      returnIds: string[];
      revertStock?: boolean;
    }) => {
      const validUuids = returnIds.filter((id) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
      );

      if (validUuids.length === 0) {
        throw new Error("No valid return IDs provided");
      }

      const { data, error } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{
          data: { success?: boolean; message?: string; deleted_count?: number } | null;
          error: { message: string } | null;
        }>
      )("admin_hard_delete_offline_returns", {
        _return_ids: validUuids,
        _revert_stock: revertStock,
      });

      if (error) {
        throw new Error(error.message || "Failed to delete return records");
      }

      return data;
    },
    onSuccess: (res) => {
      toast.success(res?.message || "Return record(s) deleted successfully.");
      qc.invalidateQueries({ queryKey: ["offline-returns"] });
      qc.invalidateQueries({ queryKey: ["pos-returns"] });
      qc.invalidateQueries({ queryKey: ["admin-canonical-pos-sales"] });
      qc.invalidateQueries({ queryKey: ["admin-database-notifications"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["admin-products"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to delete return records");
    },
  });
}
