import { test, expect } from "@playwright/test";
import {
  buildA4HTML,
  type A4InvoiceSale,
  type A4InvoiceItem,
} from "../src/components/admin/A4Invoice";
import { buildOrderA4HTML } from "../src/components/site/Invoice";
import {
  buildThermalHTML,
  type ThermalReceiptSale,
  type ThermalReceiptItem,
} from "../src/components/admin/ThermalReceipt";
import type { Order } from "../src/domain/models";
import * as path from "path";
import * as fs from "fs";

test.describe("Standard Portrait A4 Invoice & Thermal Receipt Verification Suite", () => {
  const storeMock = {
    brandName: "ZÉRAH BABY & KIDS",
    storeAddress: "Shop No. 4-E-21, 80Ft. Road, Atwal Nagar, Hanumanji Mandir Ke Samne, Kota, Rajasthan 324001",
    contactPhone: "9057074777",
    contactEmail: "hello@zerahkids.com",
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

  test("1. A4 POS Invoice HTML contains standard @page A4 portrait and clean 210mm max-width", () => {
    const html = buildA4HTML(sampleSale, sampleItems, storeMock as any);
    expect(html).toContain("size: A4 portrait;");
    expect(html).toContain("margin: 15mm 12mm 15mm 12mm;");
    expect(html).toContain("max-width: 210mm;");
    expect(html).toContain("ZÉRAH BABY &amp; KIDS");
    expect(html).toContain("POS-2026-0042");
  });

  test("2. Online Order Invoice HTML contains standard @page A4 portrait and clean 210mm max-width", () => {
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
    expect(html).toContain("size: A4 portrait;");
    expect(html).toContain("margin: 15mm 12mm 15mm 12mm;");
    expect(html).toContain("max-width: 210mm;");
    expect(html).toContain("INV-ONL-2026-0089");
    expect(html).toContain("Rahul Verma");
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

  test("4. Browser Print Preview: A4 POS Invoice renders in portrait cleanly", async ({
    page,
    browserName,
  }) => {
    const html = buildA4HTML(sampleSale, sampleItems, storeMock as any).replace(
      /\/logo\.png/g,
      logoBase64,
    );

    // Set viewport to standard A4 Portrait pixel equivalent at 96 DPI (210mm ≈ 794px, 297mm ≈ 1123px)
    await page.setViewportSize({ width: 794, height: 1123 });
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.emulateMedia({ media: "print" });

    // Verify header, items table, and footer are visible
    await expect(page.locator(".header")).toBeVisible();
    await expect(page.locator("table")).toBeVisible();
    await expect(page.locator(".totals")).toBeVisible();
    await expect(page.locator(".footer")).toBeVisible();

    // Check no horizontal overflow
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalScroll).toBe(false);

    // Capture screenshot of print preview
    const screenshotDir = path.resolve(process.cwd(), "tests/artifacts");
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({
      path: path.join(screenshotDir, "a4_invoice_portrait_preview.png"),
      fullPage: true,
    });

    // Generate real PDF to verify portrait rendering (Chromium only)
    if (browserName === "chromium") {
      const pdfBuffer = await page.pdf({
        format: "A4",
        landscape: false,
        printBackground: true,
        margin: { top: "15mm", right: "12mm", bottom: "15mm", left: "12mm" },
      });
      expect(pdfBuffer.length).toBeGreaterThan(1000);
    }
  });

  test("5. Browser Print Preview: Online Order Invoice renders in portrait", async ({
    page,
    browserName,
  }) => {
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

    await page.setViewportSize({ width: 794, height: 1123 });
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.emulateMedia({ media: "print" });

    await expect(page.locator(".header")).toBeVisible();
    await expect(page.locator("table")).toBeVisible();
    await expect(page.locator(".totals")).toBeVisible();
    await expect(page.locator(".footer")).toBeVisible();

    const screenshotDir = path.resolve(process.cwd(), "tests/artifacts");
    await page.screenshot({
      path: path.join(screenshotDir, "online_invoice_portrait_preview.png"),
      fullPage: true,
    });
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
    await page.screenshot({
      path: path.join(screenshotDir, "thermal_receipt_preview.png"),
      fullPage: true,
    });
  });
});
