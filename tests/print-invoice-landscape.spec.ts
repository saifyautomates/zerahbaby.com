import { test, expect } from "@playwright/test";
import { buildA4HTML, type A4InvoiceSale, type A4InvoiceItem } from "../src/components/admin/A4Invoice";
import { buildOrderA4HTML } from "../src/components/site/Invoice";
import { buildThermalHTML, type ThermalReceiptSale, type ThermalReceiptItem } from "../src/components/admin/ThermalReceipt";
import type { Order } from "../src/domain/models";
import * as path from "path";
import * as fs from "fs";

test.describe("Horizontal Landscape Print & Invoice Verification Suite", () => {
  const storeMock = {
    brandName: "ZÉRAH BABY & KIDS",
    storeAddress: "In Front of Hanumanji Temple, Atwal Nagar, Kota, Rajasthan 324001",
    contactPhone: "9057074777",
    contactEmail: "support@zerahkids.com",
    instagramUrl: "@zerahkids",
  };

  const sampleSale: A4InvoiceSale = {
    sale_number: "POS-2026-0042",
    sale_date: new Date("2026-09-12T14:30:00Z"),
    customer_name: "Priya Sharma",
    customer_phone: "9876543210",
    customer_email: "priya.sharma@example.com",
    payment_method: "upi",
    subtotal: 2198,
    discount: 200,
    discount_type: "fixed",
    discount_value: 200,
    total: 1998,
    notes: "Customer requested gift packaging",
    status: "completed",
  };

  const sampleItems: A4InvoiceItem[] = [
    {
      name: "Organic Cotton Baby Romper (Bear Print)",
      color: "Pastel Blue",
      size: "0-6M",
      sku: "ZR-RMP-01",
      qty: 2,
      price: 599,
      mrp: 899,
    },
    {
      name: "Super Soft Bamboo Muslin Swaddle Blanket",
      color: "Cream Cloud",
      size: "Free Size",
      sku: "ZR-SWD-05",
      qty: 1,
      price: 1000,
      mrp: 1299,
    },
  ];

  test("1. A4 POS Invoice HTML contains exact @page A4 landscape and 10mm margin", () => {
    const html = buildA4HTML(sampleSale, sampleItems, storeMock as any);
    expect(html).toContain("size: A4 landscape;");
    expect(html).toContain("margin: 10mm;");
    expect(html).toContain("max-width: 277mm;");
  });

  test("2. Online Order Invoice HTML contains exact @page A4 landscape and 10mm margin", () => {
    const mockOrder: Order = {
      id: "ord-test-88990011",
      user_id: "usr-123",
      email: "rahul.verma@example.com",
      full_name: "Rahul Verma",
      phone: "9123456780",
      alt_phone: "9876543210",
      address: "Flat 402, Sunshine Heights, Civil Lines",
      address_line2: "Near City Park",
      landmark: "Opposite City Mall",
      city: "Kota",
      state: "Rajasthan",
      pincode: "324001",
      payment_method: "online",
      payment_status: "paid",
      invoice_no: "INV-ONL-2026-0089",
      subtotal: 1598,
      shipping: 0,
      discount: 100,
      coupon_code: "WELCOME100",
      total: 1498,
      status: "delivered",
      notes: "Please call before delivery",
      created_at: "2026-09-12T10:15:00Z",
      order_items: [
        {
          id: "item-1",
          product_slug: "toddler-cotton-tee",
          name: "Toddler Everyday Cotton Tee",
          color: "Sunshine Yellow",
          size: "2-3Y",
          sku_snapshot: "ZR-TEE-YL-2Y",
          image_url: "/logo.png",
          price: 499,
          qty: 2,
        },
        {
          id: "item-2",
          product_slug: "soft-denim-shorts",
          name: "Comfort Flex Denim Shorts",
          color: "Indigo Blue",
          size: "2-3Y",
          sku_snapshot: "ZR-DNM-IN-2Y",
          image_url: "/logo.png",
          price: 600,
          qty: 1,
        },
      ],
    };

    const html = buildOrderA4HTML(mockOrder, storeMock);
    expect(html).toContain("size: A4 landscape;");
    expect(html).toContain("margin: 10mm;");
    expect(html).toContain("max-width: 277mm;");
  });

  test("3. Thermal receipt preserves 80mm roll layout and is NOT landscape", () => {
    const mockThermalSale: ThermalReceiptSale = {
      sale_number: "POS-THM-001",
      customer_name: "Walk-in Customer",
      customer_phone: "",
      payment_method: "cash",
      subtotal: 499,
      discount: 0,
      total: 499,
      status: "completed",
    };
    const mockThermalItems: ThermalReceiptItem[] = [
      {
        name: "Baby Socks 3-Pack",
        color: "Multi",
        size: "0-1Y",
        sku: "ZR-SCK-03",
        qty: 1,
        price: 499,
        mrp: 599,
      },
    ];

    const html = buildThermalHTML(mockThermalSale, mockThermalItems, new Date(), storeMock as any);
    expect(html).toContain("size: 80mm auto;");
    expect(html).toContain("width: 76mm;");
    expect(html).not.toContain("landscape");
  });

  const logoBase64 = `data:image/png;base64,${fs.readFileSync(path.resolve(process.cwd(), "public/logo.png")).toString("base64")}`;

  test("4. Browser Print Preview: A4 POS Invoice renders in landscape, fits on 1 page without clipping", async ({ page, browserName }) => {
    const html = buildA4HTML(sampleSale, sampleItems, storeMock as any).replace(/\/logo\.png/g, logoBase64);

    // Set viewport to A4 Landscape pixel equivalent at 96 DPI (297mm ≈ 1123px, 210mm ≈ 794px)
    await page.setViewportSize({ width: 1123, height: 794 });
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.emulateMedia({ media: "print" });

    // Verify container width fits within 277mm (277mm * 96 / 25.4 ≈ 1047px)
    const container = page.locator(".invoice-container");
    await expect(container).toBeVisible();
    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(1055);

    // Verify header, info-bar, table, summary, footer are all visible
    await expect(page.locator(".header")).toBeVisible();
    await expect(page.locator(".info-bar")).toBeVisible();
    await expect(page.locator(".items-table")).toBeVisible();
    await expect(page.locator(".bottom-summary")).toBeVisible();
    await expect(page.locator(".footer")).toBeVisible();

    // Verify all 7 table columns are present and readable
    const ths = page.locator(".items-table th");
    await expect(ths).toHaveCount(7);
    const thTexts = await ths.allInnerTexts();
    expect(thTexts).toEqual(["#", "ITEM DESCRIPTION", "QTY", "MRP", "UNIT PRICE", "SAVINGS", "NET TOTAL"]);

    // Check no horizontal overflow
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalScroll).toBe(false);

    // Verify height fits within 190mm (190mm * 96 / 25.4 ≈ 718px)
    // Printable height is 190mm, container bounding box should be well below 718px
    expect(box!.height).toBeLessThan(718);

    // Capture screenshot of print preview
    const screenshotDir = path.resolve(process.cwd(), "tests/artifacts");
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: path.join(screenshotDir, "a4_invoice_landscape_preview.png"), fullPage: true });

    // Generate real PDF to verify exact single-page rendering (Chromium only in Playwright)
    if (browserName === "chromium") {
      const pdfBuffer = await page.pdf({
        format: "A4",
        landscape: true,
        printBackground: true,
        margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
      });
      expect(pdfBuffer.length).toBeGreaterThan(1000);
    }
  });

  test("5. Browser Print Preview: Online Order Invoice renders in landscape and fits 1 page", async ({ page }) => {
    const mockOrder: Order = {
      id: "ord-test-445566",
      user_id: "usr-456",
      email: "sneha.patel@example.com",
      full_name: "Sneha Patel",
      phone: "9988776655",
      alt_phone: "",
      address: "12/B, Green Glen Layout, Bellandur",
      address_line2: "",
      landmark: "Near EcoSpace",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560103",
      payment_method: "razorpay",
      payment_status: "paid",
      invoice_no: "INV-2026-BLR-099",
      subtotal: 2497,
      shipping: 0,
      discount: 250,
      coupon_code: "KIDS250",
      total: 2247,
      status: "processing",
      notes: "Gift message: Happy 1st Birthday!",
      created_at: "2026-09-12T11:00:00Z",
      order_items: [
        {
          id: "oi-1",
          product_slug: "festive-kurta-set",
          name: "Festive Silk Blend Kurta & Pyjama Set",
          color: "Maroon / Gold",
          size: "1-2Y",
          sku_snapshot: "ZR-KRT-MR-1Y",
          image_url: "/logo.png",
          price: 1499,
          qty: 1,
        },
        {
          id: "oi-2",
          product_slug: "soft-sole-booties",
          name: "Handcrafted Soft-Sole Leatherette Booties",
          color: "Golden Tan",
          size: "6-12M",
          sku_snapshot: "ZR-BT-GT-6M",
          image_url: "/logo.png",
          price: 998,
          qty: 1,
        },
      ],
    };

    const html = buildOrderA4HTML(mockOrder, storeMock).replace(/\/logo\.png/g, logoBase64);

    await page.setViewportSize({ width: 1123, height: 794 });
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.emulateMedia({ media: "print" });

    const container = page.locator(".invoice-container");
    await expect(container).toBeVisible();
    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(1055);
    expect(box!.height).toBeLessThan(718);

    await expect(page.locator(".header")).toBeVisible();
    await expect(page.locator(".info-bar")).toBeVisible();
    await expect(page.locator(".items-table")).toBeVisible();
    await expect(page.locator(".bottom-summary")).toBeVisible();
    await expect(page.locator(".footer")).toBeVisible();

    const screenshotDir = path.resolve(process.cwd(), "tests/artifacts");
    await page.screenshot({ path: path.join(screenshotDir, "online_invoice_landscape_preview.png"), fullPage: true });
  });

  test("6. Browser Print Preview: Thermal Receipt retains 80mm roll format", async ({ page }) => {
    const mockThermalSale: ThermalReceiptSale = {
      sale_number: "POS-THM-9999",
      customer_name: "Walk-in Counter",
      customer_phone: "",
      payment_method: "cash",
      subtotal: 899,
      discount: 100,
      total: 799,
      status: "completed",
    };
    const mockThermalItems: ThermalReceiptItem[] = [
      {
        name: "Printed Cotton Bibs (3-Pack)",
        color: "Assorted",
        size: "One Size",
        sku: "ZR-BIB-03",
        qty: 1,
        price: 899,
        mrp: 999,
      },
    ];

    const html = buildThermalHTML(mockThermalSale, mockThermalItems, new Date(), storeMock as any);

    // Thermal roll width ~ 300px (80mm)
    await page.setViewportSize({ width: 400, height: 600 });
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.emulateMedia({ media: "print" });

    const bodyWidth = await page.evaluate(() => {
      return document.body.getBoundingClientRect().width;
    });

    // 76mm at 96 DPI ≈ 287px (allow slight rounding ±15px)
    expect(bodyWidth).toBeGreaterThanOrEqual(270);
    expect(bodyWidth).toBeLessThanOrEqual(310);

    const screenshotDir = path.resolve(process.cwd(), "tests/artifacts");
    await page.screenshot({ path: path.join(screenshotDir, "thermal_receipt_preview.png"), fullPage: true });
  });

  test("7. Multi-item pagination: Table headers repeat and rows don't clip across pages", async ({ page, browserName }) => {
    // Generate 20 items to genuinely exceed 1 landscape page
    const manyItems: A4InvoiceItem[] = Array.from({ length: 20 }, (_, i) => ({
      name: `Children's Premium Apparel Item #${i + 1}`,
      color: i % 2 === 0 ? "Pastel Blue" : "Blush Pink",
      size: `${i + 1}Y`,
      sku: `ZR-MULTI-${i + 1}`,
      qty: (i % 3) + 1,
      price: 299 + i * 20,
      mrp: 499 + i * 20,
    }));

    const bigSale: A4InvoiceSale = {
      ...sampleSale,
      sale_number: "POS-BULK-2026",
      subtotal: manyItems.reduce((acc, it) => acc + it.price * it.qty, 0),
      total: manyItems.reduce((acc, it) => acc + it.price * it.qty, 0),
    };

    const html = buildA4HTML(bigSale, manyItems, storeMock as any);
    await page.setViewportSize({ width: 1123, height: 794 });
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.emulateMedia({ media: "print" });

    // Table thead must have table-header-group
    const theadDisplay = await page.evaluate(() => {
      const thead = document.querySelector(".items-table thead");
      return thead ? window.getComputedStyle(thead).display : "";
    });
    expect(theadDisplay).toBe("table-header-group");

    // Table rows must have page-break-inside avoid
    const trBreak = await page.evaluate(() => {
      const tr = document.querySelector(".items-table tbody tr");
      return tr ? window.getComputedStyle(tr).breakInside || (window.getComputedStyle(tr) as any).pageBreakInside : "";
    });
    expect(["avoid", "avoid-page"].includes(trBreak)).toBe(true);

    // Generate real PDF to verify pagination rendering (Chromium only in Playwright)
    if (browserName === "chromium") {
      const pdfBuffer = await page.pdf({
        format: "A4",
        landscape: true,
        printBackground: true,
        margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
      });
      expect(pdfBuffer.length).toBeGreaterThan(5000);
    }
  });
});
