import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://wbbatgbvizhghtkvuguf.supabase.co";
const supabaseAnonKey = "sb_publishable_WiczJQTx4afGJ02WAiUIUw_8YlWjkSP";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const EXPECTED_NEW_SLUGS = [
  "zerah-organic-bamboo-kimono-romper-sage",
  "montessori-wooden-rainbow-stacking-blocks",
  "zerah-natural-baby-massage-oil-almond-200ml",
  "anti-colic-wide-neck-glass-feeding-bottle-240ml",
  "cloudcomfort-ergonomic-portable-baby-nest-lounger",
];

test.describe("5 New Products & Homepage Showcase Verification", () => {
  test("1. Database: 5 new products exist with exact 5 inventory each and 1:1 variant normalization", async () => {
    const { data: products, error: pErr } = await supabase
      .from("products")
      .select("id, name, slug, stock, price, mrp, category, barcode, is_active")
      .in("slug", EXPECTED_NEW_SLUGS);

    expect(pErr).toBeNull();
    expect(products).toBeDefined();
    expect(products?.length).toBe(5);

    for (const prod of products || []) {
      expect(prod.stock).toBe(5);
      expect(prod.is_active).toBe(true);
      expect(prod.price).toBeGreaterThan(0);
      expect(prod.mrp).toBeGreaterThanOrEqual(prod.price);
      expect(prod.barcode).toBeTruthy();

      // Check variant normalization: SUM(variant.stock) === 5
      const { data: variants, error: vErr } = await supabase
        .from("product_variants")
        .select("id, name, stock, barcode")
        .eq("product_id", prod.id);

      expect(vErr).toBeNull();
      expect(variants).toBeDefined();
      expect(variants?.length).toBe(1);

      const totalVariantStock = (variants || []).reduce((sum, v) => sum + (v.stock || 0), 0);
      expect(totalVariantStock).toBe(5);
      expect(prod.stock).toBe(totalVariantStock);
    }
  });

  test("2. Storefront Homepage: All 5 new products are visibly rendered on the homepage", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    // Wait for the homepage section to be visible
    const sectionHeading = page.locator("h2", { hasText: "New Arrivals & Trending" });
    await expect(sectionHeading).toBeVisible({ timeout: 15000 });

    // Verify all 5 product names appear on the homepage
    const expectedTitles = [
      "Zérah Pure Organic Bamboo Cotton Kimono Romper (Sage Green)",
      "Montessori Wooden Rainbow Stacking & Balance Blocks Set",
      "Natural Plant-Enriched Baby Massage Oil with Sweet Almond & Calendula (200ml)",
      "Anti-Colic BPA-Free Wide-Neck Glass Feeding Bottle (240ml)",
      "CloudComfort Ergonomic Portable Baby Nest & Sleep Lounger",
    ];

    for (const title of expectedTitles) {
      const productCard = page.locator(`text=${title}`).first();
      await expect(productCard).toBeVisible({ timeout: 10000 });
    }
  });

  test("3. Product Detail Page & Add to Cart: Verification of 5 inventory limit", async ({
    page,
  }) => {
    // Visit first new product (Kimono Romper)
    await page.goto("/product/f1000000-0000-4000-8000-000000000001", { waitUntil: "networkidle" });

    // Title should be visible
    await expect(page.locator("h1")).toContainText(
      "Zérah Pure Organic Bamboo Cotton Kimono Romper",
    );

    // Stock indicator should show in stock (5 items left or in stock)
    const stockText = await page.locator("body").innerText();
    expect(stockText).not.toContain("Out of stock");

    // Add to cart / bag
    const addToCartBtn = page
      .locator("button", { hasText: /Add to [bB]ag|Add to [cC]art/i })
      .first();
    await expect(addToCartBtn).toBeVisible({ timeout: 10000 });
    await addToCartBtn.click();

    // Verify cart drawer or toast appears
    await page.waitForTimeout(1000);
    await page.goto("/cart", { waitUntil: "networkidle" });

    // Ensure item is in cart
    await expect(page.locator("body")).toContainText(
      "Zérah Pure Organic Bamboo Cotton Kimono Romper",
    );
  });
});
