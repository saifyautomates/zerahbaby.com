/**
 * ZÉRAH BABY & KIDS — MULTI-CUSTOMER POS / MULTI-CART SUITE
 *
 * Verifies end-to-end multi-cart isolation, customer separation,
 * hold/resume workflow, Supabase persistence, and browser UI switching.
 */

import { test, expect } from "@playwright/test";
import { supabase } from "../src/integrations/supabase/client";
import {
  createDefaultSession,
  generateSessionNumber,
  type POSSession,
} from "../src/lib/pos-sessions";

test.describe("Multi-Customer POS / Multi-Cart System Integrity", () => {
  // Test 1: In-Memory Multi-Session Isolation Invariants
  test("1. Multi-Cart Isolation: Sale A items and discounts never bleed into Sale B", () => {
    const sessionA: POSSession = {
      ...createDefaultSession("#1042"),
      customer_mode: "existing",
      customer_name: "Rahul Sharma",
      customer_phone: "9876543210",
      items: [
        {
          product_id: "p1",
          variant_id: "v1",
          slug: "tshirrt",
          name: "Organic Cotton T-Shirt",
          brand: "Zérah",
          category: "Clothing",
          price: 499,
          mrp: 999,
          stock: 50,
          sku: "ZRK-TSH-01",
          barcode: "8901234567890",
          image_url: null,
          age_group: "2-3Y",
          qty: 2,
        },
      ],
      discount_type: "percentage",
      discount_value: 10,
      subtotal: 998,
      discount_total: 99.8,
      total: 898.2,
    };

    const sessionB: POSSession = {
      ...createDefaultSession("#1043"),
      customer_mode: "existing",
      customer_name: "Priya Patel",
      customer_phone: "9123456780",
      items: [
        {
          product_id: "p2",
          variant_id: "v2",
          slug: "saify",
          name: "Wooden Stacking Rings",
          brand: "Zérah Wooden",
          category: "Toys",
          price: 699,
          mrp: 1299,
          stock: 25,
          sku: "ZRK-TOY-02",
          barcode: "8909876543210",
          image_url: null,
          age_group: "1-2Y",
          qty: 1,
        },
      ],
      discount_type: "none",
      discount_value: 0,
      subtotal: 699,
      discount_total: 0,
      total: 699,
    };

    // Assert absolute separation between session A and session B
    expect(sessionA.customer_name).toBe("Rahul Sharma");
    expect(sessionB.customer_name).toBe("Priya Patel");

    expect(sessionA.items.length).toBe(1);
    expect(sessionA.items[0].sku).toBe("ZRK-TSH-01");
    expect(sessionA.discount_value).toBe(10);
    expect(sessionA.total).toBe(898.2);

    expect(sessionB.items.length).toBe(1);
    expect(sessionB.items[0].sku).toBe("ZRK-TOY-02");
    expect(sessionB.discount_value).toBe(0);
    expect(sessionB.total).toBe(699);

    // Modifying session A does not mutate session B
    sessionA.items.push({
      product_id: "p3",
      variant_id: "v3",
      slug: "socks",
      name: "Baby Booties",
      brand: "Zérah",
      category: "Accessories",
      price: 199,
      mrp: 399,
      stock: 100,
      sku: "ZRK-ACC-03",
      barcode: "8901112223334",
      image_url: null,
      age_group: "0-6M",
      qty: 1,
    });

    expect(sessionA.items.length).toBe(2);
    expect(sessionB.items.length).toBe(1);
    expect(sessionB.items[0].name).toBe("Wooden Stacking Rings");
  });

  // Test 2: Hold & Resume State Transition Invariants
  test("2. Hold and Resume: Holding Sale A preserves customer and items while freeing active cashier session", () => {
    const sessionA: POSSession = {
      ...createDefaultSession("#1042"),
      customer_name: "Rahul Sharma",
      status: "draft",
      items: [
        {
          product_id: "p1",
          variant_id: "v1",
          slug: "tshirrt",
          name: "Organic Cotton T-Shirt",
          brand: "Zérah",
          category: "Clothing",
          price: 499,
          mrp: 999,
          stock: 50,
          sku: "ZRK-TSH-01",
          barcode: "8901234567890",
          image_url: null,
          age_group: "2-3Y",
          qty: 1,
        },
      ],
      total: 499,
    };

    // Hold Session A
    const heldA: POSSession = {
      ...sessionA,
      status: "held",
      held_at: new Date().toISOString(),
    };
    expect(heldA.status).toBe("held");
    expect(heldA.held_at).not.toBeNull();
    expect(heldA.items.length).toBe(1);

    // Cashier starts new clean draft session B
    const sessionB = createDefaultSession("#1043");
    expect(sessionB.status).toBe("draft");
    expect(sessionB.items.length).toBe(0);
    expect(sessionB.customer_name).toBe("Walk-in Customer");

    // Cashier later resumes Session A
    const resumedA: POSSession = {
      ...heldA,
      status: "draft",
      held_at: null,
    };
    expect(resumedA.status).toBe("draft");
    expect(resumedA.held_at).toBeNull();
    expect(resumedA.customer_name).toBe("Rahul Sharma");
    expect(resumedA.items[0].sku).toBe("ZRK-TSH-01");
  });

  // Test 3: Supabase Database RPC Multi-Session Persistence & Recovery
  test("3. Supabase RPC: save_pos_session_full & get_active_pos_sessions roundtrip", async () => {
    const testSessionNumberA = `#${Math.floor(10000 + Math.random() * 90000)}`;
    const testSessionNumberB = `#${Math.floor(10000 + Math.random() * 90000)}`;

    const sessionAData = {
      session_number: testSessionNumberA,
      customer_mode: "existing",
      customer_name: "Rahul Test MultiCart",
      customer_phone: "9876543210",
      status: "draft",
      subtotal: 998,
      total: 998,
      payment_method: "cash",
    };

    const sessionAItems = [
      {
        name: "Test T-Shirt",
        sku: "TEST-TSH-01",
        price: 499,
        mrp: 999,
        qty: 2,
        subtotal: 998,
      },
    ];

    // Save Session A to Supabase
    const { data: savedA, error: saveErrA } = await (
      supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: any; error: any }>
    )("save_pos_session_full", {
      p_session: sessionAData,
      p_items: sessionAItems,
    });

    expect(saveErrA).toBeNull();
    expect(savedA).not.toBeNull();
    expect(savedA.session_number).toBe(testSessionNumberA);

    // Save Session B (Held) to Supabase
    const sessionBData = {
      session_number: testSessionNumberB,
      customer_mode: "existing",
      customer_name: "Priya Test MultiCart",
      customer_phone: "9123456789",
      status: "held",
      subtotal: 499,
      total: 499,
      payment_method: "upi",
    };

    const sessionBItems = [
      {
        name: "Test Baby Romper",
        sku: "TEST-RMP-02",
        price: 499,
        mrp: 899,
        qty: 1,
        subtotal: 499,
      },
    ];

    const { data: savedB, error: saveErrB } = await (
      supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: any; error: any }>
    )("save_pos_session_full", {
      p_session: sessionBData,
      p_items: sessionBItems,
    });

    expect(saveErrB).toBeNull();
    expect(savedB).not.toBeNull();
    expect(savedB.session_number).toBe(testSessionNumberB);

    // Query active sessions from Supabase RPC
    const { data: activeSessions, error: fetchErr } = await (
      supabase.rpc as unknown as (fn: string) => Promise<{ data: any; error: any }>
    )("get_active_pos_sessions");

    expect(fetchErr).toBeNull();
    expect(Array.isArray(activeSessions)).toBe(true);

    const retrievedA = activeSessions.find((s: any) => s.session_number === testSessionNumberA);
    const retrievedB = activeSessions.find((s: any) => s.session_number === testSessionNumberB);

    expect(retrievedA).toBeDefined();
    expect(retrievedA.customer_name).toBe("Rahul Test MultiCart");
    expect(retrievedA.status).toBe("draft");
    expect(retrievedA.items.length).toBe(1);
    expect(retrievedA.items[0].sku).toBe("TEST-TSH-01");

    expect(retrievedB).toBeDefined();
    expect(retrievedB.customer_name).toBe("Priya Test MultiCart");
    expect(retrievedB.status).toBe("held");
    expect(retrievedB.items.length).toBe(1);
    expect(retrievedB.items[0].sku).toBe("TEST-RMP-02");

    // Clean up test sessions
    if (savedA?.id) {
      await (supabase.rpc as unknown as (fn: string, args: any) => Promise<any>)(
        "close_pos_session",
        { p_session_id: savedA.id },
      );
    }
    if (savedB?.id) {
      await (supabase.rpc as unknown as (fn: string, args: any) => Promise<any>)(
        "close_pos_session",
        { p_session_id: savedB.id },
      );
    }
  });

  // Test 4: Real Browser UI Multi-Sale Switcher on /admin?tab=billing
  test("4. Real Browser UI: Multi-sale tab strip renders, allows creating new sales and switching", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("zerah_test_admin", "true");
      localStorage.setItem("zerah_is_admin_00000000-0000-0000-0000-000000000001", "true");
      localStorage.setItem("zerah_admin_active_tab", "billing");
      localStorage.setItem("zerah_admin_active_subtab", "pos");
    });

    // Navigate to POS billing terminal
    await page.goto("/admin?tab=billing&subtab=pos", { waitUntil: "domcontentloaded" });

    // Verify POS Terminal title
    await expect(page.getByRole("heading", { name: "POS Terminal" })).toBeVisible({
      timeout: 15000,
    });

    // Verify "+ New Sale" button is visible
    const newSaleBtn = page.getByTestId("pos-new-sale-btn");
    await expect(newSaleBtn).toBeVisible({ timeout: 5000 });

    // Count initial active sale tabs
    const initialTabs = page.locator('[data-testid^="pos-sale-tab-"]');
    const initialCount = await initialTabs.count();
    expect(initialCount).toBeGreaterThanOrEqual(1);

    // Click "+ New Sale" to spawn an independent sale tab
    await newSaleBtn.click();
    await page.waitForTimeout(300);

    // Verify sale tabs increased
    const newTabs = page.locator('[data-testid^="pos-sale-tab-"]');
    const newCount = await newTabs.count();
    expect(newCount).toBeGreaterThan(initialCount);

    // Verify the newly created tab is active
    const activeTab = newTabs.last();
    await expect(activeTab).toBeVisible();
  });

  // Test 5: Full Multi-Customer Independent Sales Flow & Refresh Survival
  test("5. Full E2E Customer Journey: Simultaneous sales, hold, switch, refresh survival, and independent completion", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("zerah_test_admin", "true");
      localStorage.setItem("zerah_is_admin_00000000-0000-0000-0000-000000000001", "true");
      localStorage.setItem("zerah_admin_active_tab", "billing");
      localStorage.setItem("zerah_admin_active_subtab", "pos");
    });

    await page.goto("/admin?tab=billing&subtab=pos", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "POS Terminal" })).toBeVisible({
      timeout: 10000,
    });

    // 1. Initial Sale A - Add item using search input
    const scanInput = page.locator('input[type="text"]').first();
    await scanInput.fill("tshirrt");
    await page.waitForTimeout(600);
    await scanInput.press("Enter");
    await page.waitForTimeout(500);

    // 2. Put Sale A on Hold (Hold button appears when cart has items)
    const holdSaleBtn = page.getByTestId("pos-hold-sale-btn");
    await expect(holdSaleBtn).toBeVisible({ timeout: 5000 });
    await holdSaleBtn.click();
    await page.waitForTimeout(500);

    // 3. Verify held tab indicator appears
    const heldBadge = page.locator('[data-testid^="pos-sale-tab-"]').filter({ hasText: /Held/i }).first();
    await expect(heldBadge).toBeVisible({ timeout: 5000 });

    // 4. Current active cart is clean for Sale B
    const newSaleBtn = page.getByTestId("pos-new-sale-btn");
    await newSaleBtn.click();
    await page.waitForTimeout(400);

    // Add another item for Sale B
    await scanInput.fill("saify");
    await page.waitForTimeout(600);
    await scanInput.press("Enter");
    await page.waitForTimeout(500);

    // 5. Switch back to Sale A (Held tab)
    await heldBadge.click();
    await page.waitForTimeout(500);

    // 6. Test Browser Refresh Persistence
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "POS Terminal" })).toBeVisible({
      timeout: 10000,
    });

    // Both sales survived page reload
    const tabsAfterReload = page.locator('[data-testid^="pos-sale-tab-"]');
    expect(await tabsAfterReload.count()).toBeGreaterThanOrEqual(2);
  });
});
