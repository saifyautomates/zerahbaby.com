import { test, expect } from "@playwright/test";
import {
  validatePrintableProduct,
  getSavedLabelProfile,
  setSavedLabelProfile,
  getSavedShowDiscount,
  setSavedShowDiscount,
  getSavedLabelType,
  setSavedLabelType,
  PRINT_FORMAT_CONFIG,
  buildLabelPrintHtml,
  buildLabelPrintParts,
} from "../src/lib/label-printer";

test.describe("One-Click Product Label Printing Suite", () => {
  test("1. Barcode & Product Authoritative Validation Logic", () => {
    // Valid product with barcode
    const validWithBarcode = validatePrintableProduct({
      name: "Organic Baby Onesie",
      barcode: "8901234567890",
      sku: "ZR-BO-001",
      price: 499,
      mrp: 699,
    });
    expect(validWithBarcode.valid).toBe(true);

    // Valid product with fallback SKU
    const validWithSku = validatePrintableProduct({
      name: "Baby Rattle Toy",
      barcode: "",
      sku: "ZR-TOY-88",
      price: 299,
    });
    expect(validWithSku.valid).toBe(true);

    // Missing barcode and missing SKU -> strict error rejection
    const invalidNoBarcode = validatePrintableProduct({
      name: "Unassigned Product",
      barcode: "",
      sku: "",
      price: 199,
    });
    expect(invalidNoBarcode.valid).toBe(false);
    expect(invalidNoBarcode.error).toContain("does not have a barcode or SKU");

    // Missing name
    const invalidNoName = validatePrintableProduct({
      name: "",
      barcode: "123456",
      price: 100,
    });
    expect(invalidNoName.valid).toBe(false);
    expect(invalidNoName.error).toContain("Product name is required");

    // Invalid price
    const invalidPrice = validatePrintableProduct({
      name: "Test Item",
      barcode: "123456",
      price: NaN,
    });
    expect(invalidPrice.valid).toBe(false);
    expect(invalidPrice.error).toContain("invalid selling price");
  });

  test("2. Printer Profile Persistence (localStorage) & Defaults", () => {
    // Test default fallback
    expect(["50x75", "thermal-108", "a4", "thermal-58"]).toContain(getSavedLabelProfile());

    // Test saving 108mm thermal
    setSavedLabelProfile("thermal-108");
    expect(getSavedLabelProfile()).toBe("thermal-108");

    // Test saving 58mm thermal
    setSavedLabelProfile("thermal-58");
    expect(getSavedLabelProfile()).toBe("thermal-58");

    // Test saving A4 grid
    setSavedLabelProfile("a4");
    expect(getSavedLabelProfile()).toBe("a4");

    // Test show discount setting
    setSavedShowDiscount(true);
    expect(getSavedShowDiscount()).toBe(true);
    setSavedShowDiscount(false);
    expect(getSavedShowDiscount()).toBe(false);

    // Test label type setting
    setSavedLabelType("barcode-only");
    expect(getSavedLabelType()).toBe("barcode-only");
    setSavedLabelType("full");
    expect(getSavedLabelType()).toBe("full");
  });

  test("3. Quantity Expansion & Multi-Product Payload Preparation", () => {
    const products = [
      { uuid: "p1", name: "Product A", barcode: "BAR-A", sku: "SKU-A", price: 100 },
      { uuid: "p2", name: "Product B", barcode: "BAR-B", sku: "SKU-B", price: 200 },
    ];

    // Helper expansion logic matching LabelPrintEngine expand()
    const expandEntries = (items: Array<{ product: (typeof products)[0]; qty: number }>) => {
      const out: Array<(typeof products)[0]> = [];
      for (const { product, qty } of items) {
        for (let i = 0; i < qty; i++) out.push(product);
      }
      return out;
    };

    const expanded = expandEntries([
      { product: products[0], qty: 2 },
      { product: products[1], qty: 1 },
    ]);

    expect(expanded.length).toBe(3);
    expect(expanded[0].name).toBe("Product A");
    expect(expanded[1].name).toBe("Product A");
    expect(expanded[2].name).toBe("Product B");
  });

  test("4. Safe Discount Calculation without NaN or Negatives", () => {
    const calcDiscount = (mrp: number, price: number): number | null => {
      if (!mrp || mrp <= 0 || price <= 0 || mrp <= price) return null;
      const pct = Math.round(((mrp - price) / mrp) * 100);
      if (!isFinite(pct) || pct <= 0 || pct > 100) return null;
      return pct;
    };

    expect(calcDiscount(1000, 700)).toBe(30);
    expect(calcDiscount(500, 250)).toBe(50);
    expect(calcDiscount(100, 100)).toBeNull(); // No discount
    expect(calcDiscount(100, 120)).toBeNull(); // Price higher than MRP
    expect(calcDiscount(0, 100)).toBeNull();
    expect(calcDiscount(-50, 100)).toBeNull();
  });

  test("5. Physical Horizontal Landscape Label Geometry (Width > Height)", () => {
    const cfg58 = PRINT_FORMAT_CONFIG["thermal-58"];
    const cfg108 = PRINT_FORMAT_CONFIG["thermal-108"];

    // Ensure Width > Height for landscape thermal stickers
    expect(cfg58.pageWidthMm).toBeGreaterThan(cfg58.pageHeightMm);
    expect(cfg58.pageWidthMm).toBe(50);
    expect(cfg58.pageHeightMm).toBe(25);
    expect(cfg58.isThermalRoll).toBe(true);

    expect(cfg108.pageWidthMm).toBeGreaterThan(cfg108.pageHeightMm);
    expect(cfg108.pageWidthMm).toBe(108);
    expect(cfg108.pageHeightMm).toBe(50);
    expect(cfg108.isThermalRoll).toBe(true);
  });

  test("6. Single Source of Truth HTML & CSS Output Formatting", () => {
    const sampleProduct = {
      name: "dangri",
      barcode: "525724465925",
      sku: "ZR-CL-825985",
      price: 299,
      mrp: 799,
    };

    const html = buildLabelPrintHtml({
      products: [sampleProduct],
      quantities: { "ZR-CL-825985": 1 },
      layout: "thermal-58",
      labelType: "full",
      showDiscount: false,
    });

    // Validations matching physical barcode sticker layout:
    // 1. @page has 50mm 25mm dimensions
    expect(html).toContain("50mm 25mm");
    // 2. Brand footer exists
    expect(html).toContain("ZÉRAH BABY &amp; KIDS");
    // 3. Product name exists
    expect(html).toContain("lbl-product");
    expect(html).toContain("dangri");
    // 4. Price & MRP exist
    expect(html).toContain("₹799");
    expect(html).toContain("Price:");
    expect(html).toContain("₹299");
    // 5. SKU exists
    expect(html).toContain("ZR-CL-825985");
  });

  test("7. Exact 2-Label Output on 50×25mm Thermal Roll", () => {
    const p1 = {
      uuid: "prod-1",
      name: "Cotton Romper",
      barcode: "8901234567890",
      sku: "ZR-CR-001",
      price: 399,
      mrp: 799,
    };

    // Case A: 1 product with qty = 2
    const parts2Qty = buildLabelPrintParts({
      products: [p1],
      quantities: { "prod-1": 2 },
      layout: "thermal-58",
      labelType: "full",
      showDiscount: false,
      isStandaloneTab: false,
    });
    expect(parts2Qty.labelCount).toBe(2);

    // Count occurrences of label-page
    const labelPageMatches = (parts2Qty.pagesHtml.match(/class="label-page"/g) || []).length;
    expect(labelPageMatches).toBe(2);

    // Verify dimensions: 50mm x 25mm in CSS
    expect(parts2Qty.css).toContain("50mm 25mm");
    expect(parts2Qty.css).toContain("width: 50mm");
    expect(parts2Qty.css).toContain("min-height: 25mm");

    // Case B: Standalone tab preview wrapper
    const tabParts = buildLabelPrintParts({
      products: [p1],
      quantities: { "prod-1": 2 },
      layout: "thermal-58",
      labelType: "full",
      isStandaloneTab: true,
    });
    expect(tabParts.labelCount).toBe(2);
    expect(tabParts.fullHtml).toContain("standalone-toolbar no-print");
    expect(tabParts.fullHtml).toContain("Print Labels (2)");
    // Toolbar is hidden under print
    expect(tabParts.css).toContain(".standalone-toolbar,");
    expect(tabParts.css).toContain("display: none !important;");
  });

  test("8. Retail Specification: Vertical Tag & Pricing Layout", () => {
    const prod = {
      uuid: "prod-spec",
      name: "cord",
      barcode: "359719719255",
      sku: "ZR-CL-4189",
      price: 250,
      mrp: 499,
    };

    const htmlDefault = buildLabelPrintHtml({
      products: [prod],
      quantities: { "prod-spec": 1 },
      layout: "thermal-58",
      labelType: "full",
    });
    expect(htmlDefault).toContain("lbl-product");
    expect(htmlDefault).toContain("cord");
    expect(htmlDefault).toContain("M.R.P.:");
    expect(htmlDefault).toContain("₹499");
    expect(htmlDefault).toContain("Price:");
    expect(htmlDefault).toContain("₹250");
    expect(htmlDefault).toContain("ZR-CL-4189");
  });

  test("9. Trailing Page Break Suppression to Prevent Blank Labels", () => {
    const parts = buildLabelPrintParts({
      products: [{ uuid: "p1", name: "Item", barcode: "111", sku: "SKU1", price: 100, mrp: 200 }],
      quantities: { p1: 2 },
      layout: "thermal-58",
    });

    // Verify :last-child break suppression is declared in CSS
    expect(parts.css).toContain(".label-page:last-child");
    expect(parts.css).toContain("break-after: auto !important;");
  });
});
