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
    expect(["thermal-108", "a4", "thermal-58"]).toContain(getSavedLabelProfile());

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
    expect(cfg108.pageWidthMm).toBe(100);
    expect(cfg108.pageHeightMm).toBe(25);
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

    // Validations:
    // 1. @page has exact 50mm 25mm dimensions
    expect(html).toContain("size: 50mm 25mm;");
    // 2. Brand header exists
    expect(html).toContain("ZÉRAH BABY &amp; KIDS");
    // 3. Product name exists
    expect(html).toContain("dangri");
    // 4. MRP exists clearly
    expect(html).toContain("MRP: ₹799");
    // 5. SKU exists
    expect(html).toContain("SKU: ZR-CL-825985");
    // 6. Barcode SVG exists
    expect(html).toContain("lbl-bc");
  });
});
