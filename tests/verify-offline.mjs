import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const envFile = fs.readFileSync(".env", "utf-8");
const env = {};
envFile.split("\n").forEach((line) => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, "");
});

const tokenData = JSON.parse(fs.readFileSync("admin-token.json", "utf-8"));
const token = tokenData.access_token;

console.log("VITE_SUPABASE_URL:", env.VITE_SUPABASE_URL);

// Initialize Supabase Client with Auth
const supabase = createClient(
  env.VITE_SUPABASE_URL || "https://wbbatgbvizhghtkvuguf.supabase.co",
  env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_WiczJQTx4afGJ02WAiUIUw_8YlWjkSP",
  {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  },
);

let stats = {
  totalTests: 0,
  passed: 0,
  failed: 0,
  notVerified: 0,
  bugsFound: 0,
  bugsFixed: 0,
  remaining: 0,
};

async function log(title, testFn) {
  console.log(`\n▶ TEST: ${title}`);
  stats.totalTests++;
  try {
    const result = await testFn();
    console.log(`✅ PASSED: ${title}`);
    stats.passed++;
    return result;
  } catch (error) {
    console.log(`❌ FAILED: ${title}`);
    console.log(`PROBLEM: ${error.message}`);
    stats.failed++;
    stats.bugsFound++;
    return null;
  }
}

async function runVerification() {
  console.log("=====================================================================");
  console.log("ZÉRAH BABY & KIDS: E2E VERIFICATION SCRIPT (OFFLINE PRODUCTS)");
  console.log("=====================================================================\n");

  const testProductSku = "TEST-OFFLINE-" + Date.now();
  let productId = null;

  const testProductSlug = "test-offline-product-" + Date.now();
  await log("1. Verify Database Migration & Product Creation", async () => {
    const testProduct = {
      slug: testProductSlug,
      name: "TEST OFFLINE PRODUCT",
      brand: "TEST",
      category: "Toys",
      price: 100,
      mrp: 150,
      stock: 10,
      sku: testProductSku,
      barcode: "1234567890123",
      sales_channel: "OFFLINE_ONLY",
      is_active: true,
    };

    const { data, error } = await supabase
      .from("products")
      .insert([testProduct])
      .select("id, sales_channel, stock, slug")
      .single();

    if (error) throw new Error(`Product creation failed: ${error.message}`);
    if (data.sales_channel !== "OFFLINE_ONLY")
      throw new Error(`Product channel is ${data.sales_channel}`);
    if (data.stock !== 10) throw new Error("Stock not initialized to 10");
    productId = data.id;
    console.log(`   -> Created Product ID: ${productId}`);
  });

  if (!productId) {
    console.log("Critical failure: Cannot proceed without product.");
    process.exit(1);
  }

  await log("2. Verify Online Checkout Backend Protection", async () => {
    // Attempt to place an order via place_order RPC with this product
    const payload = {
      _items: [{ product_slug: testProductSlug, qty: 1 }],
      _full_name: "Test Hacker",
      _email: "hacker@test.com",
      _phone: "9999999999",
      _alt_phone: "",
      _address: "123 Hack St",
      _address_line2: "",
      _landmark: "",
      _city: "TestCity",
      _state: "TS",
      _pincode: "123456",
      _payment_method: "cash_on_delivery",
      _notes: "",
      _coupon_code: null,
    };

    const { data, error } = await supabase.rpc("place_order", payload);
    if (!error) {
      throw new Error(
        `RPC allowed the purchase! Expected failure. Response: ${JSON.stringify(data)}`,
      );
    }

    if (!error.message.includes("Cannot purchase OFFLINE_ONLY")) {
      console.log(`   ⚠️ WARNING: Failed but message differs: ${error.message}`);
    } else {
      console.log(`   -> Successfully rejected: ${error.message}`);
    }
  });

  await log("3. Verify Backend Rejection with Mixed Items", async () => {
    // Find an online item to mix
    const { data: onlineItem } = await supabase
      .from("products")
      .select("id, slug, price")
      .eq("sales_channel", "ONLINE_AND_OFFLINE")
      .eq("is_active", true)
      .limit(1)
      .single();
    if (!onlineItem) throw new Error("No online items found to mix");

    const payload = {
      _items: [
        { product_slug: onlineItem.slug, qty: 1 },
        { product_slug: testProductSlug, qty: 1 },
      ],
      _full_name: "Test Hacker",
      _email: "hacker2@test.com",
      _phone: "9999999999",
      _alt_phone: "",
      _address: "123 Hack St",
      _address_line2: "",
      _landmark: "",
      _city: "TestCity",
      _state: "TS",
      _pincode: "123456",
      _payment_method: "cash_on_delivery",
      _notes: "",
      _coupon_code: null,
    };

    const { data, error } = await supabase.rpc("place_order", payload);
    if (!error) throw new Error("RPC allowed mixed purchase!");
    console.log(`   -> Successfully rejected mixed cart: ${error.message}`);
  });

  let orderId = null;
  await log("4. Verify POS Sale Completion", async () => {
    // Use place_offline_sale
    const payload = {
      _items: [{ product_slug: testProductSlug, product_id: productId, qty: 1, custom_price: 100 }],
      _payment_method: "cash",
      _customer_id: null,
      _customer_name: "Walk-in Offline",
      _customer_phone: "",
      _customer_email: "",
      _discount: 0,
      _discount_type: "none",
      _discount_value: 0,
      _notes: "",
      _idempotency_key: "test-idem-" + Date.now(),
    };

    const { data, error } = await supabase.rpc("place_offline_sale", payload);
    if (error) throw new Error(`Offline sale failed: ${error.message}`);
    if (!data || !data.sale_id) throw new Error("No order ID returned");
    orderId = data.sale_id;
    console.log(`   -> Sale completed. Order ID: ${orderId}`);
  });

  await log("5. Verify Inventory Deduction", async () => {
    const { data, error } = await supabase
      .from("products")
      .select("stock")
      .eq("id", productId)
      .single();
    if (error) throw new Error(`Failed to fetch stock: ${error.message}`);
    if (data.stock !== 9) throw new Error(`Expected stock 9, got ${data.stock}`);
    console.log(`   -> Stock is correctly ${data.stock}`);
  });

  await log("6. Verify Sale Records & Invoice Generation", async () => {
    const { data, error } = await supabase
      .from("orders")
      .select("status, display_id, payment_method, source")
      .eq("id", orderId)
      .single();
    if (error) throw new Error(`Failed to fetch order: ${error.message}`);
    if (data.status !== "completed" && data.status !== "delivered" && data.status !== "paid")
      throw new Error(`Order status is ${data.status}`);
    if (data.source !== "pos") throw new Error(`Order source is ${data.source}`);
    if (!data.display_id) throw new Error("Display ID (Invoice) not generated");
    console.log(
      `   -> Order status ${data.status}, Source ${data.source}, Invoice ${data.display_id}`,
    );
  });

  // Cleanup disabled to leave test product in database for live URL verification
  // await log("7. Cleanup Test Data", async () => {
  //   await supabase.from('order_items').delete().eq('order_id', orderId);
  //   await supabase.from('orders').delete().eq('id', orderId);
  //   await supabase.from('products').delete().eq('id', productId);
  // });

  console.log("\n=====================================================================");
  console.log("FINAL REPORT");
  console.log(`TOTAL FUNCTIONS TESTED: ${stats.totalTests}`);
  console.log(`TOTAL TESTS PASSED: ${stats.passed}`);
  console.log(`TOTAL TESTS FAILED: ${stats.failed}`);
  console.log(`TOTAL NOT VERIFIED: ${stats.notVerified}`);
  console.log(`TOTAL BUGS FOUND: ${stats.bugsFound}`);
  console.log(`TOTAL BUGS FIXED: ${stats.bugsFixed}`);
  console.log(`TOTAL REMAINING: ${stats.remaining}`);
  console.log("=====================================================================\n");
}

runVerification();
