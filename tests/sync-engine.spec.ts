import { test, expect } from "@playwright/test";

test.describe("Global Auto-Sync & Realtime Engine Test Suite", () => {
  test("1. Offline Sync Engine - Daily Token, Queuing & Catalog Caching", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const evalResult = await page.evaluate(async () => {
      try {
        const {
          getNextOfflineToken,
          getTodayISTDateString,
          queueOfflineSale,
          getAllQueuedSales,
          cacheFullCatalog,
          findOfflineProductByCode,
        } = await import("/src/lib/offline-sync-engine.ts");

        // 1. Test IST Date string
        const todayIST = getTodayISTDateString();
        const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(todayIST);

        // 2. Test Offline Token Generation
        const token1 = await getNextOfflineToken();
        const token2 = await getNextOfflineToken();
        const isSequential = token2.number === token1.number + 1;

        // 3. Test Catalog Caching & Offline Lookups
        const testProduct = {
          id: "test-prod-1",
          slug: "test-prod-slug",
          name: "Test Baby Romper",
          barcode: "890987654321",
          sku: "TEST-SKU-01",
          price: 499,
          stock: 10,
        };
        await cacheFullCatalog([testProduct]);
        const matchByBarcode = await findOfflineProductByCode("890987654321");
        const matchBySku = await findOfflineProductByCode("TEST-SKU-01");

        // 4. Test Offline Sale Queuing
        const opId = `test_op_${Date.now()}`;
        await queueOfflineSale({
          id: opId,
          operation_id: opId,
          idempotency_key: `idem_${Date.now()}`,
          customer_name: "Test Customer",
          customer_phone: "9876543210",
          customer_email: "",
          payment_method: "cash",
          notes: "Test sale",
          discount_type: "none",
          discount_value: 0,
          customer_id: null,
          items: [{ product_slug: "test-prod-slug", qty: 1, custom_price: 499 }],
          total: 499,
          subtotal: 499,
          discount: 0,
          token_number: token1.number,
          token_date: token1.date,
          sale_number: "POS-TEST-001",
          created_at: new Date().toISOString(),
        });

        const allSales = await getAllQueuedSales();
        const queuedItem = allSales.find((s) => s.operation_id === opId);

        return {
          success: true,
          isValidDate,
          isSequential,
          matchByBarcodeFound: matchByBarcode?.name === testProduct.name,
          matchBySkuFound: matchBySku?.name === testProduct.name,
          saleQueued: Boolean(queuedItem && queuedItem.status === "PENDING_SYNC"),
        };
      } catch (err: unknown) {
        return {
          success: false,
          error: (err as Error).message || String(err),
        };
      }
    });

    expect(evalResult.success).toBe(true);
    expect(evalResult.isValidDate).toBe(true);
    expect(evalResult.isSequential).toBe(true);
    expect(evalResult.matchByBarcodeFound).toBe(true);
    expect(evalResult.matchBySkuFound).toBe(true);
    expect(evalResult.saleQueued).toBe(true);
  });

  test("2. Realtime Sync Event Bus & Subscription Lifecycle", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const busResult = await page.evaluate(async () => {
      try {
        const { subscribeToRealtimeSync } = await import("/src/lib/realtime-sync.ts");
        let eventReceived = false;
        let receivedTable = "";

        const unsubscribe = subscribeToRealtimeSync((table) => {
          eventReceived = true;
          receivedTable = table;
        });

        // Verify function returns an unsubscribe cleanup function
        const hasUnsub = typeof unsubscribe === "function";
        unsubscribe();

        return {
          success: true,
          hasUnsub,
        };
      } catch (err: unknown) {
        return {
          success: false,
          error: (err as Error).message || String(err),
        };
      }
    });

    expect(busResult.success).toBe(true);
    expect(busResult.hasUnsub).toBe(true);
  });

  test("3. Storefront Live Category & Product Cards Hydration", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle(/Zerah Baby And Kid'?s/i);

    // Verify categories loaded
    const categoryCards = page.locator("[data-card], .group\\/cat");
    await expect(categoryCards.first()).toBeAttached({ timeout: 10000 });
    expect(await categoryCards.count()).toBeGreaterThanOrEqual(1);

    // Verify shop now links
    const shopLinks = page.locator('a[href^="/shop"]');
    expect(await shopLinks.count()).toBeGreaterThanOrEqual(1);
  });
});
