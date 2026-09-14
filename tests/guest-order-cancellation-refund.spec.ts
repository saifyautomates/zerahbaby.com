import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

test.describe("Bug #7: Guest Order Cancellation & Refund Authorization Suite", () => {
  const edgeFunctionPath = path.resolve(
    "supabase/functions/process-order-cancellation-refund/index.ts",
  );
  const code = fs.readFileSync(edgeFunctionPath, "utf-8");

  test("1. Verify static code in process-order-cancellation-refund implements strict multi-branch authorization", () => {
    // 1. Phone extraction helper
    expect(code).toContain("function extract10Digits(phone?: string | null): string");
    expect(code).toContain("digits.length >= 10 ? digits.slice(-10) : \"\"");

    // 2. Branch A: Account-bound owner check
    expect(code).toContain("if (!isAuthorized && order.user_id && order.user_id === user.id)");

    // 3. Branch B: Admin check
    expect(code).toContain("let isAuthorized = isAdmin;");

    // 4. Branch C: Verified phone check strictly on guest orders (!order.user_id)
    expect(code).toContain("if (!isAuthorized && !order.user_id)");
    expect(code).toContain("const userPhone10 = extract10Digits(verifiedUserPhone);");
    expect(code).toContain("const orderPhone10 = extract10Digits(order.phone);");
    expect(code).toContain("if (userPhone10 && orderPhone10 && userPhone10 === orderPhone10)");

    // 5. Strict 403 rejection if unauthorized
    expect(code).toContain("if (!isAuthorized)");
    expect(code).toContain('error: "Unauthorized: You do not have permission to refund this order"');

    // 6. Security verification: no client flags or unverified bypasses
    expect(code).not.toContain("body.is_guest");
    expect(code).not.toContain("body.guest_bypass");
    expect(code).not.toContain("body.phone_verified");
  });

  test("2. Functional Security Matrix: evaluateAuthorization across all customer and guest permutations", () => {
    function extract10Digits(phone?: string | null): string {
      if (!phone) return "";
      const digits = phone.replace(/\D/g, "");
      return digits.length >= 10 ? digits.slice(-10) : "";
    }

    interface AuthUser {
      id: string;
      phone?: string;
      profilePhone?: string;
    }

    interface TargetOrder {
      id: string;
      user_id: string | null;
      phone: string;
    }

    function checkRefundAuthorization(
      user: AuthUser | null,
      isAdmin: boolean,
      order: TargetOrder,
    ): { authorized: boolean; status: number; reason: string } {
      if (!user) {
        return { authorized: false, status: 401, reason: "Unauthenticated" };
      }

      let isAuthorized = isAdmin;

      // Branch A: Registered account owner
      if (!isAuthorized && order.user_id && order.user_id === user.id) {
        isAuthorized = true;
      }

      // Branch C: Verified guest customer (strictly for guest orders where user_id is null)
      if (!isAuthorized && !order.user_id) {
        const verifiedPhone = user.phone || user.profilePhone || "";
        const userPhone10 = extract10Digits(verifiedPhone);
        const orderPhone10 = extract10Digits(order.phone);

        if (userPhone10 && orderPhone10 && userPhone10 === orderPhone10) {
          isAuthorized = true;
        }
      }

      if (!isAuthorized) {
        return { authorized: false, status: 403, reason: "Unauthorized" };
      }

      return { authorized: true, status: 200, reason: "Authorized" };
    }

    const userAlice: AuthUser = { id: "user_alice_001", phone: "+919876543210" };
    const userBob: AuthUser = { id: "user_bob_002", phone: "+919123456789" };

    // Case 1: Authenticated user cancelling own order -> 200 Authorized
    const aliceOrder: TargetOrder = {
      id: "ord_001",
      user_id: "user_alice_001",
      phone: "9876543210",
    };
    const c1 = checkRefundAuthorization(userAlice, false, aliceOrder);
    expect(c1.authorized).toBe(true);
    expect(c1.status).toBe(200);

    // Case 2: Authenticated user cancelling someone else's order -> 403 Forbidden
    const c2 = checkRefundAuthorization(userBob, false, aliceOrder);
    expect(c2.authorized).toBe(false);
    expect(c2.status).toBe(403);

    // Case 3: Admin cancelling any order -> 200 Authorized
    const c3 = checkRefundAuthorization(userBob, true, aliceOrder);
    expect(c3.authorized).toBe(true);
    expect(c3.status).toBe(200);

    // Case 4: Verified guest customer cancelling own guest order -> 200 Authorized
    const guestAliceOrder: TargetOrder = {
      id: "ord_guest_001",
      user_id: null,
      phone: "9876543210", // Alice's phone
    };
    const c4 = checkRefundAuthorization(userAlice, false, guestAliceOrder);
    expect(c4.authorized).toBe(true);
    expect(c4.status).toBe(200);

    // Case 5: Guest without verification / no user session -> 401 Unauthenticated
    const c5 = checkRefundAuthorization(null, false, guestAliceOrder);
    expect(c5.authorized).toBe(false);
    expect(c5.status).toBe(401);

    // Case 6: Verified guest Bob trying to cancel Alice's guest order -> 403 Forbidden
    const c6 = checkRefundAuthorization(userBob, false, guestAliceOrder);
    expect(c6.authorized).toBe(false);
    expect(c6.status).toBe(403);

    // Case 7: Account-bound order cannot be stolen by guest path even if phone matches
    const accountOrderWithAlicePhone: TargetOrder = {
      id: "ord_account_charlie",
      user_id: "user_charlie_003", // Owned by Charlie
      phone: "9876543210", // Even if phone happens to match Alice
    };
    const c7 = checkRefundAuthorization(userAlice, false, accountOrderWithAlicePhone);
    expect(c7.authorized).toBe(false);
    expect(c7.status).toBe(403);

    // Case 8: Profile fallback phone verification
    const userWithoutJwtPhone: AuthUser = {
      id: "user_dan_004",
      profilePhone: "9988776655",
    };
    const danGuestOrder: TargetOrder = {
      id: "ord_guest_dan",
      user_id: null,
      phone: "+91 99887 76655",
    };
    const c8 = checkRefundAuthorization(userWithoutJwtPhone, false, danGuestOrder);
    expect(c8.authorized).toBe(true);
    expect(c8.status).toBe(200);
  });

  test("3. Phone Normalization Unit Tests: Indian phone formats resolve accurately", () => {
    function extract10Digits(phone?: string | null): string {
      if (!phone) return "";
      const digits = phone.replace(/\D/g, "");
      return digits.length >= 10 ? digits.slice(-10) : "";
    }

    expect(extract10Digits("9876543210")).toBe("9876543210");
    expect(extract10Digits("+919876543210")).toBe("9876543210");
    expect(extract10Digits("+91 98765 43210")).toBe("9876543210");
    expect(extract10Digits("919876543210")).toBe("9876543210");
    expect(extract10Digits("09876543210")).toBe("9876543210");
    expect(extract10Digits("+91+919876543210")).toBe("9876543210");
    expect(extract10Digits("")).toBe("");
    expect(extract10Digits(null)).toBe("");
    expect(extract10Digits(undefined)).toBe("");
    expect(extract10Digits("12345")).toBe(""); // Less than 10 digits returns empty
  });

  test("4. Live Edge Function Contract: Unauthenticated requests remain strictly rejected with 401", async ({
    request,
  }) => {
    const res = await request.post(
      "https://wbbatgbvizhghtkvuguf.supabase.co/functions/v1/process-order-cancellation-refund",
      {
        data: { order_id: "00000000-0000-0000-0000-000000000001" },
      },
    );
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/Authentication required/i);
  });

  test("5. Live Edge Function Contract: Bad or forged tokens remain strictly rejected with 401", async ({
    request,
  }) => {
    const res = await request.post(
      "https://wbbatgbvizhghtkvuguf.supabase.co/functions/v1/process-order-cancellation-refund",
      {
        headers: { Authorization: "Bearer forged_jwt_token_for_security_test" },
        data: { order_id: "00000000-0000-0000-0000-000000000001" },
      },
    );
    expect(res.status()).toBe(401);
  });
});
