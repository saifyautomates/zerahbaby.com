/**
 * ZÉRAH BABY & KIDS — Universal Table Selection & Smart Metric Adapters
 * Provides stateful row selection and canonical in-memory aggregations for admin tables.
 */
import { useState, useMemo, useCallback } from "react";
import { roundMoney, roundCurrencyInt } from "./pricing-engine";
import { getProductBuyingPrice, type ReportProduct } from "./financial-reporting";
import type { Product } from "./store";
import type { Order } from "./orders";
import type { OfflineSale } from "./pos";
import type { Coupon } from "./coupons";

const formatPrice = (val: number): string =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(val);

export interface SummaryMetric {
  label: string;
  value: string | number;
  highlight?: "default" | "primary" | "success" | "warning" | "danger" | "brand";
  tooltip?: string;
  isCurrency?: boolean;
}

export interface UseTableSelectionOptions<T> {
  items: T[];
  getId?: (item: T) => string;
}

export interface TableSelectionResult<T> {
  selectedIds: Set<string>;
  selectedCount: number;
  selectedItems: T[];
  isSelected: (id: string) => boolean;
  toggle: (id: string, shiftKey?: boolean, currentIndex?: number) => void;
  selectMany: (ids: string[]) => void;
  deselectMany: (ids: string[]) => void;
  toggleAllVisible: (visibleItems: T[]) => void;
  selectAllFiltered: (allFilteredItems: T[]) => void;
  clearSelection: () => void;
  isAllVisibleSelected: (visibleItems: T[]) => boolean;
  isIndeterminate: (visibleItems: T[]) => boolean;
}

/**
 * Universal hook for table row selection with stable UUID tracking
 */
export function useTableSelection<T = any>({
  items,
  getId = (item: T) => String((item as Record<string, unknown>).id || (item as Record<string, unknown>).uuid || ""),
}: UseTableSelectionOptions<T>): TableSelectionResult<T> {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Derive selected items safely from current loaded dataset
  const selectedItems = useMemo(() => {
    if (selectedIds.size === 0) return [];
    return items.filter((item) => selectedIds.has(getId(item)));
  }, [items, selectedIds, getId]);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  const toggle = useCallback(
    (id: string) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    },
    [],
  );

  const selectMany = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const deselectMany = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const toggleAllVisible = useCallback(
    (visibleItems: T[]) => {
      const visibleIds = visibleItems.map(getId).filter(Boolean);
      if (visibleIds.length === 0) return;

      setSelectedIds((prev) => {
        const allSelected = visibleIds.every((id) => prev.has(id));
        const next = new Set(prev);
        if (allSelected) {
          visibleIds.forEach((id) => next.delete(id));
        } else {
          visibleIds.forEach((id) => next.add(id));
        }
        return next;
      });
    },
    [getId],
  );

  const selectAllFiltered = useCallback(
    (allFilteredItems: T[]) => {
      const allIds = allFilteredItems.map(getId).filter(Boolean);
      setSelectedIds(new Set(allIds));
    },
    [getId],
  );

  const isAllVisibleSelected = useCallback(
    (visibleItems: T[]) => {
      if (visibleItems.length === 0) return false;
      const visibleIds = visibleItems.map(getId).filter(Boolean);
      return visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    },
    [selectedIds, getId],
  );

  const isIndeterminate = useCallback(
    (visibleItems: T[]) => {
      if (visibleItems.length === 0) return false;
      const visibleIds = visibleItems.map(getId).filter(Boolean);
      const someSelected = visibleIds.some((id) => selectedIds.has(id));
      const allSelected = visibleIds.every((id) => selectedIds.has(id));
      return someSelected && !allSelected;
    },
    [selectedIds, getId],
  );

  return {
    selectedIds,
    selectedCount: selectedIds.size,
    selectedItems,
    isSelected,
    toggle,
    selectMany,
    deselectMany,
    toggleAllVisible,
    selectAllFiltered,
    clearSelection,
    isAllVisibleSelected,
    isIndeterminate,
  };
}

/* ========================================================================== */
/*  CANONICAL DOMAIN METRIC ADAPTERS                                          */
/* ========================================================================== */

/**
 * 1. Orders Selection Metrics Adapter
 */
export function getOrdersSelectionMetrics(
  selectedOrders: Order[],
  allProducts: Product[] = [],
): SummaryMetric[] {
  if (!selectedOrders || selectedOrders.length === 0) return [];

  let totalQty = 0;
  let grossTotal = 0;
  let totalDiscount = 0;
  let paidAmount = 0;
  let totalCogs = 0;

  selectedOrders.forEach((o) => {
    // 1. Order total (counted once per order)
    const orderTotal = Number(o.total || 0);
    const orderDiscount = Number(o.discount || 0);
    grossTotal += orderTotal;
    totalDiscount += orderDiscount;

    if (o.payment_status === "paid" || o.payment_method === "online_paid") {
      paidAmount += orderTotal;
    }

    // 2. Quantity & COGS from order items
    o.order_items?.forEach((item) => {
      const raw = item as { qty?: number; quantity?: number; product_slug?: string; product_id?: string };
      const qty = Number(raw.qty || raw.quantity || 1);
      totalQty += qty;

      const p = allProducts.find(
        (prod) => prod.id === raw.product_slug || prod.uuid === (raw.product_id || raw.product_slug),
      );
      const buyingPrice = getProductBuyingPrice(p as unknown as ReportProduct);
      totalCogs += buyingPrice * qty;
    });
  });

  const netRevenue = grossTotal;
  const netProfit = Math.max(0, netRevenue - totalCogs);

  const metrics: SummaryMetric[] = [
    { label: "Selected", value: selectedOrders.length, highlight: "default" },
    { label: "Items / Qty", value: totalQty, highlight: "default" },
    { label: "Gross Total", value: formatPrice(roundCurrencyInt(grossTotal)), highlight: "brand", isCurrency: true },
  ];

  if (totalDiscount > 0) {
    metrics.push({
      label: "Discount",
      value: formatPrice(roundCurrencyInt(totalDiscount)),
      highlight: "warning",
      isCurrency: true,
    });
  }

  metrics.push({
    label: "Paid",
    value: formatPrice(roundCurrencyInt(paidAmount)),
    highlight: "success",
    isCurrency: true,
  });

  if (totalCogs > 0) {
    metrics.push({
      label: "Est. Profit",
      value: formatPrice(roundCurrencyInt(netProfit)),
      highlight: "success",
      isCurrency: true,
      tooltip: "Net Revenue minus authoritative buying cost",
    });
  }

  return metrics;
}

/**
 * 2. Revenue / Transactions Selection Metrics Adapter
 */
export function getRevenueSelectionMetrics(
  selectedRows: Array<{
    id: string;
    total: number;
    subtotal?: number;
    discount?: number;
    source?: string;
    items_count?: number;
    status?: string;
    order_items?: Array<{ qty?: number; quantity?: number; product_id?: string; product_slug?: string }>;
    offline_sale_items?: Array<{ qty?: number; quantity?: number; product_id?: string; product_slug?: string }>;
  }>,
  allProducts: Product[] = [],
): SummaryMetric[] {
  if (!selectedRows || selectedRows.length === 0) return [];

  let totalQty = 0;
  let grossRevenue = 0;
  let totalDiscount = 0;
  let totalCogs = 0;

  selectedRows.forEach((row) => {
    const rowTotal = Number(row.total || 0);
    const rowDiscount = Number(row.discount || 0);
    grossRevenue += rowTotal;
    totalDiscount += rowDiscount;

    const items = row.order_items || row.offline_sale_items;
    if (items && items.length > 0) {
      items.forEach((item) => {
        const qty = Number(item.qty || item.quantity || 1);
        totalQty += qty;

        const p = allProducts.find(
          (prod) => prod.id === item.product_slug || prod.uuid === item.product_id,
        );
        const buyingPrice = getProductBuyingPrice(p as unknown as ReportProduct);
        totalCogs += buyingPrice * qty;
      });
    } else if (row.items_count) {
      totalQty += Number(row.items_count);
    } else {
      totalQty += 1;
    }
  });

  const netRevenue = grossRevenue;
  const netProfit = Math.max(0, netRevenue - totalCogs);

  const metrics: SummaryMetric[] = [
    { label: "Selected", value: selectedRows.length, highlight: "default" },
    { label: "Units Sold", value: totalQty, highlight: "default" },
    { label: "Gross Revenue", value: formatPrice(roundCurrencyInt(grossRevenue)), highlight: "brand", isCurrency: true },
  ];

  if (totalDiscount > 0) {
    metrics.push({
      label: "Discounts",
      value: formatPrice(roundCurrencyInt(totalDiscount)),
      highlight: "warning",
      isCurrency: true,
    });
  }

  metrics.push({
    label: "Net Revenue",
    value: formatPrice(roundCurrencyInt(netRevenue)),
    highlight: "brand",
    isCurrency: true,
  });

  if (totalCogs > 0) {
    metrics.push({
      label: "Net Profit",
      value: formatPrice(roundCurrencyInt(netProfit)),
      highlight: "success",
      isCurrency: true,
      tooltip: "Revenue minus COGS for selected transactions",
    });
  }

  return metrics;
}

/**
 * 3. POS Sales Selection Metrics Adapter
 */
export function getPOSSelectionMetrics(
  selectedSales: OfflineSale[],
  allProducts: Product[] = [],
): SummaryMetric[] {
  if (!selectedSales || selectedSales.length === 0) return [];

  let totalQty = 0;
  let subtotal = 0;
  let discount = 0;
  let total = 0;
  let totalCogs = 0;

  selectedSales.forEach((s) => {
    subtotal += Number(s.subtotal || 0);
    discount += Number(s.discount || 0);
    total += Number(s.total || 0);

    s.offline_sale_items?.forEach((item) => {
      const qty = Number(item.qty || 1);
      totalQty += qty;

      const p = allProducts.find(
        (prod) => prod.id === item.product_slug || prod.uuid === item.product_id,
      );
      const buyingPrice = getProductBuyingPrice(p as unknown as ReportProduct);
      totalCogs += buyingPrice * qty;
    });
  });

  const profit = Math.max(0, total - totalCogs);

  const metrics: SummaryMetric[] = [
    { label: "Selected", value: selectedSales.length, highlight: "default" },
    { label: "Items Sold", value: totalQty, highlight: "default" },
    { label: "Subtotal", value: formatPrice(roundCurrencyInt(subtotal)), highlight: "default", isCurrency: true },
  ];

  if (discount > 0) {
    metrics.push({
      label: "Discount",
      value: formatPrice(roundCurrencyInt(discount)),
      highlight: "warning",
      isCurrency: true,
    });
  }

  metrics.push({
    label: "Total Sales",
    value: formatPrice(roundCurrencyInt(total)),
    highlight: "brand",
    isCurrency: true,
  });

  if (totalCogs > 0) {
    metrics.push({
      label: "Gross Profit",
      value: formatPrice(roundCurrencyInt(profit)),
      highlight: "success",
      isCurrency: true,
    });
  }

  return metrics;
}

/**
 * 4. Returns Selection Metrics Adapter
 */
export function getReturnsSelectionMetrics(
  selectedReturns: Array<{
    id: string;
    refund_amount?: number;
    offline_return_items?: Array<{ qty?: number; quantity?: number; refund_price?: number; product_id?: string; product_slug?: string }>;
  }>,
  allProducts: Product[] = [],
): SummaryMetric[] {
  if (!selectedReturns || selectedReturns.length === 0) return [];

  let returnedUnits = 0;
  let totalRefund = 0;
  let totalCostRestocked = 0;

  selectedReturns.forEach((r) => {
    totalRefund += Number(r.refund_amount || 0);

    r.offline_return_items?.forEach((item) => {
      const qty = Number(item.qty || item.quantity || 1);
      returnedUnits += qty;

      const p = allProducts.find(
        (prod) => prod.id === item.product_slug || prod.uuid === item.product_id,
      );
      const buyingPrice = getProductBuyingPrice(p as unknown as ReportProduct);
      totalCostRestocked += buyingPrice * qty;
    });
  });

  const metrics: SummaryMetric[] = [
    { label: "Selected", value: selectedReturns.length, highlight: "default" },
    { label: "Returned Units", value: returnedUnits, highlight: "default" },
    { label: "Total Refund", value: formatPrice(roundCurrencyInt(totalRefund)), highlight: "danger", isCurrency: true },
  ];

  if (totalCostRestocked > 0) {
    metrics.push({
      label: "Restocked Cost",
      value: formatPrice(roundCurrencyInt(totalCostRestocked)),
      highlight: "success",
      isCurrency: true,
      tooltip: "Total inventory buying cost restored into stock",
    });
  }

  return metrics;
}

/**
 * 5. Products Selection Metrics Adapter
 */
export function getProductsSelectionMetrics(selectedProducts: Product[]): SummaryMetric[] {
  if (!selectedProducts || selectedProducts.length === 0) return [];

  let totalStock = 0;
  let inventoryValue = 0;
  let potentialRevenue = 0;
  let totalCost = 0;
  let lowStockCount = 0;

  selectedProducts.forEach((p) => {
    const stock = Number(p.stock || 0);
    const price = Number(p.price || 0);
    const buyingPrice = getProductBuyingPrice(p as unknown as ReportProduct);

    totalStock += stock;
    inventoryValue += roundMoney(stock * price);
    potentialRevenue += roundMoney(stock * price);
    totalCost += roundMoney(stock * buyingPrice);

    if (stock <= 5 && stock > 0) {
      lowStockCount++;
    }
  });

  const potentialProfit = Math.max(0, potentialRevenue - totalCost);

  const metrics: SummaryMetric[] = [
    { label: "Selected", value: selectedProducts.length, highlight: "default" },
    { label: "Total Stock", value: totalStock, highlight: "default" },
    { label: "Stock Value", value: formatPrice(roundCurrencyInt(inventoryValue)), highlight: "brand", isCurrency: true },
  ];

  if (totalCost > 0) {
    metrics.push({
      label: "Potential Profit",
      value: formatPrice(roundCurrencyInt(potentialProfit)),
      highlight: "success",
      isCurrency: true,
      tooltip: "Potential profit if all current stock sells at listed price",
    });
  }

  if (lowStockCount > 0) {
    metrics.push({
      label: "Low Stock (≤5)",
      value: lowStockCount,
      highlight: "warning",
    });
  }

  return metrics;
}

/**
 * 6. Inventory Selection Metrics Adapter
 */
export function getInventorySelectionMetrics(
  selectedItems: Array<{
    id: string;
    stock: number;
    price?: number;
    selling_price?: number;
    name?: string;
  }>,
): SummaryMetric[] {
  if (!selectedItems || selectedItems.length === 0) return [];

  let totalStock = 0;
  let stockValue = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;

  selectedItems.forEach((item) => {
    const stock = Number(item.stock || 0);
    const price = Number(item.price || item.selling_price || 0);
    totalStock += stock;
    stockValue += roundMoney(stock * price);

    if (stock === 0) {
      outOfStockCount++;
    } else if (stock <= 5) {
      lowStockCount++;
    }
  });

  const metrics: SummaryMetric[] = [
    { label: "Selected", value: selectedItems.length, highlight: "default" },
    { label: "Stock Units", value: totalStock, highlight: "default" },
    { label: "Stock Value", value: formatPrice(roundCurrencyInt(stockValue)), highlight: "brand", isCurrency: true },
  ];

  if (lowStockCount > 0) {
    metrics.push({ label: "Low Stock Items", value: lowStockCount, highlight: "warning" });
  }

  if (outOfStockCount > 0) {
    metrics.push({ label: "Out of Stock", value: outOfStockCount, highlight: "danger" });
  }

  return metrics;
}

/**
 * 7. Customers Selection Metrics Adapter
 */
export function getCustomersSelectionMetrics(
  selectedCustomers: Array<{
    id: string;
    total_purchases?: number;
    total_orders?: number;
    total_spend?: number;
    total_spent?: number;
  }>,
): SummaryMetric[] {
  if (!selectedCustomers || selectedCustomers.length === 0) return [];

  let totalOrders = 0;
  let totalSpend = 0;

  selectedCustomers.forEach((c) => {
    totalOrders += Number(c.total_purchases || c.total_orders || 0);
    totalSpend += Number(c.total_spend || c.total_spent || 0);
  });

  return [
    { label: "Selected", value: selectedCustomers.length, highlight: "default" },
    { label: "Total Orders", value: totalOrders, highlight: "default" },
    { label: "Combined Spend", value: formatPrice(roundCurrencyInt(totalSpend)), highlight: "brand", isCurrency: true },
  ];
}

/**
 * 8. Coupons Selection Metrics Adapter
 */
export function getCouponsSelectionMetrics(selectedCoupons: Coupon[]): SummaryMetric[] {
  if (!selectedCoupons || selectedCoupons.length === 0) return [];

  let activeCount = 0;
  let totalUsage = 0;
  let totalMinOrder = 0;

  selectedCoupons.forEach((c) => {
    if (c.active) activeCount++;
    totalUsage += Number(c.usage_count || 0);
    totalMinOrder += Number(c.minimum_order_value || 0);
  });

  return [
    { label: "Selected", value: selectedCoupons.length, highlight: "default" },
    { label: "Active", value: activeCount, highlight: "success" },
    { label: "Total Uses", value: totalUsage, highlight: "default" },
    { label: "Min Order Sum", value: formatPrice(roundCurrencyInt(totalMinOrder)), highlight: "default", isCurrency: true },
  ];
}
