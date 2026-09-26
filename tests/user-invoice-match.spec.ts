import { test, expect } from "@playwright/test";
import { buildA4HTML, type A4InvoiceSale, type A4InvoiceItem } from "../src/components/admin/A4Invoice";
import * as path from "path";
import * as fs from "fs";

test("Render exact invoice from user screenshot", async ({ page }) => {
  const storeMock = {
    brandName: "ZÉRAH BABY & KIDS STORE",
    storeAddress: "In front of Hanumanji Temple, Atwal Nagar, Kota, Rajasthan",
    contactPhone: "9057074777",
    contactEmail: "hello@zerahkids.com",
    instagramUrl: "@zerahkids",
  };

  const exactSale: A4InvoiceSale = {
    sale_number: "POS-260926-35290",
    sale_date: new Date("2026-09-27T10:26:00+05:30"),
    customer_name: "saif",
    customer_phone: "+978268010126",
    payment_method: "cash",
    subtotal: 4.00,
    discount: 0,
    discount_type: "fixed",
    discount_value: 0,
    total: 4.20,
    status: "completed",
  };

  const exactItems: A4InvoiceItem[] = [
    {
      name: "saify",
      sku: "ZR-CL-4613",
      hsn_code: "3304",
      qty: 1,
      price: 1.00,
      gst_rate: 5,
    },
    {
      name: "saify 2",
      sku: "ZR-CL-5736",
      hsn_code: "3401",
      qty: 1,
      price: 3.00,
      gst_rate: 5,
    },
  ];

  const logoBase64 = `data:image/png;base64,${fs.readFileSync(path.resolve(process.cwd(), "public/logo.png")).toString("base64")}`;
  const html = buildA4HTML(exactSale, exactItems, storeMock as any).replace(/\/logo\.png/g, logoBase64);

  await page.setViewportSize({ width: 794, height: 1123 });
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await page.emulateMedia({ media: "print" });

  const screenshotPath = path.resolve(process.cwd(), "tests/artifacts/exact_user_invoice_match.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });

  console.log("Screenshot saved at:", screenshotPath);
  expect(fs.existsSync(screenshotPath)).toBe(true);
});
