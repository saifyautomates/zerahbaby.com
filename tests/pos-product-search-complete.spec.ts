import { test, expect } from "@playwright/test";
import { searchPOSProducts } from "../src/lib/pos-search";

test.describe("POS Product & SKU Search Complete Suite", () => {
  test("1. Server-side POS Search Engine — Exact, Fuzzy Typo, SKU, Variant Attribute, Barcode", async () => {
    // 1A. Typo / pg_trgm fuzzy matching: 'tshirt' must match product 'tshirrt'
    const tshirtResults = await searchPOSProducts("tshirt", 10);
    expect(tshirtResults.length).toBeGreaterThan(0);
    const tshirtMatch = tshirtResults.find((p) => p.name.toLowerCase().includes("tshir"));
    expect(tshirtMatch).toBeDefined();
    expect(tshirtMatch?.variants.length).toBeGreaterThanOrEqual(1);

    // 1B. Partial name search: 'shirt' must match 'tshirrt'
    const shirtResults = await searchPOSProducts("shirt", 10);
    expect(shirtResults.length).toBeGreaterThan(0);
    expect(shirtResults.some((p) => p.name.toLowerCase().includes("tshir"))).toBe(true);

    // 1C. Case-insensitive search: 'TSHIRT' must match
    const upperResults = await searchPOSProducts("TSHIRT", 10);
    expect(upperResults.length).toBeGreaterThan(0);
    expect(upperResults.some((p) => p.name.toLowerCase().includes("tshir"))).toBe(true);

    // 1D. SKU search: 'ZR-GN-5007'
    const skuResults = await searchPOSProducts("ZR-GN-5007", 10);
    expect(skuResults.length).toBeGreaterThan(0);
    expect(skuResults[0].sku.toLowerCase()).toBe("zr-gn-5007");

    // 1E. Variant attribute search: 'purple'
    const variantResults = await searchPOSProducts("purple", 10);
    expect(variantResults.length).toBeGreaterThan(0);
    const hasPurple = variantResults.some(
      (p) =>
        p.variants.some(
          (v) => v.color?.toLowerCase() === "purple" || v.name.toLowerCase() === "purple",
        ) || p.name.toLowerCase().includes("purple"),
    );
    expect(hasPurple).toBe(true);

    // 1F. Barcode search: '490948373904'
    const barcodeResults = await searchPOSProducts("490948373904", 5);
    expect(barcodeResults.length).toBeGreaterThan(0);
    expect(barcodeResults[0].match_score).toBe(100);

    // 1G. Non-existent query handles cleanly
    const emptyResults = await searchPOSProducts("nonexistentrandomqueryxyz987", 5);
    expect(emptyResults.length).toBe(0);
  });
});
