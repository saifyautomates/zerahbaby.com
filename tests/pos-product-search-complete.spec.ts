import { test, expect } from "@playwright/test";
import { searchPOSProducts } from "../src/lib/pos-search";
import { supabase } from "../src/integrations/supabase/client";

test.describe("POS Product & SKU Search Complete Suite", () => {
  test("1. Server-side POS Search Engine — Exact, Fuzzy Typo, SKU, Variant Attribute, Barcode", async () => {
    // Dynamically retrieve an active product and variant to ensure test stability against real database state
    const { data: prod } = await supabase
      .from("products")
      .select("*, product_variants(*)")
      .eq("is_active", true)
      .limit(1)
      .single();

    const productName = prod?.name || "TSHIRT";
    const productSku = prod?.sku || "ZR-CL-4719";
    const variant = prod?.product_variants?.[0];
    const barcode = variant?.barcode || prod?.barcode || "528400394295";

    // 1A. Typo / pg_trgm fuzzy matching: 'tshirt' must match product
    const tshirtResults = await searchPOSProducts("tshirt", 10);
    expect(tshirtResults.length).toBeGreaterThan(0);
    const tshirtMatch = tshirtResults.find((p) => p.name.toLowerCase().includes("tshir"));
    expect(tshirtMatch).toBeDefined();
    expect(tshirtMatch?.variants.length).toBeGreaterThanOrEqual(1);

    // 1B. Partial name search: 'shirt' must match
    const shirtResults = await searchPOSProducts("shirt", 10);
    expect(shirtResults.length).toBeGreaterThan(0);
    expect(shirtResults.some((p) => p.name.toLowerCase().includes("tshir"))).toBe(true);

    // 1C. Case-insensitive search: upper product name must match
    const upperResults = await searchPOSProducts(productName.toUpperCase(), 10);
    expect(upperResults.length).toBeGreaterThan(0);
    expect(
      upperResults.some((p) =>
        p.name.toLowerCase().includes(productName.toLowerCase().slice(0, 4)),
      ),
    ).toBe(true);

    // 1D. SKU search
    const skuResults = await searchPOSProducts(productSku, 10);
    expect(skuResults.length).toBeGreaterThan(0);
    expect(skuResults[0].sku.toLowerCase()).toBe(productSku.toLowerCase());

    // 1E. Variant / category / brand search
    const queryTerm = prod?.category || "clothing";
    const variantResults = await searchPOSProducts(queryTerm, 10);
    expect(variantResults.length).toBeGreaterThan(0);

    // 1F. Barcode search
    if (barcode) {
      const barcodeResults = await searchPOSProducts(barcode, 5);
      expect(barcodeResults.length).toBeGreaterThan(0);
      expect(barcodeResults[0].match_score).toBe(100);
    }

    // 1G. Non-existent query handles cleanly
    const emptyResults = await searchPOSProducts("nonexistentrandomqueryxyz987", 5);
    expect(emptyResults.length).toBe(0);
  });
});
