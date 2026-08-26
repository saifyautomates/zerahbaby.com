import { test, expect } from "@playwright/test";

test.describe("Admin Products Management & FirstCry Catalog", () => {
  test("Catalog seed has 100 products with 10 stock each", async () => {
    const { FIRSTCRY_100_PRODUCTS } = await import("../src/lib/firstcry-catalog");
    expect(FIRSTCRY_100_PRODUCTS.length).toBe(100);

    // Check all products have stock = 10
    for (const prod of FIRSTCRY_100_PRODUCTS) {
      expect(prod.stock).toBe(10);
      expect(prod.price).toBeGreaterThan(0);
      expect(prod.mrp).toBeGreaterThanOrEqual(prod.price);
      expect(prod.sku).toBeTruthy();
      expect(prod.barcode).toBeTruthy();
      expect(prod.name).toBeTruthy();
      expect(prod.category).toBeTruthy();
    }
  });

  test("Catalog covers all 8 essential categories", async () => {
    const { FIRSTCRY_100_PRODUCTS, FIRSTCRY_CATEGORIES } =
      await import("../src/lib/firstcry-catalog");
    expect(FIRSTCRY_CATEGORIES.length).toBe(8);

    const categories = new Set(FIRSTCRY_100_PRODUCTS.map((p) => p.category));
    expect(categories.has("clothing")).toBe(true);
    expect(categories.has("toys")).toBe(true);
    expect(categories.has("care")).toBe(true);
    expect(categories.has("gear")).toBe(true);
    expect(categories.has("feeding")).toBe(true);
    expect(categories.has("diapering")).toBe(true);
    expect(categories.has("bath")).toBe(true);
    expect(categories.has("footwear")).toBe(true);
  });
});
