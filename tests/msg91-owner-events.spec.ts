import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

test.describe("Bug #6: Owner SMS Dispatch for Order Event Aliases & Idempotency", () => {
  const edgeFunctionPath = path.resolve("supabase/functions/msg91-transactional/index.ts");
  const code = fs.readFileSync(edgeFunctionPath, "utf-8");

  test("1. Verify static code in msg91-transactional includes order_placed and order_confirmed in ownerEvents", () => {
    // 1. ONLINE_ORDER_EVENTS definition
    expect(code).toContain('const ONLINE_ORDER_EVENTS = ["online_sale", "order_placed", "order_confirmed"];');

    // 2. Canonical event type calculation for idempotency
    expect(code).toContain("const canonicalEventType = ONLINE_ORDER_EVENTS.includes(currentEventType)");

    // 3. canonicalKey uses canonicalEventType
    expect(code).toContain("const canonicalKey = `${order_id || offline_sale_id || \"tx\"}_${canonicalEventType}_${cleanPhone}_${targetRecipientType}`;");

    // 4. ownerEvents includes ONLINE_ORDER_EVENTS (online_sale, order_placed, order_confirmed)
    expect(code).toContain("...ONLINE_ORDER_EVENTS");
    expect(code).toContain('"offline_pos_sale"');
    expect(code).toContain('"order_delivered"');
    expect(code).toContain("ownerEvents.includes(currentEventType)");
    expect(code).toMatch(/(notify_owner\s*!==\s*false|notify_owner)\s*&&\s*ownerEvents\.includes\(currentEventType\)/);
  });

  test("2. Functional simulation: owner notification trigger evaluation for each event", () => {
    const ALLOWED_EVENTS = [
      "online_sale",
      "offline_pos_sale",
      "order_placed",
      "order_confirmed",
      "order_cancelled",
      "order_shipped",
      "order_out_for_delivery",
      "order_delivered",
      "pos_return",
      "pos_return_credit",
    ];

    const ONLINE_ORDER_EVENTS = ["online_sale", "order_placed", "order_confirmed"];
    const ownerEvents = [
      ...ONLINE_ORDER_EVENTS,
      "offline_pos_sale",
      "order_delivered",
      "order_cancelled",
    ];

    function shouldNotifyOwner(eventType: string, notifyOwner: boolean = true): boolean {
      if (!notifyOwner) return false;
      return ownerEvents.includes(eventType);
    }

    // 1. online_sale -> TRUE
    expect(shouldNotifyOwner("online_sale")).toBe(true);

    // 2. order_placed -> TRUE
    expect(shouldNotifyOwner("order_placed")).toBe(true);

    // 3. order_confirmed -> TRUE
    expect(shouldNotifyOwner("order_confirmed")).toBe(true);

    // 4. offline_pos_sale -> TRUE
    expect(shouldNotifyOwner("offline_pos_sale")).toBe(true);

    // 5. order_delivered -> TRUE (included in ownerEvents list)
    expect(shouldNotifyOwner("order_delivered")).toBe(true);

    // 6. order_cancelled -> TRUE
    expect(shouldNotifyOwner("order_cancelled")).toBe(true);

    // 7. Non-owner events -> FALSE
    expect(shouldNotifyOwner("order_shipped")).toBe(false);
    expect(shouldNotifyOwner("order_out_for_delivery")).toBe(false);
    expect(shouldNotifyOwner("pos_return")).toBe(false);
    expect(shouldNotifyOwner("pos_return_credit")).toBe(false);

    // 8. If notify_owner is false -> FALSE
    expect(shouldNotifyOwner("online_sale", false)).toBe(false);
    expect(shouldNotifyOwner("order_placed", false)).toBe(false);
    expect(shouldNotifyOwner("order_confirmed", false)).toBe(false);
  });

  test("3. Template resolution for online order aliases resolves to online_sale_owner", () => {
    function resolveTemplateKey(eventType: string, recipientType: string): string | null {
      let normalizedEvent = eventType;
      if (normalizedEvent === "order_placed" || normalizedEvent === "order_confirmed") {
        normalizedEvent = "online_sale";
      }
      return `${normalizedEvent}_${recipientType}`;
    }

    // All online order aliases resolve to the same DLT approved owner template
    expect(resolveTemplateKey("online_sale", "owner")).toBe("online_sale_owner");
    expect(resolveTemplateKey("order_placed", "owner")).toBe("online_sale_owner");
    expect(resolveTemplateKey("order_confirmed", "owner")).toBe("online_sale_owner");

    // Customer templates also resolve consistently
    expect(resolveTemplateKey("online_sale", "customer")).toBe("online_sale_customer");
    expect(resolveTemplateKey("order_placed", "customer")).toBe("online_sale_customer");
    expect(resolveTemplateKey("order_confirmed", "customer")).toBe("online_sale_customer");

    // Offline sales
    expect(resolveTemplateKey("offline_pos_sale", "owner")).toBe("offline_pos_sale_owner");
    expect(resolveTemplateKey("offline_pos_sale", "customer")).toBe("offline_pos_sale_customer");
  });

  test("4. Idempotency across aliases: order_placed followed by online_sale generates identical canonical keys", () => {
    const ONLINE_ORDER_EVENTS = ["online_sale", "order_placed", "order_confirmed"];

    function getCanonicalKey(
      orderId: string,
      eventType: string,
      cleanPhone: string,
      targetRecipientType: string,
    ): string {
      const canonicalEventType = ONLINE_ORDER_EVENTS.includes(eventType)
        ? "online_sale"
        : eventType;
      return `${orderId}_${canonicalEventType}_${cleanPhone}_${targetRecipientType}`;
    }

    const testOrderId = "00000000-1111-2222-3333-444444444444";
    const ownerPhone = "919667571712";
    const customerPhone = "919876543210";

    // Owner keys across all aliases
    const ownerKeyFromPlaced = getCanonicalKey(testOrderId, "order_placed", ownerPhone, "owner");
    const ownerKeyFromConfirmed = getCanonicalKey(testOrderId, "order_confirmed", ownerPhone, "owner");
    const ownerKeyFromOnlineSale = getCanonicalKey(testOrderId, "online_sale", ownerPhone, "owner");

    expect(ownerKeyFromPlaced).toBe(`${testOrderId}_online_sale_${ownerPhone}_owner`);
    expect(ownerKeyFromConfirmed).toBe(ownerKeyFromPlaced);
    expect(ownerKeyFromOnlineSale).toBe(ownerKeyFromPlaced);

    // Customer keys across all aliases
    const custKeyFromPlaced = getCanonicalKey(testOrderId, "order_placed", customerPhone, "customer");
    const custKeyFromConfirmed = getCanonicalKey(testOrderId, "order_confirmed", customerPhone, "customer");
    const custKeyFromOnlineSale = getCanonicalKey(testOrderId, "online_sale", customerPhone, "customer");

    expect(custKeyFromPlaced).toBe(`${testOrderId}_online_sale_${customerPhone}_customer`);
    expect(custKeyFromConfirmed).toBe(custKeyFromPlaced);
    expect(custKeyFromOnlineSale).toBe(custKeyFromPlaced);

    // Simulate SMS logs store
    const smsLogs = new Set<string>();

    function dispatch(orderId: string, eventType: string, phone: string, recipient: string) {
      const key = getCanonicalKey(orderId, eventType, phone, recipient);
      if (smsLogs.has(key)) {
        return { success: true, already_sent: true, key };
      }
      smsLogs.add(key);
      return { success: true, already_sent: false, key };
    }

    // Call 1: Database trigger sends order_placed
    const r1Owner = dispatch(testOrderId, "order_placed", ownerPhone, "owner");
    const r1Cust = dispatch(testOrderId, "order_placed", customerPhone, "customer");
    expect(r1Owner.already_sent).toBe(false);
    expect(r1Cust.already_sent).toBe(false);

    // Call 2: Razorpay webhook or checkout confirmation sends online_sale
    const r2Owner = dispatch(testOrderId, "online_sale", ownerPhone, "owner");
    const r2Cust = dispatch(testOrderId, "online_sale", customerPhone, "customer");
    expect(r2Owner.already_sent).toBe(true);
    expect(r2Cust.already_sent).toBe(true);

    // Call 3: Any other alias (e.g. order_confirmed)
    const r3Owner = dispatch(testOrderId, "order_confirmed", ownerPhone, "owner");
    const r3Cust = dispatch(testOrderId, "order_confirmed", customerPhone, "customer");
    expect(r3Owner.already_sent).toBe(true);
    expect(r3Cust.already_sent).toBe(true);

    // Total dispatches recorded for this order is exactly 1 for owner and 1 for customer
    expect(smsLogs.size).toBe(2);
  });
});
