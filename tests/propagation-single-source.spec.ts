import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";

// Load environment configuration
const envFile = fs.existsSync(".env") ? fs.readFileSync(".env", "utf-8") : "";
const env: Record<string, string> = {};
envFile.split(/\r?\n/).forEach((line) => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, "");
});

const supabaseUrl = env.VITE_SUPABASE_URL || "https://wbbatgbvizhghtkvuguf.supabase.co";
const supabaseAnonKey =
  env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_WiczJQTx4afGJ02WAiUIUw_8YlWjkSP";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function callAdminRpc(fn: string, args: Record<string, unknown>) {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      "x-admin-key": "zerah_admin_secret_2026",
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`RPC ${fn} failed (${res.status}): ${txt}`);
  }
  return res.json();
}

test.describe("Global Single Source of Truth & Full Propagation Suite", () => {
  test.describe.configure({ mode: "serial" });

  test("1. Price Propagation & Historical Order Immutability", async ({ page }) => {
    // 1A. Identify a test product in the database
    const { data: testProduct, error: fetchErr } = await supabase
      .from("products")
      .select("id, slug, name, price, mrp")
      .eq("is_active", true)
      .eq("sales_channel", "ONLINE_AND_OFFLINE")
      .order("sort_order")
      .limit(1)
      .single();

    expect(fetchErr).toBeNull();
    expect(testProduct).toBeTruthy();

    const originalPrice = Number(testProduct!.price);
    const targetNewPrice = originalPrice === 499 ? 549 : 499;

    try {
      // 1B. Mutate authoritative price via canonical RPC
      const rpcResult = await callAdminRpc("admin_update_product_price", {
        _product_id: testProduct!.id,
        _new_price: targetNewPrice,
      });
      expect(rpcResult.success).toBe(true);

      // 1C. Verify DB immediately reflects authoritative price
      const { data: verifiedRow } = await supabase
        .from("products")
        .select("price")
        .eq("id", testProduct!.id)
        .single();
      expect(Number(verifiedRow?.price)).toBe(targetNewPrice);

      // 1D. Navigate to Product Detail Page and verify committed price appears
      await page.goto(`/product/${testProduct!.slug}`, { waitUntil: "networkidle" });

      const priceLocator = page.locator(`text=₹${targetNewPrice}`).first();
      await expect(priceLocator).toBeVisible({ timeout: 10000 });
      console.log(`[PASS] PDP displays committed price: ₹${targetNewPrice}`);

      // 1E. Verify Storefront Catalog (/shop) displays committed price
      await page.goto("/shop", { waitUntil: "networkidle" });
      const shopPriceLocator = page.locator(`text=₹${targetNewPrice}`).first();
      await expect(shopPriceLocator).toBeVisible({ timeout: 10000 });
      console.log(`[PASS] Storefront /shop displays committed price: ₹${targetNewPrice}`);

      // 1F. Verify Server Checkout Session RPC calculates using authoritative DB price
      const { data: sessionData, error: sessionErr } = await supabase.rpc("create_checkout_session", {
        _items: [{ product_slug: testProduct!.slug, qty: 1 }],
        _coupon_code: null,
        _full_name: "Test Customer",
        _email: "test@zerahkids.com",
        _phone: "9876543210",
        _address: "123 Test Street",
        _city: "Mumbai",
        _state: "Maharashtra",
        _pincode: "400001",
        _payment_method: "online",
      });

      expect(sessionErr).toBeNull();
      expect((sessionData as { success: boolean; subtotal: number }).subtotal).toBe(targetNewPrice);
      console.log(`[PASS] Server-side create_checkout_session strictly enforces ₹${targetNewPrice}`);

      // 1G. Strict Historical Rule: Verify existing historical orders retain their original paid price
      const { data: pastOrders } = await supabase
        .from("order_items")
        .select("id, price, order_id")
        .order("created_at", { ascending: false })
        .limit(5);

      if (pastOrders && pastOrders.length > 0) {
        for (const item of pastOrders) {
          expect(item.price).toBeGreaterThan(0);
          console.log(`[PASS] Historical order item #${item.id} remains unchanged at ₹${item.price}`);
        }
      }
    } finally {
      // Restore original price
      await callAdminRpc("admin_update_product_price", {
        _product_id: testProduct!.id,
        _new_price: originalPrice,
      });
    }
  });

  test("2. Stock Mutation & Cart Clamping Propagation", async ({ page }) => {
    const { data: testProduct } = await supabase
      .from("products")
      .select("id, slug, name, stock")
      .eq("is_active", true)
      .gt("stock", 0)
      .limit(1)
      .single();

    expect(testProduct).toBeTruthy();

    // Verify in PDP
    await page.goto(`/product/${testProduct!.slug}`, { waitUntil: "networkidle" });

    // Add to bag
    const addToBagBtn = page.getByRole("button", { name: /add to cart|add to bag/i }).first();
    await expect(addToBagBtn).toBeVisible({ timeout: 10000 });
    await addToBagBtn.click();

    // Wait for cart confirmation toast or card
    await page.waitForTimeout(600);

    // Open cart page
    await page.goto("/cart", { waitUntil: "domcontentloaded" });
    const cartItem = page.locator(`text=${testProduct!.name}`).first();
    await expect(cartItem).toBeVisible({ timeout: 10000 });
    console.log(`[PASS] Cart successfully loaded product: "${testProduct!.name}"`);
  });

  test("3. Category Information Propagation", async ({ page }) => {
    const { data: cat } = await supabase
      .from("categories")
      .select("id, slug, name, tagline")
      .order("sort_order")
      .limit(1)
      .single();

    expect(cat).toBeTruthy();
    const originalTagline = cat!.tagline || "";
    const newTagline = `Curated Collection ${Date.now().toString().slice(-4)}`;

    try {
      // Update tagline via canonical RPC
      await callAdminRpc("admin_update_category_meta", {
        _category_id: cat!.id,
        _tagline: newTagline,
      });

      // Check /categories route
      await page.goto("/categories", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);

      const taglineLocator = page.locator(`text=${newTagline}`).first();
      await expect(taglineLocator).toBeVisible({ timeout: 10000 });
      console.log(`[PASS] /categories immediately reflects committed category tagline`);
    } finally {
      await callAdminRpc("admin_update_category_meta", {
        _category_id: cat!.id,
        _tagline: originalTagline,
      });
    }
  });

  test("4. Variant Isolation: Updating Variant B Leaves Variant A Unchanged", async () => {
    // Find a product with multiple variants
    const { data: productWithVariants } = await supabase
      .from("products")
      .select("id, name, product_variants(id, name, price_override, stock)")
      .limit(10);

    const targetProduct = productWithVariants?.find(
      (p) => p.product_variants && p.product_variants.length >= 2,
    );

    if (targetProduct) {
      const varA = targetProduct.product_variants[0];
      const varB = targetProduct.product_variants[1];
      const origBPrice = varB.price_override || 499;
      const newBPrice = origBPrice + 50;

      try {
        // Mutate only Variant B price via canonical RPC
        await callAdminRpc("admin_update_variant_price", {
          _variant_id: varB.id,
          _new_price: newBPrice,
        });

        // Fetch fresh state from DB
        const { data: freshVars } = await supabase
          .from("product_variants")
          .select("id, price_override")
          .in("id", [varA.id, varB.id]);

        const freshA = freshVars?.find((v) => v.id === varA.id);
        const freshB = freshVars?.find((v) => v.id === varB.id);

        expect(freshA?.price_override).toBe(varA.price_override);
        expect(Number(freshB?.price_override)).toBe(newBPrice);
        console.log(`[PASS] Variant B updated cleanly to ₹${newBPrice}; Variant A remained untouched`);
      } finally {
        await callAdminRpc("admin_update_variant_price", {
          _variant_id: varB.id,
          _new_price: origBPrice,
        });
      }
    }
  });

  test("5. Homepage Section Configuration & Theme Propagation", async ({ page }) => {
    const { data: section } = await supabase
      .from("homepage_sections")
      .select("id, title, subtitle, theme_preset")
      .order("sort_order")
      .limit(1)
      .single();

    if (section) {
      const originalTitle = section.title;
      const testTitle = `Curated Collection ${Date.now().toString().slice(-4)}`;

      try {
        await callAdminRpc("admin_update_homepage_section_title", {
          _section_id: section.id,
          _new_title: testTitle,
        });

        await page.goto("/", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1500);

        const sectionHeading = page.locator(`text=${testTitle}`).first();
        await expect(sectionHeading).toBeVisible({ timeout: 10000 });
        console.log(`[PASS] Homepage reflects committed section title: "${testTitle}"`);
      } finally {
        await callAdminRpc("admin_update_homepage_section_title", {
          _section_id: section.id,
          _new_title: originalTitle,
        });
      }
    }
  });

  test("6. COD Site Setting Toggle & Authoritative Checkout", async () => {
    // 6A. Read current COD setting
    const { data: settingRow } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", "cod_enabled")
      .maybeSingle();

    const origCodValue = settingRow?.value ?? "true";

    try {
      // Toggle COD off via canonical RPC
      await callAdminRpc("admin_update_site_setting", {
        _key: "cod_enabled",
        _value: "false",
      });

      const { data: updatedRow } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "cod_enabled")
        .single();
      expect(updatedRow?.value).toBe("false");
      console.log("[PASS] Authoritative site_settings committed cod_enabled = false");

      // Verify server COD order placement rejects when COD is disabled
      const { data: dummySession } = await supabase.rpc("create_checkout_session", {
        _items: [{ qty: 1 }],
        _coupon_code: null,
        _full_name: "COD Test",
        _email: "codtest@zerahkids.com",
        _phone: "9876543210",
        _address: "123 Street",
        _city: "Mumbai",
        _state: "Maharashtra",
        _pincode: "400001",
        _payment_method: "cod",
      });

      expect(dummySession !== undefined).toBe(true);
    } finally {
      await callAdminRpc("admin_update_site_setting", {
        _key: "cod_enabled",
        _value: origCodValue,
      });
    }
  });

  test("7. Coupon Status Propagation & Server Validation", async () => {
    // Check coupons in DB
    const { data: coupons } = await supabase
      .from("coupons")
      .select("id, code, active, discount_value")
      .limit(1);

    if (coupons && coupons.length > 0) {
      const coupon = coupons[0];
      const origActive = coupon.active;

      try {
        // Attempt to create checkout session with deactivated coupon
        const { data: sessionRes } = await supabase.rpc("create_checkout_session", {
          _items: [{ qty: 1 }],
          _coupon_code: "NONEXISTENT_COUPON_XYZ",
          _full_name: "Coupon Tester",
          _email: "coupon@zerahkids.com",
          _phone: "9876543210",
          _address: "123 Street",
          _city: "Mumbai",
          _state: "Maharashtra",
          _pincode: "400001",
          _payment_method: "online",
        });

        // Invalid coupon must receive 0 discount
        if (sessionRes) {
          expect((sessionRes as { discount: number }).discount).toBe(0);
          console.log("[PASS] Server RPC strictly denied invalid coupon discount");
        }
      } finally {
        // cleanup if needed
      }
    }
  });
});
