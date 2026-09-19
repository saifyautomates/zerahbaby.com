/**
 * POS SALES HISTORY & RETURN EXCLUSION SPEC
 *
 * Requirements:
 * 1. Returned products must NOT show in Sales History (they belong in Return History).
 * 2. Fully returned sales (return_status === "returned" or all items returned) must NOT appear in the Sales History table.
 * 3. Partially returned sales must only display remaining active unreturned items and quantities in Sales History.
 * 4. Sales count and tab numbers (e.g. All, Cash, UPI, Card) must only count active unreturned sales.
 */
import { test, expect } from "@playwright/test";
import { isValidPOSSale } from "../src/lib/financial-reporting";

// Recreate the pure filter functions from OfflineAnalyticsTab for deterministic testing
function isSaleFullyReturned(s: {
  return_status?: string | null;
  offline_sale_items?: Array<{
    qty?: number;
    quantity?: number;
    quantity_sold?: number;
    quantity_returned?: number;
    returned_quantity?: number;
    return_status?: string | null;
  }> | null;
}): boolean {
  if (s.return_status === "returned") return true;
  const items = s.offline_sale_items;
  if (!items || items.length === 0) return false;
  return items.every((item) => {
    const sold = Number(item.quantity_sold ?? item.qty ?? item.quantity ?? 1);
    const ret = Number(
      item.quantity_returned ??
        item.returned_quantity ??
        (item.return_status === "RETURNED" || item.return_status === "returned" ? sold : 0),
    );
    return sold - ret <= 0;
  });
}

function getActiveSaleItems<T extends {
  name: string;
  qty?: number;
  price: number;
  subtotal?: number;
  quantity?: number;
  quantity_sold?: number;
  quantity_returned?: number;
  returned_quantity?: number;
  return_status?: string | null;
}>(sale: { offline_sale_items?: T[] | null }): T[] {
  return (sale.offline_sale_items ?? [])
    .map((item) => {
      const sold = Number(item.quantity_sold ?? item.qty ?? item.quantity ?? 1);
      const ret = Number(
        item.quantity_returned ??
          item.returned_quantity ??
          (item.return_status === "RETURNED" || item.return_status === "returned" ? sold : 0),
      );
      const activeQty = Math.max(0, sold - ret);
      if (activeQty <= 0) return null;
      if (activeQty === sold) return item;
      const unitPrice = (item.qty && item.qty > 0 && item.subtotal) ? Number(item.subtotal) / item.qty : Number(item.price);
      return {
        ...item,
        qty: activeQty,
        subtotal: unitPrice * activeQty,
      };
    })
    .filter((it): it is T => it !== null);
}

test.describe("POS Sales History — Return Segregation & Display Rules", () => {
  const dataset = [
    {
      id: "sale-token-4",
      pos_token_number: 4,
      sale_number: "POS-260919-19228",
      created_at: "2026-09-20T01:11:45.000Z",
      customer_name: "saif",
      customer_phone: "917014098198",
      total: 560,
      payment_method: "cash",
      status: "completed",
      return_status: null,
      offline_sale_items: [
        {
          name: "Baby Girls Top",
          price: 700,
          qty: 1,
          subtotal: 700,
          quantity_sold: 1,
          quantity_returned: 0,
        },
      ],
    },
    {
      id: "sale-token-3",
      pos_token_number: 3,
      sale_number: "POS-260919-98423",
      created_at: "2026-09-20T01:09:47.000Z",
      customer_name: "saif",
      customer_phone: "917014098198",
      total: 750,
      payment_method: "cash",
      status: "completed",
      return_status: "returned", // 100% returned sale
      offline_sale_items: [
        {
          name: "Kids Denim Shirt",
          price: 750,
          qty: 1,
          subtotal: 750,
          quantity_sold: 1,
          quantity_returned: 1,
          returned_quantity: 1,
        },
      ],
    },
    {
      id: "sale-partial",
      pos_token_number: 5,
      sale_number: "POS-260919-33445",
      created_at: "2026-09-20T01:15:00.000Z",
      customer_name: "rahul",
      customer_phone: "9876543210",
      total: 1450,
      payment_method: "upi",
      status: "completed",
      return_status: "partially_returned",
      offline_sale_items: [
        {
          name: "Kids T-Shirt",
          price: 500,
          qty: 1,
          subtotal: 500,
          quantity_sold: 1,
          quantity_returned: 1, // Completely returned item in a partial sale
          returned_quantity: 1,
        },
        {
          name: "Baby Romper",
          price: 950,
          qty: 2,
          subtotal: 1900,
          quantity_sold: 2,
          quantity_returned: 1, // 1 of 2 returned
          returned_quantity: 1,
        },
      ],
    },
  ];

  test("1. Fully returned sale (Token 3) is detected as fully returned", () => {
    const sale3 = dataset.find((s) => s.id === "sale-token-3")!;
    expect(isSaleFullyReturned(sale3)).toBe(true);
  });

  test("2. Active sale (Token 4) is NOT detected as returned", () => {
    const sale4 = dataset.find((s) => s.id === "sale-token-4")!;
    expect(isSaleFullyReturned(sale4)).toBe(false);
  });

  test("3. Active sales filtering strictly excludes returned sales", () => {
    const activeSales = dataset.filter((s) => isValidPOSSale(s as any) && !isSaleFullyReturned(s));
    expect(activeSales.length).toBe(2); // Token 4 and sale-partial
    expect(activeSales.some((s) => s.sale_number === "POS-260919-98423")).toBe(false);
  });

  test("4. getActiveSaleItems completely hides returned products from Items list", () => {
    // For Token 3 (returned): getActiveSaleItems returns empty array
    const sale3 = dataset.find((s) => s.id === "sale-token-3")!;
    const activeItems3 = getActiveSaleItems(sale3);
    expect(activeItems3.length).toBe(0);

    // For partially returned sale:
    // Kids T-Shirt was completely returned -> must NOT appear
    // Baby Romper had 1 returned out of 2 -> must appear with active qty = 1
    const partialSale = dataset.find((s) => s.id === "sale-partial")!;
    const activeItemsPartial = getActiveSaleItems(partialSale);
    expect(activeItemsPartial.length).toBe(1);
    expect(activeItemsPartial[0].name).toBe("Baby Romper");
    expect(activeItemsPartial[0].qty).toBe(1);
  });

  test("5. Cash sales count does not include returned cash sales", () => {
    // Both Token 4 and Token 3 were cash, but Token 3 was returned
    const activeSales = dataset.filter((s) => isValidPOSSale(s as any) && !isSaleFullyReturned(s));
    const cashSales = activeSales.filter((s) => s.payment_method === "cash");
    expect(cashSales.length).toBe(1);
    expect(cashSales[0].pos_token_number).toBe(4);
  });
});
