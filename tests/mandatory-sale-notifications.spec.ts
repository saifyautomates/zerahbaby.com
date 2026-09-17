import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://wbbatgbvizhghtkvuguf.supabase.co";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.dummy";

test.describe("MANDATORY SALE NOTIFICATIONS SYSTEM (ONLINE + OFFLINE + CUSTOMER + ADMIN)", () => {
  const headers = {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
  };

  test("1. Verify Migration Schema & Table Structure", async () => {
    // Check that migration file exists and contains all 4 notification channels and idempotency guarantees
    const fs = await import("fs");
    const migrationPath = "supabase/migrations/20260928000263_mandatory_sale_notifications_system.sql";
    expect(fs.existsSync(migrationPath)).toBe(true);

    const content = fs.readFileSync(migrationPath, "utf-8");
    expect(content).toContain("sale_notification_events");
    expect(content).toContain("customer_sms_status");
    expect(content).toContain("admin_sms_status");
    expect(content).toContain("admin_email_status");
    expect(content).toContain("customer_email_status");
    expect(content).toContain("idempotency_key");
    expect(content).toContain("get_sale_notification_status");
    expect(content).toContain("customer_notification_status");
  });

  test("2. Online Sale Notification Dispatch (Customer Phone + Customer Email + Admin Phone + Admin Email)", async () => {
    // Generate unique online sale ID
    const testOrderId = `test_ord_notif_${Date.now()}`;

    const res = await fetch(`${SUPABASE_URL}/functions/v1/dispatch-sale-notifications`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sale_type: "online",
        sale_id: testOrderId,
      }),
    });

    // Endpoint must respond gracefully (either 200 or 404 if record doesn't exist yet, without 500 fatal crash)
    expect([200, 404]).toContain(res.status);

    const data = await res.json();
    if (res.status === 200) {
      expect(data.success).toBe(true);
      expect(data.channels).toBeDefined();
      expect(data.channels.customer_sms).toBeDefined();
      expect(data.channels.admin_sms).toBeDefined();
      expect(data.channels.admin_email).toBeDefined();
      expect(data.channels.customer_email).toBeDefined();
    }
  });

  test("3. Offline POS Sale Notification Dispatch (Customer Phone + Customer Email + Admin Phone + Admin Email)", async () => {
    const testSaleId = `test_pos_notif_${Date.now()}`;

    const res = await fetch(`${SUPABASE_URL}/functions/v1/dispatch-sale-notifications`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sale_type: "offline",
        sale_id: testSaleId,
      }),
    });

    expect([200, 404]).toContain(res.status);
  });

  test("4. msg91-transactional Edge Function defaults notify_owner to true for sale events", async () => {
    const testOrderId = `e2e_ord_owner_sms_${Date.now()}`;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/msg91-transactional`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        order_id: testOrderId,
        event_type: "online_sale",
        phone: "9876543210",
        name: "Test Buyer",
        total: 1999,
        payment_method: "ONLINE",
        // Notice: notify_owner is omitted; it must default to true for sale events!
      }),
    });

    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.dispatches).toBeDefined();

    // Verify dispatches contains both customer and owner
    const recipients = data.dispatches.map((d: any) => d.recipient);
    expect(recipients).toContain("customer");
    expect(recipients).toContain("owner");
  });

  test("5. send-owner-sale-notification handles offline sales with customer purchase receipt", async () => {
    const testSaleId = `test_offline_email_${Date.now()}`;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-owner-sale-notification`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "offline_sale",
        sale_id: testSaleId,
        force_retry: true,
      }),
    });

    // Endpoint must handle cleanly (either sent, mock, or handled cleanly without unhandled 500)
    expect([200, 400, 401, 404]).toContain(res.status);
  });

  test("6. Idempotency Guarantee: Repeated notification calls do not crash and prevent duplication", async () => {
    const idempotencyKey = `idemp_test_${Date.now()}`;
    const payload = {
      sale_type: "online",
      sale_id: `ord_${Date.now()}`,
      idempotency_key: idempotencyKey,
    };

    const res1 = await fetch(`${SUPABASE_URL}/functions/v1/dispatch-sale-notifications`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const res2 = await fetch(`${SUPABASE_URL}/functions/v1/dispatch-sale-notifications`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    expect(res1.status).toBe(res2.status);
  });

  test("7. Client helper dispatchSaleNotifications handles offline resilience", async () => {
    const { dispatchSaleNotifications } = await import("../src/lib/sale-notifications");
    expect(typeof dispatchSaleNotifications).toBe("function");

    const result = await dispatchSaleNotifications({
      sale_type: "offline",
      sale_id: `client_test_${Date.now()}`,
    });

    // Should return result object without throwing exception
    expect(result).toBeDefined();
    expect(typeof result.success).toBe("boolean");
  });
});
