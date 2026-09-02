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
  buying_price?: number;
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
  product_slug?: string;
  name?: string;
  sku?: string;
  qty?: number;
  quantity?: number;
  price?: number;
  subtotal?: number;
  buying_price?: number;
}

export interface ReportPOSSale {
  id: string;
  sale_number?: string;
  created_at: string;
  status?: string;
  payment_method?: string;
  total?: number;
  subtotal?: number;
  discount?: number;
  offline_sale_items?: ReportPOSItem[];
  customer_name?: string;
  customer_phone?: string;
  store_credit_used?: number | null;
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
  if (o.status === "cancelled") return false;
  if (o.payment_status === "failed" || o.payment_status === "refunded") return false;
  return true;
}

/**
 * Filter predicate to identify valid POS sales (excludes cancelled/voided sales)
 */
export function isValidPOSSale(s: ReportPOSSale): boolean {
  return s.status !== "cancelled" && s.status !== "voided";
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
export function getProductBuyingPrice(product?: ReportProduct): number {
  if (!product?.product_costs) return 0;
  const costs = product.product_costs;
  if (Array.isArray(costs)) {
    return Number(costs[0]?.buying_price || 0);
  }
  return Number((costs as ReportItemCost)?.buying_price || 0);
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

  // 5. Units Sold & Historical Cost of Goods Sold (My Cost)
  // CRITICAL MANDATE: Never use current catalog cost for past transactions.
  // Historical line items store their immutable buying_price snapshot at time of sale.
  let onlineUnitsSold = 0;
  let onlineCogs = 0;
  validOrders.forEach((o) => {
    o.order_items?.forEach((item) => {
      const qty = Number(item.qty || item.quantity || 1);
      onlineUnitsSold += qty;

      const historicalBp = Number(item.buying_price || 0);
      const bp =
        historicalBp > 0
          ? historicalBp
          : getProductBuyingPrice(
              products.find(
                (prod) => prod.slug === item.product_slug || prod.id === item.product_id,
              ),
            );
      onlineCogs += bp * qty;
    });
  });

  let posUnitsSold = 0;
  let offlineCogs = 0;
  validPos.forEach((s) => {
    s.offline_sale_items?.forEach((item) => {
      const qty = Number(item.qty || item.quantity || 1);
      posUnitsSold += qty;

      const historicalBp = Number(item.buying_price || 0);
      const bp =
        historicalBp > 0
          ? historicalBp
          : getProductBuyingPrice(
              products.find(
                (prod) => prod.id === item.product_id || prod.slug === item.product_slug,
              ),
            );
      offlineCogs += bp * qty;
    });
  });

  let totalUnitsReturned = 0;
  validReturns.forEach((r) => {
    r.offline_return_items?.forEach((item) => {
      totalUnitsReturned += Number(item.qty || item.quantity || 1);
    });
  });

  const totalUnitsSold = onlineUnitsSold + posUnitsSold;
  const totalCogs = onlineCogs + offlineCogs;

  // 6. Simple Normal Business Profit & Cost: Total Profit = Total Sales - My Cost
  const myCost = totalCogs;
  const totalProfit = grossRevenue - totalCogs;
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

  // 9. Total catalog value
  const totalCatalogValue = products.reduce(
    (sum, p) => sum + Number(p.price || 0) * Number(p.stock || 0),
    0,
  );

  // 10. Canonical Store Credit & Exchange Metrics
  // Note: Normal POS returns issue 100% exchange store credit vouchers.
  // Store credit used in sales is a settlement/tender method, NEVER deducted twice from revenue!
  const grossSales = grossRevenue;
  const totalSales = grossRevenue;
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
