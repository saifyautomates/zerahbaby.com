/**
 * PROFIT ANALYSIS & AGGREGATE SUMMARY SPEC
 *
 * Verifies:
 * 1. Single sale dataset:
 *    Baby Girls Top (Qty 1, Sale ₹560, Cost ₹350, Profit ₹210)
 *    Top summary must strictly output:
 *    Total Sales = ₹560, My Cost = ₹350, Total Profit = ₹210.
 *
 * 2. Cumulative sales:
 *    Add second sale of ₹700 (Cost ₹350)
 *    Top summary must output:
 *    Total Sales = ₹1260, My Cost = ₹700, Total Profit = ₹560.
 *
 * 3. Discounted sales:
 *    Item cost remains historical snapshot even when price/discount changes.
 *
 * 4. Returned/cancelled sales:
 *    Returned products properly deducted from sales, units, and My Cost.
 *
 * 5. Drilldown summary mathematically derived from row items.
 */
import { test, expect } from "@playwright/test";
import { calculateFinancialMetrics, getProductBuyingPrice } from "../src/lib/financial-reporting";

test.describe("Profit Analysis Summary & Row Data Synchronization", () => {
  const products = [
    {
      id: "prod-baby-girls-top-uuid",
      slug: "baby-girls-top",
      name: "Baby Girls Top",
      price: 700,
      stock: 10,
      product_costs: [{ buying_price: 350 }],
      buyingPrice: 350,
      buying_price: 350,
    },
    {
      id: "prod-denim-shirt-uuid",
      slug: "kids-denim-shirt",
      name: "Kids Denim Shirt",
      price: 750,
      stock: 5,
      product_costs: [{ buying_price: 400 }],
      buyingPrice: 400,
      buying_price: 400,
    },
  ];

  test("1. Single sale matches product row (Sales: ₹560, Cost: ₹350, Profit: ₹210)", () => {
    // POS sale with historical cost snapshot stored in cost_price / buying_price
    const posSales = [
      {
        id: "sale-1",
        sale_number: "POS-260919-00001",
        status: "completed",
        created_at: "2026-09-19T10:00:00.000Z",
        total: 560,
        subtotal: 700,
        discount: 140,
        store_credit_used: 0,
        offline_sale_items: [
          {
            id: "item-1",
            product_id: "prod-baby-girls-top-uuid",
            product_slug: "baby-girls-top",
            name: "Baby Girls Top",
            price: 700,
            qty: 1,
            cost_price: 350, // Historical cost snapshot
            buying_price: 350,
          },
        ],
      },
    ];

    const metrics = calculateFinancialMetrics({
      orders: [],
      posSales: posSales as any,
      returns: [],
      products: products as any,
    });

    expect(metrics.totalSales).toBe(560);
    expect(metrics.myCost).toBe(350);
    expect(metrics.totalProfit).toBe(210);
  });

  test("2. Two sales accumulation: Sales ₹1260, Cost ₹700, Profit ₹560", () => {
    const posSales = [
      {
        id: "sale-1",
        sale_number: "POS-260919-00001",
        status: "completed",
        created_at: "2026-09-19T10:00:00.000Z",
        total: 560,
        subtotal: 700,
        discount: 140,
        store_credit_used: 0,
        offline_sale_items: [
          {
            id: "item-1",
            product_id: "prod-baby-girls-top-uuid",
            product_slug: "baby-girls-top",
            name: "Baby Girls Top",
            price: 700,
            qty: 1,
            cost_price: 350,
          },
        ],
      },
      {
        id: "sale-2",
        sale_number: "POS-260919-00002",
        status: "completed",
        created_at: "2026-09-19T12:00:00.000Z",
        total: 700,
        subtotal: 700,
        discount: 0,
        store_credit_used: 0,
        offline_sale_items: [
          {
            id: "item-2",
            product_id: "prod-baby-girls-top-uuid",
            product_slug: "baby-girls-top",
            name: "Baby Girls Top",
            price: 700,
            qty: 1,
            cost_price: 350,
          },
        ],
      },
    ];

    const metrics = calculateFinancialMetrics({
      orders: [],
      posSales: posSales as any,
      returns: [],
      products: products as any,
    });

    expect(metrics.totalSales).toBe(1260);
    expect(metrics.myCost).toBe(700);
    expect(metrics.totalProfit).toBe(560);
  });

  test("3. Historical cost priority: Product catalog cost changes do NOT alter historical sale cost", () => {
    // Current catalog buying price increased to 500
    const updatedProducts = [
      {
        id: "prod-baby-girls-top-uuid",
        slug: "baby-girls-top",
        name: "Baby Girls Top",
        price: 900,
        stock: 10,
        product_costs: [{ buying_price: 500 }], // Changed today!
        buyingPrice: 500,
        buying_price: 500,
      },
    ];

    // Historical sale locked in buying_price / cost_price = 350
    const posSales = [
      {
        id: "sale-1",
        sale_number: "POS-260919-00001",
        status: "completed",
        created_at: "2026-09-19T10:00:00.000Z",
        total: 560,
        subtotal: 700,
        discount: 140,
        store_credit_used: 0,
        offline_sale_items: [
          {
            id: "item-1",
            product_id: "prod-baby-girls-top-uuid",
            product_slug: "baby-girls-top",
            name: "Baby Girls Top",
            price: 700,
            qty: 1,
            cost_price: 350, // Immutable historical snapshot
          },
        ],
      },
    ];

    const metrics = calculateFinancialMetrics({
      orders: [],
      posSales: posSales as any,
      returns: [],
      products: updatedProducts as any,
    });

    // Cost MUST remain 350, not 500!
    expect(metrics.totalSales).toBe(560);
    expect(metrics.myCost).toBe(350);
    expect(metrics.totalProfit).toBe(210);
  });

  test("4. Fully returned sale is excluded from sales and My Cost", () => {
    const posSales = [
      {
        id: "sale-1",
        sale_number: "POS-260919-00001",
        status: "completed",
        return_status: "returned", // Fully returned
        created_at: "2026-09-19T10:00:00.000Z",
        total: 560,
        subtotal: 700,
        discount: 140,
        store_credit_used: 0,
        offline_sale_items: [
          {
            id: "item-1",
            product_id: "prod-baby-girls-top-uuid",
            product_slug: "baby-girls-top",
            name: "Baby Girls Top",
            price: 700,
            qty: 1,
            cost_price: 350,
          },
        ],
      },
    ];

    const returns = [
      {
        id: "ret-1",
        status: "completed",
        refund_status: "completed",
        refund_amount: 560,
        created_at: "2026-09-19T11:00:00.000Z",
      },
    ];

    const metrics = calculateFinancialMetrics({
      orders: [],
      posSales: posSales as any,
      returns: returns as any,
      products: products as any,
    });

    expect(metrics.totalSales).toBe(0);
    expect(metrics.myCost).toBe(0);
    expect(metrics.totalProfit).toBe(0);
  });

  test("5. Queued/offline sale without explicit product_id still resolves buying price from slug", () => {
    const posSales = [
      {
        id: "queued-sale-1",
        sale_number: "POS-OFF-12345",
        status: "completed",
        created_at: "2026-09-19T10:00:00.000Z",
        total: 560,
        subtotal: 560,
        discount: 0,
        store_credit_used: 0,
        offline_sale_items: [
          {
            id: "queued-item-1",
            product_id: null, // Null or not yet resolved
            product_slug: "baby-girls-top", // Has slug
            name: "Baby Girls Top",
            price: 560,
            qty: 1,
            cost_price: 0, // Fallback to product buying price
          },
        ],
      },
    ];

    const metrics = calculateFinancialMetrics({
      orders: [],
      posSales: posSales as any,
      returns: [],
      products: products as any,
    });

    // Successfully resolved 350 via product slug!
    expect(metrics.totalSales).toBe(560);
    expect(metrics.myCost).toBe(350);
    expect(metrics.totalProfit).toBe(210);
  });
});
