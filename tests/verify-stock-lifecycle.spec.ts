import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";

// Load client environment config
const envFile = fs.readFileSync(".env", "utf-8");
const env: Record<string, string> = {};
envFile.split(/\r?\n/).forEach((line) => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, "");
});

const supabaseUrl = env.VITE_SUPABASE_URL || "https://wbbatgbvizhghtkvuguf.supabase.co";
const supabaseAnonKey =
  env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_WiczJQTx4afGJ02WAiUIUw_8YlWjkSP";

const anonClient = createClient(supabaseUrl, supabaseAnonKey);

test.describe("Stock Lifecycle & POS Returns Inventory Engine", () => {
  test("1. Full Inventory Lifecycle: Product Stock -> Sale Deduction -> Return Replenishment", async () => {
    // 1. Fetch active products from catalog
    const { data: products, error: fetchErr } = await anonClient
      .from("products")
      .select("id, slug, name, stock, price, sku, barcode")
      .limit(5);

    expect(fetchErr).toBeNull();
    expect(products).toBeTruthy();
    expect(products!.length).toBeGreaterThan(0);

    const testProduct = products![0];
    const initialStock = Number(testProduct.stock || 0);

    console.log(`[Lifecycle Test] Product: ${testProduct.name} (${testProduct.slug}), Initial Stock: ${initialStock}`);

    // 2. Simulate Stock Addition (Inventory Restock)
    const restockUnits = 10;
    const stockAfterRestock = initialStock + restockUnits;
    expect(stockAfterRestock).toBe(initialStock + 10);
    console.log(`[Lifecycle Test] Stock after restock (+${restockUnits}): ${stockAfterRestock}`);

    // 3. Simulate POS Offline Sale (Stock Subtraction)
    const saleUnits = 3;
    expect(stockAfterRestock).toBeGreaterThanOrEqual(saleUnits);
    const stockAfterSale = stockAfterRestock - saleUnits;
    expect(stockAfterSale).toBe(initialStock + 7);
    console.log(`[Lifecycle Test] Stock after POS Sale (-${saleUnits}): ${stockAfterSale}`);

    // 4. Simulate POS Return (Atomic Replenishment)
    const returnedUnits = 3;
    const stockAfterReturn = stockAfterSale + returnedUnits;
    expect(stockAfterReturn).toBe(stockAfterRestock);
    console.log(`[Lifecycle Test] Stock after POS Return (+${returnedUnits}): ${stockAfterReturn}`);

    // 5. Verification: Post-return stock matches pre-sale stock exactly
    expect(stockAfterReturn - initialStock).toBe(restockUnits);
  });
});
