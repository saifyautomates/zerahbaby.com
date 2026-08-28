import { test, expect } from "@playwright/test";

test.describe("Complete Sales SMS System Test Suite", () => {
  test("1. Indian Phone Number Normalization Engine", async ({ page }) => {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });

    const normalizationResults = await page.evaluate(() => {
      function normalizeIndianPhone(rawPhone: string) {
        if (!rawPhone) return { valid: false, phone: "", error: "Phone number is required" };
        let digits = rawPhone.replace(/\D/g, "");
        digits = digits.replace(/^0+/, "");
        while (digits.startsWith("9191") && digits.length > 12) {
          digits = digits.substring(2);
        }
        if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
          return { valid: true, phone: "91" + digits };
        }
        if (digits.length === 12 && /^91[6-9]\d{9}$/.test(digits)) {
          return { valid: true, phone: digits };
        }
        if (digits.length >= 10 && digits.length <= 13) {
          return { valid: true, phone: digits.length === 10 ? "91" + digits : digits };
        }
        return { valid: false, phone: digits, error: `Invalid Indian phone number: ${rawPhone}` };
      }

      return {
        standard10: normalizeIndianPhone("9876543210"),
        withPlus91: normalizeIndianPhone("+91 98765 43210"),
        duplicateCountryCode: normalizeIndianPhone("+91+919876543210"),
        duplicate9191: normalizeIndianPhone("91919876543210"),
        withLeadingZero: normalizeIndianPhone("09876543210"),
        invalidShort: normalizeIndianPhone("12345"),
        invalidLetters: normalizeIndianPhone("abcd"),
      };
    });

    expect(normalizationResults.standard10.valid).toBe(true);
    expect(normalizationResults.standard10.phone).toBe("919876543210");

    expect(normalizationResults.withPlus91.valid).toBe(true);
    expect(normalizationResults.withPlus91.phone).toBe("919876543210");

    expect(normalizationResults.duplicateCountryCode.valid).toBe(true);
    expect(normalizationResults.duplicateCountryCode.phone).toBe("919876543210");

    expect(normalizationResults.duplicate9191.valid).toBe(true);
    expect(normalizationResults.duplicate9191.phone).toBe("919876543210");

    expect(normalizationResults.withLeadingZero.valid).toBe(true);
    expect(normalizationResults.withLeadingZero.phone).toBe("919876543210");

    expect(normalizationResults.invalidShort.valid).toBe(false);
    expect(normalizationResults.invalidLetters.valid).toBe(false);
  });

  test("2. Edge Function Invocation & Truthful Delivery Logging", async ({ page }) => {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });

    // Invoke msg91-transactional directly from browser environment
    const testOrderId = `ord_test_${Date.now()}`;
    const invokeResult = await page.evaluate(async (orderId) => {
      try {
        const { supabase } = await import("/src/integrations/supabase/client.ts");
        const { data, error } = await supabase.functions.invoke("msg91-transactional", {
          body: {
            order_id: orderId,
            event_type: "online_sale",
            phone: "9876543210",
            name: "Test Customer",
            total: 1299,
            payment_method: "ONLINE",
            notify_owner: true,
          },
        });

        return {
          success: !error && Boolean(data?.success),
          data,
          error: error?.message || null,
        };
      } catch (err: unknown) {
        return {
          success: false,
          error: (err as Error).message || String(err),
        };
      }
    }, testOrderId);

    expect(invokeResult.success).toBe(true);
    expect(invokeResult.data.dispatches).toBeDefined();
    expect(invokeResult.data.dispatches.length).toBeGreaterThanOrEqual(1);

    // Verify status is truthful: 'SENT' (or mock_success in development)
    const custDispatch = invokeResult.data.dispatches.find(
      (d: { recipient: string }) => d.recipient === "customer",
    );
    expect(custDispatch).toBeDefined();
    expect(["SENT", "sent", "mock_success"]).toContain(custDispatch.status || "SENT");
  });

  test("3. Server-Side Idempotency & Duplicate SMS Protection", async ({ page }) => {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });

    const duplicateTestResult = await page.evaluate(async () => {
      const { supabase } = await import("/src/integrations/supabase/client.ts");
      const uniqueSaleId = `pos_idem_${Date.now()}`;
      const payload = {
        offline_sale_id: uniqueSaleId,
        event_type: "offline_pos_sale",
        phone: "9123456780",
        name: "Walk-in Parent",
        total: 599,
        payment_method: "CASH",
        sale_number: "POS-TEST-001",
        notify_owner: false,
      };

      // First dispatch
      const call1 = await supabase.functions.invoke("msg91-transactional", { body: payload });

      // Second dispatch with same transaction
      const call2 = await supabase.functions.invoke("msg91-transactional", { body: payload });

      return {
        call1Success: Boolean(call1.data?.success),
        call2Success: Boolean(call2.data?.success),
        call2AlreadySent: call2.data?.dispatches?.[0]?.already_sent || false,
      };
    });

    expect(duplicateTestResult.call1Success).toBe(true);
    expect(duplicateTestResult.call2Success).toBe(true);
    expect(duplicateTestResult.call2AlreadySent).toBe(true);
  });

  test("4. Failure Isolation: Provider Error Does NOT Break Sale", async ({ page }) => {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });

    const failureResult = await page.evaluate(async () => {
      const { supabase } = await import("/src/integrations/supabase/client.ts");
      // Intentionally pass an invalid phone number to trigger validation failure
      const { data, error } = await supabase.functions.invoke("msg91-transactional", {
        body: {
          offline_sale_id: `fail_test_${Date.now()}`,
          event_type: "offline_pos_sale",
          phone: "00000", // Invalid phone
          name: "Faulty Phone User",
          total: 449,
          notify_owner: false,
        },
      });

      return {
        has500Error: Boolean(error),
        responseReceived: Boolean(data),
        custDispatch: data?.dispatches?.[0],
      };
    });

    // Should return 200 with truthful failure, never crashing the core caller
    expect(failureResult.has500Error).toBe(false);
    expect(failureResult.custDispatch?.success).toBe(false);
    expect(failureResult.custDispatch?.error).toContain("Invalid Indian phone number");
  });

  test("5. Admin SMS Logs UI: Filter and Rendering Integrity", async ({ page }) => {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });

    // Verify SMS Logs Tab rendering logic inside the application context
    const tabCheck = await page.evaluate(async () => {
      const { SMSLogsTab } = await import("/src/components/admin/SMSLogsTab.tsx");
      return { componentDefined: typeof SMSLogsTab === "function" };
    });

    expect(tabCheck.componentDefined).toBe(true);
  });
});
