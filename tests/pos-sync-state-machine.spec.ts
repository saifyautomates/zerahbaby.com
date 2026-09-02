import { test, expect } from "@playwright/test";

test.describe("POS State Machine & Offline Sync Architecture Verification", () => {
  test("1. Explicit State Machine: Separates transaction_status from sync_status", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const result = await page.evaluate(async () => {
      const { queueOfflineSale, updateQueuedSaleStatus, getAllQueuedSales, deleteQueuedSale } =
        await import("/src/lib/offline-sync-engine.ts");

      const opId = `test_sm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const idemKey = `pos_idem_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

      // 1. Initial State: PENDING_SYNC / PENDING_CONFIRMATION
      await queueOfflineSale({
        id: opId,
        operation_id: opId,
        idempotency_key: idemKey,
        customer_name: "State Machine Test Customer",
        customer_phone: "9876543210",
        customer_email: "",
        payment_method: "cash",
        notes: "Verifying state machine",
        discount_type: "none",
        discount_value: 0,
        customer_id: null,
        items: [{ product_slug: "test-slug", qty: 1, custom_price: 250 }],
        total: 250,
        subtotal: 250,
        discount: 0,
        token_number: 1,
        token_date: "2026-09-03",
        sale_number: "POS-OFF-000001",
        created_at: new Date().toISOString(),
      });

      let items = await getAllQueuedSales();
      const initial = items.find((i) => i.operation_id === opId);

      // 2. Transition: SYNCING
      await updateQueuedSaleStatus(opId, "SYNCING");
      items = await getAllQueuedSales();
      const syncing = items.find((i) => i.operation_id === opId);

      // 3. Transition: SYNCED with server attributes
      await updateQueuedSaleStatus(opId, "SYNCED", undefined, {
        server_sale_id: "srv-uuid-12345",
        server_sale_number: "POS-2609-00099",
        transaction_status: "COMPLETED",
      });
      items = await getAllQueuedSales();
      const synced = items.find((i) => i.operation_id === opId);

      // 4. Clean up
      await deleteQueuedSale(opId);

      return {
        initialStatus: initial?.status,
        initialTxStatus: initial?.transaction_status,
        syncingStatus: syncing?.status,
        syncedStatus: synced?.status,
        syncedTxStatus: synced?.transaction_status,
        syncedServerId: synced?.server_sale_id,
        syncedServerNumber: synced?.server_sale_number,
      };
    });

    expect(result.initialStatus).toBe("PENDING_SYNC");
    expect(result.initialTxStatus).toBe("PENDING_CONFIRMATION");
    expect(result.syncingStatus).toBe("SYNCING");
    expect(result.syncedStatus).toBe("SYNCED");
    expect(result.syncedTxStatus).toBe("COMPLETED");
    expect(result.syncedServerId).toBe("srv-uuid-12345");
    expect(result.syncedServerNumber).toBe("POS-2609-00099");
  });

  test("2. Reconcile Local Queue with Cloud Sales", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const result = await page.evaluate(async () => {
      const {
        queueOfflineSale,
        reconcileLocalQueueWithCloudSales,
        getAllQueuedSales,
        deleteQueuedSale,
      } = await import("/src/lib/offline-sync-engine.ts");

      const opId = `test_rec_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const idemKey = `pos_idem_rec_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

      await queueOfflineSale({
        id: opId,
        operation_id: opId,
        idempotency_key: idemKey,
        customer_name: "Reconciliation Customer",
        customer_phone: "9123456780",
        customer_email: "",
        payment_method: "cash",
        notes: "Reconciliation test",
        discount_type: "none",
        discount_value: 0,
        customer_id: null,
        items: [{ product_slug: "test-slug", qty: 2, custom_price: 150 }],
        total: 300,
        subtotal: 300,
        discount: 0,
        token_number: 2,
        token_date: "2026-09-03",
        sale_number: "POS-OFF-REC001",
        created_at: new Date().toISOString(),
      });

      // Simulate cloud sales returned from Supabase containing the committed sale
      const mockCloudSales = [
        {
          id: "cloud-sale-uuid-777",
          sale_number: "POS-2609-00777",
          idempotency_key: idemKey,
        },
      ];

      const reconciledCount = await reconcileLocalQueueWithCloudSales(mockCloudSales);

      const items = await getAllQueuedSales();
      const updated = items.find((i) => i.operation_id === opId);

      await deleteQueuedSale(opId);

      return {
        reconciledCount,
        status: updated?.status,
        txStatus: updated?.transaction_status,
        serverId: updated?.server_sale_id,
        serverNumber: updated?.server_sale_number,
      };
    });

    expect(result.reconciledCount).toBe(1);
    expect(result.status).toBe("SYNCED");
    expect(result.txStatus).toBe("COMPLETED");
    expect(result.serverId).toBe("cloud-sale-uuid-777");
    expect(result.serverNumber).toBe("POS-2609-00777");
  });

  test("3. Local Deletion Prunes Queued Sale Without Error", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const result = await page.evaluate(async () => {
      const { queueOfflineSale, deleteQueuedSale, getAllQueuedSales } =
        await import("/src/lib/offline-sync-engine.ts");

      const opId = `off_${Date.now()}_deltest`;
      await queueOfflineSale({
        id: opId,
        operation_id: opId,
        idempotency_key: `pos_del_${Date.now()}`,
        customer_name: "Delete Test",
        customer_phone: "9999999999",
        customer_email: "",
        payment_method: "cash",
        notes: "To be pruned",
        discount_type: "none",
        discount_value: 0,
        customer_id: null,
        items: [{ product_slug: "test-slug", qty: 1, custom_price: 100 }],
        total: 100,
        subtotal: 100,
        discount: 0,
        token_number: 3,
        token_date: "2026-09-03",
        sale_number: "POS-OFF-DEL01",
        created_at: new Date().toISOString(),
      });

      const beforeDelete = await getAllQueuedSales();
      const existed = beforeDelete.some((i) => i.operation_id === opId);

      const deleted = await deleteQueuedSale(opId);
      const afterDelete = await getAllQueuedSales();
      const existsAfter = afterDelete.some((i) => i.operation_id === opId);

      return { existed, deleted, existsAfter };
    });

    expect(result.existed).toBe(true);
    expect(result.deleted).toBe(true);
    expect(result.existsAfter).toBe(false);
  });
});
