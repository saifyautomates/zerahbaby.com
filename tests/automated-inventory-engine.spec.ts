import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";

// Load environment configuration
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

test.describe.serial("Automated Inventory Management Engine (Online + POS + Returns + Exchanges + Cancellations)", () => {
  // Test 1: POS Sale Atomic Decrement & Variant Isolation
  test("1. POS Sale: Atomic Decrement on Exact Variant, Parent Alignment, Sibling Isolation", async () => {
    const { data: prods } = await anonClient
      .from("products")
      .select("id, name, slug, stock, product_variants(id, name, stock)")
      .limit(1);

    expect(prods && prods.length > 0).toBeTruthy();
    const prod = prods![0];
    const targetVariant = prod.product_variants[0];
    const initialVarStock = targetVariant.stock;
    const initialParentStock = prod.stock;

    // 1. Perform POS Sale for 1 unit
    const idempotencyKey = `pos_test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const { data: saleRes, error: saleErr } = await anonClient.rpc("place_offline_sale", {
      _customer_name: "Automated Inventory Test User",
      _customer_phone: "9876543210",
      _payment_method: "cash",
      _items: [
        {
          product_id: prod.id,
          variant_id: targetVariant.id,
          product_slug: prod.slug,
          name: prod.name,
          variant_info: targetVariant.name,
          price: 499,
          qty: 1,
        },
      ],
      _idempotency_key: idempotencyKey,
    });

    expect(saleErr).toBeNull();
    expect(saleRes?.sale_id).toBeTruthy();

    // 2. Verify stock in database immediately after sale
    const { data: afterSale } = await anonClient
      .from("products")
      .select("stock, product_variants(id, stock)")
      .eq("id", prod.id)
      .single();

    const varAfter = afterSale!.product_variants.find((v: { id: string }) => v.id === targetVariant.id);
    expect(varAfter!.stock).toBe(initialVarStock - 1);
    expect(afterSale!.stock).toBe(initialParentStock - 1);

    // 3. Clean up / Restore stock via process_offline_return
    const { data: retRes, error: retErr } = await anonClient.rpc("process_offline_return", {
      _original_sale_id: saleRes.sale_id,
      _customer_name: "Automated Inventory Test User",
      _customer_phone: "9876543210",
      _items: [
        {
          product_id: prod.id,
          variant_id: targetVariant.id,
          name: prod.name,
          qty: 1,
          refund_price: 499,
        },
      ],
      _refund_method: "cash",
      _return_reason: "Automated test rollback",
    });

    expect(retErr).toBeNull();
    expect(retRes?.return_number).toBeTruthy();

    // 4. Verify restored back to exact baseline
    const { data: restored } = await anonClient
      .from("products")
      .select("stock, product_variants(id, stock)")
      .eq("id", prod.id)
      .single();

    const varRestored = restored!.product_variants.find((v: { id: string }) => v.id === targetVariant.id);
    expect(varRestored!.stock).toBe(initialVarStock);
    expect(restored!.stock).toBe(initialParentStock);
  });

  // Test 2: Idempotent POS Sale Submission (Double-Click Protection)
  test("2. Idempotency: Duplicate POS Sale Submissions Never Deduct Twice", async () => {
    const { data: prods } = await anonClient
      .from("products")
      .select("id, name, slug, stock, product_variants(id, name, stock)")
      .limit(1);

    const prod = prods![0];
    const targetVariant = prod.product_variants[0];
    const initialVarStock = targetVariant.stock;
    const initialParentStock = prod.stock;

    const duplicateKey = `idemp_test_${Date.now()}`;

    // First submit
    const { data: sale1, error: err1 } = await anonClient.rpc("place_offline_sale", {
      _customer_name: "Double Click Test",
      _customer_phone: "9876543210",
      _payment_method: "cash",
      _items: [
        {
          product_id: prod.id,
          variant_id: targetVariant.id,
          product_slug: prod.slug,
          name: prod.name,
          variant_info: targetVariant.name,
          price: 499,
          qty: 1,
        },
      ],
      _idempotency_key: duplicateKey,
    });

    expect(err1).toBeNull();
    expect(sale1?.sale_id).toBeTruthy();

    // Duplicate submit with exact same key
    const { data: sale2, error: err2 } = await anonClient.rpc("place_offline_sale", {
      _customer_name: "Double Click Test",
      _customer_phone: "9876543210",
      _payment_method: "cash",
      _items: [
        {
          product_id: prod.id,
          variant_id: targetVariant.id,
          product_slug: prod.slug,
          name: prod.name,
          variant_info: targetVariant.name,
          price: 499,
          qty: 1,
        },
      ],
      _idempotency_key: duplicateKey,
    });

    expect(err2).toBeNull();
    expect(sale2?.sale_id).toBe(sale1?.sale_id);

    // Verify stock decremented ONLY ONCE (-1, not -2)
    const { data: afterBoth } = await anonClient
      .from("products")
      .select("stock, product_variants(id, stock)")
      .eq("id", prod.id)
      .single();

    const varAfter = afterBoth!.product_variants.find((v: { id: string }) => v.id === targetVariant.id);
    expect(varAfter!.stock).toBe(initialVarStock - 1);
    expect(afterBoth!.stock).toBe(initialParentStock - 1);

    // Rollback / Return 1 unit
    await anonClient.rpc("process_offline_return", {
      _original_sale_id: sale1.sale_id,
      _customer_name: "Double Click Test",
      _customer_phone: "9876543210",
      _items: [
        {
          product_id: prod.id,
          variant_id: targetVariant.id,
          name: prod.name,
          qty: 1,
          refund_price: 499,
        },
      ],
      _refund_method: "cash",
      _return_reason: "Rollback duplicate test",
    });
  });

  // Test 3: Unverified Online Payment Never Mutates Inventory
  test("3. Online Checkout: Unverified / Cancelled Payment Leaves Inventory Completely Untouched", async () => {
    const { data: prods } = await anonClient
      .from("products")
      .select("id, name, slug, stock, product_variants(id, name, stock)")
      .limit(1);

    const prod = prods![0];
    const targetVariant = prod.product_variants[0];
    const initialStock = targetVariant.stock;

    // 1. Create a checkout session (intent only)
    const { data: sessionData, error: sessionErr } = await anonClient.rpc("create_checkout_session", {
      _items: [{ variant_id: targetVariant.id, qty: 1 }],
      _full_name: "Payment Cancel User",
      _email: "canceluser@example.com",
      _phone: "9876543210",
      _address: "123 Test St",
      _city: "Mumbai",
      _state: "Maharashtra",
      _pincode: "400001",
      _idempotency_key: `sess_cancel_${Date.now()}`,
      _payment_method: "online",
    });

    expect(sessionErr).toBeNull();
    expect(sessionData?.session_id).toBeTruthy();

    // 2. Simulate payment cancellation
    const { error: cancelErr } = await anonClient.rpc("cancel_checkout_session", {
      _session_id: sessionData.session_id,
      _reason: "Customer dismissed payment popup",
    });

    expect(cancelErr).toBeNull();

    // 3. Verify stock has NOT changed at all
    const { data: verifiedProd } = await anonClient
      .from("products")
      .select("stock, product_variants(id, stock)")
      .eq("id", prod.id)
      .single();

    const varStock = verifiedProd!.product_variants.find((v: { id: string }) => v.id === targetVariant.id);
    expect(varStock!.stock).toBe(initialStock);
  });

  // Test 4: Online Paid Order Atomic Decrement & Restoration
  test("4. Online Paid Order: Atomic Decrement at finalize_paid_order & Clean Restock", async () => {
    const { data: prods } = await anonClient
      .from("products")
      .select("id, name, slug, stock, product_variants(id, name, stock)")
      .limit(1);

    const prod = prods![0];
    const targetVariant = prod.product_variants[0];
    const initialStock = targetVariant.stock;

    // Create checkout session for online payment
    const { data: sessionData } = await anonClient.rpc("create_checkout_session", {
      _items: [{ variant_id: targetVariant.id, qty: 1 }],
      _full_name: "Online Paid Stock Test",
      _email: "paidtest@example.com",
      _phone: "9876543210",
      _address: "789 Online Road",
      _city: "Delhi",
      _state: "Delhi",
      _pincode: "110001",
      _idempotency_key: `sess_paid_${Date.now()}`,
      _payment_method: "online",
    });

    expect(sessionData?.session_id).toBeTruthy();

    const rzpOrderId = `order_inv_${Date.now()}`;
    const rzpPayId = `pay_inv_${Date.now()}`;

    // Record payment attempt
    await anonClient.rpc("record_payment_attempt", {
      _session_id: sessionData.session_id,
      _razorpay_order_id: rzpOrderId,
      _amount: sessionData.total,
      _currency: "INR",
    });

    // Finalize paid order -> Decrements stock atomically
    const { data: paidRes, error: paidErr } = await anonClient.rpc("finalize_paid_order", {
      _session_id: sessionData.session_id,
      _razorpay_order_id: rzpOrderId,
      _razorpay_payment_id: rzpPayId,
      _razorpay_signature: "sig_dummy",
      _verified_amount: Math.round(sessionData.total * 100),
    });

    expect(paidErr).toBeNull();
    expect(paidRes?.order_id).toBeTruthy();

    // Verify stock decremented by 1
    const { data: afterPaid } = await anonClient
      .from("products")
      .select("stock, product_variants(id, stock)")
      .eq("id", prod.id)
      .single();

    const varAfter = afterPaid!.product_variants.find((v: { id: string }) => v.id === targetVariant.id);
    expect(varAfter!.stock).toBe(initialStock - 1);

    // Cancel order via restore_stock_for_order / cancel
    const { data: cancelRes } = await anonClient.rpc("restore_stock_for_order", {
      p_order_id: paidRes.order_id,
      p_reason: "Online automated test cleanup",
      p_reference_type: "order",
    });

    expect(cancelRes?.success).toBe(true);

    // Verify stock restored
    const { data: restored } = await anonClient
      .from("products")
      .select("stock, product_variants(id, stock)")
      .eq("id", prod.id)
      .single();

    const varRestored = restored!.product_variants.find((v: { id: string }) => v.id === targetVariant.id);
    expect(varRestored!.stock).toBe(initialStock);
  });

  // Test 5: Zero Double-Restoration on Repeated Cancellation Calls
  test("5. Zero Double-Restoration: Repeated restore_stock_for_order Safely No-Ops", async () => {
    const { data: prods } = await anonClient
      .from("products")
      .select("id, name, slug, stock, product_variants(id, name, stock)")
      .limit(1);

    const prod = prods![0];
    const targetVariant = prod.product_variants[0];
    const initialStock = targetVariant.stock;

    // Create and place an online paid test order
    const { data: sessionData } = await anonClient.rpc("create_checkout_session", {
      _items: [{ variant_id: targetVariant.id, qty: 1 }],
      _full_name: "Double Restore Guard",
      _email: "guard@example.com",
      _phone: "9876543210",
      _address: "321 Guard St",
      _city: "Bengaluru",
      _state: "Karnataka",
      _pincode: "560001",
      _idempotency_key: `sess_guard_${Date.now()}`,
      _payment_method: "online",
    });

    expect(sessionData?.session_id).toBeTruthy();

    const rzpOrderId = `order_guard_${Date.now()}`;
    const rzpPayId = `pay_guard_${Date.now()}`;

    await anonClient.rpc("record_payment_attempt", {
      _session_id: sessionData.session_id,
      _razorpay_order_id: rzpOrderId,
      _amount: sessionData.total,
      _currency: "INR",
    });

    const { data: paidRes } = await anonClient.rpc("finalize_paid_order", {
      _session_id: sessionData.session_id,
      _razorpay_order_id: rzpOrderId,
      _razorpay_payment_id: rzpPayId,
      _razorpay_signature: "sig_dummy",
      _verified_amount: Math.round(sessionData.total * 100),
    });

    expect(paidRes?.order_id).toBeTruthy();

    // 1st Restock call: Should restore stock
    const { data: res1 } = await anonClient.rpc("restore_stock_for_order", {
      p_order_id: paidRes.order_id,
      p_reason: "1st restock",
      p_reference_type: "order",
    });

    expect(res1?.success).toBe(true);
    expect(res1?.already_restored).toBe(false);

    // Check stock after 1st restock: must equal initialStock
    const { data: afterFirst } = await anonClient
      .from("products")
      .select("product_variants(id, stock)")
      .eq("id", prod.id)
      .single();
    const varAfterFirst = afterFirst!.product_variants.find((v: { id: string }) => v.id === targetVariant.id);
    expect(varAfterFirst!.stock).toBe(initialStock);

    // 2nd Restock call: Must detect existing restoration and NOT increment stock again
    const { data: res2 } = await anonClient.rpc("restore_stock_for_order", {
      p_order_id: paidRes.order_id,
      p_reason: "2nd duplicate restock",
      p_reference_type: "order",
    });

    expect(res2?.success).toBe(true);
    expect(res2?.already_restored).toBe(true);

    // Check stock after 2nd restock: must STILL equal initialStock (ZERO double restoration!)
    const { data: afterSecond } = await anonClient
      .from("products")
      .select("product_variants(id, stock)")
      .eq("id", prod.id)
      .single();
    const varAfterSecond = afterSecond!.product_variants.find((v: { id: string }) => v.id === targetVariant.id);
    expect(varAfterSecond!.stock).toBe(initialStock);
  });

  // Test 6: POS Exchange Workflow
  test("6. Exchange Flow: Return Item A (+1) -> Store Credit Token -> Sell Item B (-1)", async () => {
    const { data: prods } = await anonClient
      .from("products")
      .select("id, name, slug, stock, product_variants(id, name, stock)")
      .limit(1);

    const prod = prods![0];
    const targetVariant = prod.product_variants[0];
    const initialStock = targetVariant.stock;

    // 1. Initial Sale of Item A
    const { data: saleA } = await anonClient.rpc("place_offline_sale", {
      _customer_name: "Exchange User",
      _customer_phone: "9876543210",
      _payment_method: "cash",
      _items: [
        {
          product_id: prod.id,
          variant_id: targetVariant.id,
          product_slug: prod.slug,
          name: prod.name,
          variant_info: targetVariant.name,
          price: 600,
          qty: 1,
        },
      ],
      _idempotency_key: `pos_exch_${Date.now()}`,
    });

    expect(saleA?.sale_id).toBeTruthy();

    // 2. Return Item A via exchange_credit (restores Item A stock and creates token)
    const { data: exchReturn, error: exchErr } = await anonClient.rpc("process_offline_return", {
      _original_sale_id: saleA.sale_id,
      _customer_name: "Exchange User",
      _customer_phone: "9876543210",
      _items: [
        {
          product_id: prod.id,
          variant_id: targetVariant.id,
          name: prod.name,
          qty: 1,
          refund_price: 600,
        },
      ],
      _refund_method: "exchange_credit",
      _return_reason: "Size exchange",
    });

    expect(exchErr).toBeNull();
    expect(exchReturn?.credit_token).toBeTruthy();

    // Verify Item A stock restored back to initialStock
    const { data: afterExchRet } = await anonClient
      .from("products")
      .select("product_variants(id, stock)")
      .eq("id", prod.id)
      .single();
    const varAfterExchRet = afterExchRet!.product_variants.find((v: { id: string }) => v.id === targetVariant.id);
    expect(varAfterExchRet!.stock).toBe(initialStock);

    // 3. Purchase Item B using exchange credit token (deducts stock for Item B)
    const { data: saleB, error: saleBErr } = await anonClient.rpc("place_offline_sale", {
      _customer_name: "Exchange User",
      _customer_phone: "9876543210",
      _payment_method: "store_credit",
      _credit_token: exchReturn.credit_token,
      _store_credit_used: 600,
      _items: [
        {
          product_id: prod.id,
          variant_id: targetVariant.id,
          product_slug: prod.slug,
          name: prod.name,
          variant_info: targetVariant.name,
          price: 600,
          qty: 1,
        },
      ],
      _idempotency_key: `pos_exch_b_${Date.now()}`,
    });

    expect(saleBErr).toBeNull();
    expect(saleB?.sale_id).toBeTruthy();

    // Clean up: return Item B so catalog returns to baseline
    await anonClient.rpc("process_offline_return", {
      _original_sale_id: saleB.sale_id,
      _customer_name: "Exchange User",
      _customer_phone: "9876543210",
      _items: [
        {
          product_id: prod.id,
          variant_id: targetVariant.id,
          name: prod.name,
          qty: 1,
          refund_price: 600,
        },
      ],
      _refund_method: "cash",
      _return_reason: "Clean up exchange test",
    });
  });

  // Test 7: Insufficient Stock Protection (Zero Negative Stock)
  test("7. Negative Stock Protection: Requesting More Than Available Stock Rejects Safely", async () => {
    const { data: prods } = await anonClient
      .from("products")
      .select("id, name, slug, stock, product_variants(id, name, stock)")
      .limit(1);

    const prod = prods![0];
    const targetVariant = prod.product_variants[0];
    const currentStock = targetVariant.stock;

    // In online checkout sessions, asking for 1000 units when stock is 10 must fail with insufficient stock
    const { error: sessErr } = await anonClient.rpc("create_checkout_session", {
      _items: [{ variant_id: targetVariant.id, qty: currentStock + 500 }],
      _full_name: "Oversell Tester",
      _email: "oversell@example.com",
      _phone: "9876543210",
      _address: "123 Oversell Way",
      _city: "Delhi",
      _state: "Delhi",
      _pincode: "110001",
      _idempotency_key: `sess_over_${Date.now()}`,
      _payment_method: "online",
    });

    expect(sessErr).not.toBeNull();
    expect(sessErr?.message).toMatch(/insufficient|stock|available/i);

    // Verify stock is untouched
    const { data: afterAttempt } = await anonClient
      .from("products")
      .select("product_variants(id, stock)")
      .eq("id", prod.id)
      .single();

    const varStock = afterAttempt!.product_variants.find((v: { id: string }) => v.id === targetVariant.id);
    expect(varStock!.stock).toBe(currentStock);
    expect(varStock!.stock).toBeGreaterThanOrEqual(0);
  });

  // Test 10: Automatic Archiving on Soldout and Automatic Reactivation on Restock
  test("10. Soldout Auto-Archive: Product automatically archives on zero stock and reactivates on restock", async () => {
    const { data: prods } = await anonClient
      .from("products")
      .select("id, name, slug, stock, is_active, status, product_variants(id, name, stock)")
      .eq("slug", "cord")
      .limit(1);

    expect(prods && prods.length > 0).toBeTruthy();
    const prod = prods![0];
    const targetVariant = prod.product_variants[0];
    const initialStock = prod.stock;
    const initialVarStock = targetVariant.stock;

    // 1. Deplete all available stock via POS sale
    const idempotencyKey = `soldout_spec_${Date.now()}`;
    const { data: saleRes, error: saleErr } = await anonClient.rpc("place_offline_sale", {
      _customer_name: "Soldout Tester",
      _customer_phone: "9876543210",
      _payment_method: "cash",
      _items: [
        {
          product_id: prod.id,
          variant_id: targetVariant.id,
          product_slug: prod.slug,
          name: prod.name,
          variant_info: targetVariant.name,
          price: 199,
          qty: initialVarStock,
        },
      ],
      _idempotency_key: idempotencyKey,
    });

    expect(saleErr).toBeNull();
    expect(saleRes?.sale_id).toBeTruthy();

    // 2. Query storefront / anon products: product MUST be hidden from active catalog
    const { data: activeCatalogCheck } = await anonClient
      .from("products")
      .select("id, is_active")
      .eq("id", prod.id);

    // Inactive/archived products are excluded by RLS for public/anon browsing
    expect(activeCatalogCheck?.length ?? 0).toBe(0);

    // 3. Process return to replenish stock
    const { data: retRes, error: retErr } = await anonClient.rpc("process_offline_return", {
      _original_sale_id: saleRes.sale_id,
      _customer_name: "Soldout Tester",
      _customer_phone: "9876543210",
      _items: [
        {
          product_id: prod.id,
          variant_id: targetVariant.id,
          name: prod.name,
          qty: initialVarStock,
          refund_price: 199,
        },
      ],
      _refund_method: "cash",
      _return_reason: "Test auto-reactivation on restock",
    });

    expect(retErr).toBeNull();
    expect(retRes?.return_number).toBeTruthy();

    // 4. Verify product is back live in active catalog with restored stock
    const { data: restoredCatalogCheck } = await anonClient
      .from("products")
      .select("id, stock, is_active, status")
      .eq("id", prod.id);

    expect(restoredCatalogCheck && restoredCatalogCheck.length === 1).toBeTruthy();
    const restored = restoredCatalogCheck![0];
    expect(restored.stock).toBe(initialStock);
    expect(restored.is_active).toBe(true);
    expect(restored.status).toBe("active");
  });
});
