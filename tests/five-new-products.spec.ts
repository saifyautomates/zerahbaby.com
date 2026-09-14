import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://wbbatgbvizhghtkvuguf.supabase.co";
const supabaseAnonKey = "sb_publishable_WiczJQTx4afGJ02WAiUIUw_8YlWjkSP";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

test.describe("Storefront Active Products & Homepage Showcase Verification", () => {
  test("1. Database: Active products exist with valid inventory and 1:1 variant normalization", async () => {
    const { data: products, error: pErr } = await supabase
      .from("products")
      .select("id, name, slug, stock, price, mrp, category, barcode, is_active")
      .eq("is_active", true);

    expect(pErr).toBeNull();
    expect(products).toBeDefined();
    expect(products?.length).toBeGreaterThan(0);

    for (const prod of products || []) {
      expect(prod.stock).toBeGreaterThan(0);
      expect(prod.is_active).toBe(true);
      expect(prod.price).toBeGreaterThan(0);
      expect(prod.mrp).toBeGreaterThanOrEqual(prod.price);

      // Check variant normalization: SUM(variant.stock) === prod.stock
      const { data: variants, error: vErr } = await supabase
        .from("product_variants")
        .select("id, name, stock, barcode")
        .eq("product_id", prod.id);

      expect(vErr).toBeNull();
      expect(variants).toBeDefined();
      expect(variants?.length).toBeGreaterThan(0);

      const totalVariantStock = (variants || []).reduce((sum, v) => sum + (v.stock || 0), 0);
      expect(prod.stock).toBe(totalVariantStock);
    }
  });

  test("2. Storefront Homepage: Active products are visibly rendered on the homepage", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    // Verify product card is visible on homepage
    const productCards = page.locator('a[href^="/product/"]');
    await expect(productCards.first()).toBeVisible({ timeout: 15000 });
  });

  test("3. Product Detail Page & Add to Cart: Verification of active product inventory", async ({
    page,
  }) => {
    // Fetch an active product
    const { data: products } = await supabase
      .from("products")
      .select("id, name, slug, stock")
      .eq("is_active", true)
      .limit(1);

    expect(products && products.length > 0).toBeTruthy();
    const targetProduct = products![0];

    // Visit product detail page
    await page.goto(`/product/${targetProduct.slug}`, { waitUntil: "networkidle" });

    // Title should be visible
    await expect(page.locator("h1")).toContainText(targetProduct.name);

    // Stock indicator should not say out of stock
    const stockText = await page.locator("body").innerText();
    expect(stockText).not.toContain("Out of stock");

    // Add to cart / bag
    const addToCartBtn = page
      .locator("button", { hasText: /Add to [bB]ag|Add to [cC]art/i })
      .first();
    await expect(addToCartBtn).toBeVisible({ timeout: 10000 });
    await addToCartBtn.click();

    // Verify cart page has the product
    await page.waitForTimeout(1000);
    await page.goto("/cart", { waitUntil: "networkidle" });
    await expect(page.locator("body")).toContainText(targetProduct.name);
  });
});
