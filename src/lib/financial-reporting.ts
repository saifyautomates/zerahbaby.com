/**
 * Financial Reporting & Revenue Reconciliation Engine
 * Single authoritative source of truth for financial formulas across Zérah Baby & Kids.
 *
 * Core Formulas:
 * 1. Gross Revenue = Online Gross Sales + Offline POS Gross Sales
 * 2. Total Returns/Refunds = Processed Customer Returns & Refunds
 * 3. Total Net Revenue = Gross Revenue - Total Returns/Refunds
 * 4. Total COGS = Buying Price × Sold Quantity
 * 5. Gross Profit = Gross Revenue - Total COGS
 * 6. Net Profit = Total Net Revenue - Total COGS (i.e. Gross Profit - Returns)
 * 7. Average Order Value (AOV) = Net Revenue / Total Transactions Count
 */

export interface ReportItemCost {
  buying_price?: number;
}

export interface ReportProduct {
  id: string;
  slug: string;
  name?: string;
  price?: number;
  stock?: number;
  sku?: string | null;
  product_costs?: ReportItemCost | ReportItemCost[] | null;
}

export interface ReportOrderItem {
  id?: string;
  product_id?: string | null;
  product_slug?: string;
  name?: string;
  qty?: number;
  quantity?: number;
  price?: number;
  subtotal?: number;
  cost_price?: number | null;
  buying_price?: number | null;
  buyingPrice?: number | null;
}

export interface ReportOrder {
  id: string;
  created_at: string;
  status?: string;
  payment_status?: string;
  payment_method?: string;
  total?: number;
  order_items?: ReportOrderItem[];
  full_name?: string;
  email?: string;
  phone?: string;
}

export interface ReportPOSItem {
  id?: string;
  product_id?: string | null;
  product_slug?: string | null;
  name?: string | null;
  sku?: string | null;
  qty?: number;
  quantity?: number;
  price?: number;
  subtotal?: number;
  cost_price?: number | null;
  buying_price?: number | null;
  buyingPrice?: number | null;
  quantity_sold?: number;
  quantity_returned?: number;
  returned_quantity?: number;
  return_status?: string | null;
}

export interface ReportPOSSale {
  id: string;
  sale_number?: string;
  created_at: string;
  status?: string | null;
  return_status?: string | null;
  returned_amount?: number | null;
  payment_method?: string | null;
  total?: number;
  subtotal?: number;
  discount?: number;
  offline_sale_items?: ReportPOSItem[];
  customer_name?: string | null;
  customer_phone?: string | null;
  store_credit_used?: number | null;
  idempotency_key?: string | null;
  sync_status?: string | null;
  transaction_status?: string | null;
  last_error?: string | null;
  is_voided?: boolean | null;
  void_reason?: string | null;
  voided_at?: string | null;
  notes?: string | null;
}

export interface ReportReturnItem {
  id?: string;
  product_id?: string | null;
  product_slug?: string;
  name?: string;
  sku?: string;
  qty?: number;
  quantity?: number;
  refund_price?: number;
  subtotal?: number;
  refund_subtotal?: number;
}

export interface ReportReturn {
  id: string;
  return_number?: string;
  sale_id?: string | null;
  created_at: string;
  status?: string;
  refund_status?: string;
  refund_amount?: number;
  refund_method?: string;
  customer_name?: string;
  customer_phone?: string;
  offline_return_items?: ReportReturnItem[];
}

export interface FinancialMetrics {
  // Sales / Gross
  onlineGrossRevenue: number;
  offlineGrossRevenue: number;
  grossRevenue: number;
  onlineNetRevenue: number;
  offlineNetRevenue: number;

  // Returns / Deductions
  onlineReturns: number;
  offlineReturns: number;
  totalReturns: number;

  // Net Revenue
  netRevenue: number;

  // Cost & Profit (Simple Normal Business Definitions)
  onlineCogs: number;
  offlineCogs: number;
  totalCogs: number;
  myCost: number;
  totalProfit: number;
  grossProfit: number;
  netProfit: number;

  // Transaction counts
  validOnlineOrdersCount: number;
  validPosSalesCount: number;
  totalTransactionsCount: number;
  returnsCount: number;

  // Items / Units
  onlineUnitsSold: number;
  posUnitsSold: number;
  totalUnitsSold: number;
  totalUnitsReturned: number;

  // Averages & Outstanding
  avgOrderValue: number;
  grossAvgOrderValue: number;
  cashOutstanding: number;
  pendingCodCount: number;
  totalCatalogValue: number;
  totalCatalogCost: number;
  stockValuation: StockValuationResult;

  // Canonical Store Credit & Exchange Business Metrics
  totalSales: number;
  grossSales: number;
  netSales: number;
  returnsExchangeCredit: number;
  returnedItemsCount: number;
  storeCreditIssued: number;
  storeCreditUsedInSales: number;
  storeCreditOutstanding: number;
}

/**
 * Filter predicate to identify valid online orders (excludes cancelled, failed, refunded)
 */
export function isValidOnlineOrder(o: ReportOrder): boolean {
  if (!o) return false;
  const s = (o.status || "").toLowerCase().trim();
  if (s === "cancelled" || s === "returned" || s === "refunded") return false;
  const ps = (o.payment_status || "").toLowerCase().trim();
  if (ps === "failed" || ps === "refunded") return false;
  const rs = (((o as unknown as Record<string, unknown>).return_status as string) || "").toUpperCase().trim();
  if (rs === "COMPLETED" || rs === "REFUNDED") return false;
  return true;
}

/**
 * Filter predicate to identify valid POS sales (excludes cancelled/voided sales and uncommitted failures)
 */
export function isValidPOSSale(s: ReportPOSSale): boolean {
  if (!s) return false;
  if (s.status === "cancelled" || s.status === "voided" || s.is_voided === true) return false;
  if (s.notes && s.notes.startsWith("[VOIDED]")) return false;
  if (s.status === "sync_failed" || s.status === "FAILED_REQUIRES_ACTION" || s.status === "failed")
    return false;
  const isCompleted =
    s.status === "completed" ||
    (s as any).transaction_status === "COMPLETED" ||
    (s as any).sync_status === "SYNCED";
  return Boolean(isCompleted);
}

export {
  useReportingDateRange,
  calculateCanonicalISTBounds,
  istToUtcMs,
  parseDateParts,
  formatToISTDate,
  type CanonicalDateBounds,
} from "./reporting-date-range";

export type DatePreset = "today" | "yesterday" | "7d" | "30d" | "this_month" | "all" | "custom";

export interface ISTPeriodBounds {
  dateRangeText: string;
  compareLabel: string;
  startMs: number;
  endMs: number;
  endMsExclusive: number;
  prevStartMs: number;
  prevEndMs: number;
  prevEndMsExclusive: number;
  inCurrentPeriod: (dateStr: string | null | undefined) => boolean;
  inPrevPeriod: (dateStr: string | null | undefined) => boolean;
}

export const IST_OFFSET_MS = 330 * 60 * 1000; // 5 hours 30 minutes in ms

import { calculateCanonicalISTBounds } from "./reporting-date-range";

/**
 * Returns canonical IST boundaries (startMs and endMs in UTC timestamp milliseconds)
 * with strict inclusive start (00:00:00.000 IST) and exclusive end (00:00:00.000 IST next day).
 */
export function getISTPeriodBounds(
  datePreset: DatePreset = "7d",
  now: Date = new Date(),
  startDate?: string,
  endDate?: string,
): ISTPeriodBounds {
  return calculateCanonicalISTBounds({
    preset: datePreset,
    startDate,
    endDate,
    referenceNow: now,
  });
}

/**
 * Filter predicate to identify valid processed customer returns
 */
export function isValidReturn(r: ReportReturn): boolean {
  return r.status !== "cancelled" && r.refund_status !== "cancelled";
}

/**
 * Resolve buying price of a product for COGS computation
 */
export function getProductBuyingPrice(product?: ReportProduct | any): number {
  if (!product) return 0;
  if (product.buyingPrice !== undefined && product.buyingPrice !== null && Number(product.buyingPrice) > 0) {
    return Number(product.buyingPrice);
  }
  if (product.buying_price !== undefined && product.buying_price !== null && Number(product.buying_price) > 0) {
    return Number(product.buying_price);
  }
  if (product.cost_price !== undefined && product.cost_price !== null && Number(product.cost_price) > 0) {
    return Number(product.cost_price);
  }
  if (product.product_costs) {
    const costs = product.product_costs;
    if (Array.isArray(costs) && costs.length > 0) {
      const val = Number(costs[0]?.buying_price ?? (costs[0] as any)?.cost_price ?? 0);
      if (val > 0) return val;
    } else if (typeof costs === "object") {
      const val = Number((costs as any)?.buying_price ?? (costs as any)?.cost_price ?? 0);
      if (val > 0) return val;
    }
  }
  return 0;
}

/**
 * Master Financial Metric Calculator
 */
export function calculateFinancialMetrics({
  orders = [],
  posSales = [],
  returns = [],
  products = [],
  filterDate,
}: {
  orders?: ReportOrder[];
  posSales?: ReportPOSSale[];
  returns?: ReportReturn[];
  products?: ReportProduct[];
  filterDate?: (dateStr: string | null | undefined) => boolean;
}): FinancialMetrics {
  const isInPeriod = filterDate || (() => true);

  // 1. Filter authoritative valid populations for current period
  const validOrders = orders.filter((o) => isValidOnlineOrder(o) && isInPeriod(o.created_at));
  const validPos = posSales.filter((s) => isValidPOSSale(s) && isInPeriod(s.created_at));
  const validReturns = returns.filter((r) => isValidReturn(r) && isInPeriod(r.created_at));

  // 2. Gross revenues
  const onlineGrossRevenue = validOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const offlineGrossRevenue = validPos.reduce((sum, s) => sum + Number(s.total || 0), 0);
  const grossRevenue = onlineGrossRevenue + offlineGrossRevenue;

  // 3. Returns & Refunds
  const offlineReturns = validReturns.reduce((sum, r) => sum + Number(r.refund_amount || 0), 0);
  const onlineReturns = 0;
  const totalReturns = offlineReturns + onlineReturns;

  // 4. Net Revenue
  const netRevenue = Math.max(0, grossRevenue - totalReturns);
  const offlineNetRevenue = Math.max(0, offlineGrossRevenue - offlineReturns);
  const onlineNetRevenue = Math.max(0, onlineGrossRevenue - onlineReturns);

  // 5. Units Sold & Historical Cost of Goods Sold (My Cost)
  // CRITICAL MANDATE: Never use current catalog cost for past transactions.
  // Historical line items store their immutable cost snapshot (cost_price / buying_price) at time of sale.
  let onlineUnitsSold = 0;
  let onlineCogs = 0;
  validOrders.forEach((o) => {
    o.order_items?.forEach((item) => {
      const qty = Number(item.qty || item.quantity || 1);
      onlineUnitsSold += qty;

      const prod = products.find(
        (p) =>
          (item.product_id && (p.id === item.product_id || p.slug === item.product_id)) ||
          (item.product_slug && (p.slug === item.product_slug || p.id === item.product_slug)) ||
          (item.name && p.name && p.name.trim().toLowerCase() === item.name.trim().toLowerCase()),
      );
      const historicalBp = Number(
        item.cost_price ??
        item.buying_price ??
        item.buyingPrice ??
        0,
      );
      const bp = historicalBp > 0 ? historicalBp : getProductBuyingPrice(prod);
      onlineCogs += bp * qty;
    });
  });

  let posUnitsSold = 0;
  let offlineCogs = 0;
  let itemLevelReturnedCogs = 0;

  validPos.forEach((s) => {
    // If entire sale was returned, skip all items from active sold count and cost
    const retStatus = (s.return_status || "").toLowerCase().trim();
    if (retStatus === "returned" || retStatus === "fully_returned" || retStatus === "completed") return;

    s.offline_sale_items?.forEach((item) => {
      const qty = Number(item.qty || item.quantity || 1);
      const retQty = Number(
        item.quantity_returned ||
        item.returned_quantity ||
        (item.return_status === "RETURNED" || item.return_status === "returned" ? qty : 0),
      );
      const netQty = Math.max(0, qty - retQty);

      const prod = products.find(
        (p) =>
          (item.product_id && (p.id === item.product_id || p.slug === item.product_id)) ||
          (item.product_slug && (p.slug === item.product_slug || p.id === item.product_slug)) ||
          (item.name && p.name && p.name.trim().toLowerCase() === item.name.trim().toLowerCase()),
      );
      const historicalBp = Number(
        item.cost_price ??
        item.buying_price ??
        item.buyingPrice ??
        0,
      );
      const bp = historicalBp > 0 ? historicalBp : getProductBuyingPrice(prod);

      if (retQty > 0) {
        itemLevelReturnedCogs += bp * Math.min(qty, retQty);
      }

      if (netQty <= 0) return; // Completely returned product: remove from units sold & My Cost!

      posUnitsSold += netQty;
      offlineCogs += bp * netQty;
    });
  });

  let totalUnitsReturned = 0;
  let returnRecordsCogs = 0;
  validReturns.forEach((r) => {
    r.offline_return_items?.forEach((item) => {
      const retQty = Number(item.qty || item.quantity || 1);
      totalUnitsReturned += retQty;

      const p = products.find(
        (prod) =>
          (item.product_id && (prod.id === item.product_id || prod.slug === item.product_id)) ||
          (item.product_slug && (prod.slug === item.product_slug || prod.id === item.product_slug)) ||
          (item.name && prod.name && prod.name.trim().toLowerCase() === item.name.trim().toLowerCase()),
      );
      const historicalBp = Number(
        (item as any).cost_price ??
        (item as any).buying_price ??
        (item as any).buyingPrice ??
        0,
      );
      const bp = historicalBp > 0 ? historicalBp : getProductBuyingPrice(p);
      returnRecordsCogs += bp * retQty;
    });
  });

  // If there are unlinked returns whose items weren't deducted at sale level, deduct them now
  if (returnRecordsCogs > itemLevelReturnedCogs) {
    const unlinkedReturnCogs = returnRecordsCogs - itemLevelReturnedCogs;
    offlineCogs = Math.max(0, offlineCogs - unlinkedReturnCogs);
  }

  const totalUnitsSold = onlineUnitsSold + posUnitsSold;
  const totalCogs = onlineCogs + offlineCogs;

  // 6. Simple Normal Business Profit & Cost: Total Profit = Net Sales (Total Sales) - My Cost
  const myCost = totalCogs;
  const totalProfit = Math.max(0, netRevenue - totalCogs);
  const grossProfit = totalProfit;
  const netProfit = totalProfit;

  // 7. Counts & Averages
  const validOnlineOrdersCount = validOrders.length;
  const validPosSalesCount = validPos.length;
  const totalTransactionsCount = validOnlineOrdersCount + validPosSalesCount;
  const returnsCount = validReturns.length;

  const avgOrderValue = totalTransactionsCount > 0 ? netRevenue / totalTransactionsCount : 0;
  const grossAvgOrderValue = totalTransactionsCount > 0 ? grossRevenue / totalTransactionsCount : 0;

  // 8. Cash outstanding (unpaid online COD orders in period)
  const pendingCodOrders = orders.filter(
    (o) =>
      isInPeriod(o.created_at) &&
      o.status !== "cancelled" &&
      o.payment_status !== "paid" &&
      (o.payment_method === "cod" || o.payment_status === "pending"),
  );
  const cashOutstanding = pendingCodOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);

  // 9. Total catalog valuation (Authoritative Shared Valuation Engine)
  const stockValuation = calculateStockValuation(products as unknown as StockValuationItem[], {
    onlyActive: true,
  });
  const totalCatalogValue = stockValuation.retailValue;
  const totalCatalogCost = stockValuation.costValue;

  // 10. Canonical Store Credit & Exchange Metrics
  // Note: When products are returned, totalSales on dashboard decreases by the returned amount (Net Sales).
  const grossSales = grossRevenue;
  const totalSales = netRevenue; // Net Sales: Gross Sales minus Returns
  const netSales = netRevenue;
  const returnsExchangeCredit = totalReturns;
  const returnedItemsCount = totalUnitsReturned;
  const storeCreditIssued = offlineReturns;
  const storeCreditUsedInSales = validPos.reduce(
    (sum, s) => sum + Number(s.store_credit_used || 0),
    0,
  );
  const storeCreditOutstanding = Math.max(0, storeCreditIssued - storeCreditUsedInSales);

  return {
    onlineGrossRevenue,
    offlineGrossRevenue,
    grossRevenue,
    onlineNetRevenue,
    offlineNetRevenue,
    onlineReturns,
    offlineReturns,
    totalReturns,
    netRevenue,
    onlineCogs,
    offlineCogs,
    totalCogs,
    myCost,
    totalProfit,
    grossProfit,
    netProfit,
    validOnlineOrdersCount,
    validPosSalesCount,
    totalTransactionsCount,
    returnsCount,
    onlineUnitsSold,
    posUnitsSold,
    totalUnitsSold,
    totalUnitsReturned,
    avgOrderValue,
    grossAvgOrderValue,
    cashOutstanding,
    pendingCodCount: pendingCodOrders.length,
    totalCatalogValue,
    totalCatalogCost,
    stockValuation,
    totalSales,
    grossSales,
    netSales,
    returnsExchangeCredit,
    returnedItemsCount,
    storeCreditIssued,
    storeCreditUsedInSales,
    storeCreditOutstanding,
  };
}

export interface StockValuationItem {
  id?: string;
  uuid?: string;
  name?: string;
  sku?: string | null;
  stock?: number | null;
  price?: number | null;
  selling_price?: number | null;
  mrp?: number | null;
  buyingPrice?: number | null;
  buying_price?: number | null;
  product_costs?: { buying_price?: number | null } | Array<{ buying_price?: number | null }> | null;
  is_active?: boolean | null;
  isActive?: boolean | null;
  low_stock_at?: number | null;
  lowStockAt?: number | null;
}

export interface StockValuationResult {
  totalUnits: number;
  retailValue: number; // Stock Quantity × Selling Price (Potential Sales Value)
  costValue: number; // Stock Quantity × Buying Cost (Store Investment / Asset Cost)
  mrpValue: number; // Stock Quantity × MRP
  potentialProfit: number; // Math.max(0, retailValue - costValue)
  potentialMarginPct: number; // ((retailValue - costValue) / retailValue) * 100
  lowStockCount: number;
  outOfStockCount: number;
  inStockCount: number;
  totalProductsCount: number;
  activeCatalogCount: number;
}

const roundMoney = (val: number): number => Math.round((val + Number.EPSILON) * 100) / 100;

/**
 * Authoritative Canonical Stock Valuation Engine.
 * Shared across Products Page, Inventory Page, Dashboard, and Reports.
 * Explicitly separates:
 * 1. Retail Value: stock × selling_price (potential retail revenue)
 * 2. Store Cost: stock × buying_price (inventory store investment / asset)
 * 3. MRP Value: stock × mrp
 */
export function calculateStockValuation(
  items: StockValuationItem[],
  options?: { lowStockThreshold?: number; onlyActive?: boolean },
): StockValuationResult {
  let totalUnits = 0;
  let retailValue = 0;
  let costValue = 0;
  let mrpValue = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let inStockCount = 0;
  let activeCatalogCount = 0;

  const defaultLowThreshold = options?.lowStockThreshold ?? 5;

  (items || []).forEach((item) => {
    const isActive = item.isActive ?? item.is_active ?? true;
    if (options?.onlyActive && !isActive) return;

    activeCatalogCount++;
    const stock = Math.max(0, Number(item.stock || 0));
    const price = Math.max(0, Number(item.price ?? item.selling_price ?? 0));
    const mrp = Math.max(0, Number(item.mrp ?? price));

    // Resolve buying price from item.buyingPrice, item.buying_price, or item.product_costs
    let buyingPrice = 0;
    if (item.buyingPrice !== undefined && item.buyingPrice !== null) {
      buyingPrice = Number(item.buyingPrice);
    } else if (item.buying_price !== undefined && item.buying_price !== null) {
      buyingPrice = Number(item.buying_price);
    } else if (item.product_costs) {
      if (Array.isArray(item.product_costs) && item.product_costs.length > 0) {
        buyingPrice = Number(item.product_costs[0]?.buying_price || 0);
      } else if (typeof item.product_costs === "object" && "buying_price" in item.product_costs) {
        buyingPrice = Number(item.product_costs.buying_price || 0);
      }
    }

    const lowAt = item.lowStockAt ?? item.low_stock_at ?? defaultLowThreshold;

    totalUnits += stock;
    retailValue += roundMoney(stock * price);
    costValue += roundMoney(stock * buyingPrice);
    mrpValue += roundMoney(stock * mrp);

    if (stock === 0) {
      outOfStockCount++;
    } else {
      inStockCount++;
      if (stock <= lowAt) {
        lowStockCount++;
      }
    }
  });

  const potentialProfit = Math.max(0, retailValue - costValue);
  const potentialMarginPct = retailValue > 0 ? (potentialProfit / retailValue) * 100 : 0;

  return {
    totalUnits,
    retailValue: roundMoney(retailValue),
    costValue: roundMoney(costValue),
    mrpValue: roundMoney(mrpValue),
    potentialProfit: roundMoney(potentialProfit),
    potentialMarginPct: Number(potentialMarginPct.toFixed(1)),
    lowStockCount,
    outOfStockCount,
    inStockCount,
    totalProductsCount: items?.length || 0,
    activeCatalogCount,
  };
}
