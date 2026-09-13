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

test.describe.serial("Stock Lifecycle & Inventory Precision Engine", () => {
  test("1. Catalog Stock Summation: 100% Mathematical Precision (Parent === SUM(variants))", async () => {
    const { data: products, error: fetchErr } = await anonClient
      .from("products")
      .select("id, slug, name, stock, product_variants(id, name, stock, is_active)")
      .order("name");

    expect(fetchErr).toBeNull();
    expect(products).toBeTruthy();
    expect(products!.length).toBeGreaterThanOrEqual(1);

    let discrepancies = 0;
    for (const p of products!) {
      const vars = p.product_variants || [];
      if (vars.length > 0) {
        const sum = vars.reduce(
          (acc: number, v: { stock: number | null }) => acc + (v.stock || 0),
          0,
        );
        if (sum !== p.stock) {
          discrepancies++;
          console.error(`Discrepancy in ${p.name}: parent=${p.stock}, variants sum=${sum}`);
        }
      }
    }

    expect(discrepancies).toBe(0);
  });

  test("2. Zero Phantom Variants (No 'Default' variant coexisting with real size variants)", async () => {
    const { data: products, error } = await anonClient
      .from("products")
      .select("name, slug, product_variants(name, size)");

    expect(error).toBeNull();
    let anomalies = 0;

    for (const p of products || []) {
      const vars = p.product_variants || [];
      const sizedVars = vars.filter(
        (v: { size: string | null }) => v.size && v.size.trim().length > 0,
      );
      const defaultVars = vars.filter(
        (v: { name: string; size: string | null }) => v.name === "Default" || !v.size,
      );

      if (sizedVars.length > 0 && defaultVars.length > 0) {
        anomalies++;
        console.error(`Anomaly: ${p.name} has both sized variants and phantom Default variant`);
      }
    }

    expect(anomalies).toBe(0);
  });

  test("3. Real POS Sale -> Deduct Variant & Parent by Exactly 1 (No Double-Deduction)", async () => {
    const { data: prods } = await anonClient
      .from("products")
      .select("id, name, slug, stock, product_variants(id, name, stock)")
      .limit(1);

    expect(prods && prods.length > 0).toBeTruthy();
    const prod = prods![0];

    expect(prod).toBeTruthy();
    const targetVariant = prod!.product_variants[0];
    const initialParentStock = prod!.stock;
    const initialVarStock = targetVariant.stock;

    // 1. Perform POS sale
    const { data: saleRes, error: saleErr } = await anonClient.rpc("place_offline_sale", {
      _customer_name: "Playwright Automated Test",
      _customer_phone: "9988776655",
      _payment_method: "cash",
      _items: [
        {
          product_id: prod!.id,
          variant_id: targetVariant.id,
          product_slug: prod!.slug,
          name: prod!.name,
          variant_info: targetVariant.name,
          price: 699,
          qty: 1,
        },
      ],
    });

    expect(saleErr).toBeNull();
    expect(saleRes.sale_id).toBeTruthy();

    // 2. Verify stock immediately after sale
    const { data: afterSale } = await anonClient
      .from("products")
      .select("stock, product_variants(id, stock)")
      .eq("id", prod!.id)
      .single();

    const varAfterSale = afterSale!.product_variants.find(
      (v: { id: string }) => v.id === targetVariant.id,
    );

    expect(varAfterSale!.stock).toBe(initialVarStock - 1);
    expect(afterSale!.stock).toBe(initialParentStock - 1); // Strictly 1 unit deducted!

    // 3. Perform POS return to restore stock
    const { data: retRes, error: retErr } = await anonClient.rpc("process_offline_return", {
      _original_sale_id: saleRes.sale_id,
      _customer_name: "Playwright Automated Test",
      _customer_phone: "9988776655",
      _items: [
        {
          product_id: prod!.id,
          variant_id: targetVariant.id,
          name: prod!.name,
          qty: 1,
          refund_price: 699,
        },
      ],
      _refund_method: "exchange_credit",
      _return_reason: "Playwright stock restoration verification",
    });

    expect(retErr).toBeNull();
    expect(retRes.return_number).toBeTruthy();

    // 4. Verify stock restored to exact pre-sale baseline
    const { data: afterReturn } = await anonClient
      .from("products")
      .select("stock, product_variants(id, stock)")
      .eq("id", prod!.id)
      .single();

    const varAfterReturn = afterReturn!.product_variants.find(
      (v: { id: string }) => v.id === targetVariant.id,
    );

    expect(varAfterReturn!.stock).toBe(initialVarStock);
    expect(afterReturn!.stock).toBe(initialParentStock);
  });
});
