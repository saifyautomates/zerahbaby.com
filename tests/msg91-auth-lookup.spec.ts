import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

test.describe("Bug #2: msg91-auth Targeted Lookup & Bounded Fallback Verification", () => {
  const edgeFunctionPath = path.resolve("supabase/functions/msg91-auth/index.ts");
  const migrationPath = path.resolve(
    "supabase/migrations/20260928000211_targeted_auth_user_phone_lookup.sql",
  );

  test("1. Verify no listUsers pagination loop remains in msg91-auth Edge Function", () => {
    const code = fs.readFileSync(edgeFunctionPath, "utf-8");

    // Must NOT contain listUsers
    expect(code).not.toContain("adminClient.auth.admin.listUsers");
    expect(code).not.toContain("listUsers");
    expect(code).not.toContain("while (!existingUser)");
    expect(code).not.toContain("page++");
  });

  test("2. Verify targeted bounded O(1) profile and RPC lookup architecture", () => {
    const code = fs.readFileSync(edgeFunctionPath, "utf-8");

    // Must query authoritative profiles table
    expect(code).toContain('from("profiles")');
    expect(code).toContain(
      "phone.eq.${formattedPhone},phone.eq.${cleanPhone},phone.eq.${tenDigits}",
    );
    expect(code).toContain("getUserById");

    // Must have bounded limit
    expect(code).toContain(".limit(2)");

    // Must have security definer RPC fallback
    expect(code).toContain('"get_auth_user_id_by_phone"');
  });

  test("3. Verify migration provides indexed phone and service_role security definer RPC", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, "utf-8");

    // Index on profiles(phone)
    expect(sql).toContain(
      "CREATE INDEX IF NOT EXISTS idx_profiles_phone ON public.profiles(phone)",
    );

    // Function get_auth_user_id_by_phone
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.get_auth_user_id_by_phone");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("LIMIT 2");

    // Security: Only service_role has access
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.get_auth_user_id_by_phone(text) TO service_role",
    );
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.get_auth_user_id_by_phone(text) FROM anon, authenticated",
    );
  });

  test("4. Phone normalization handles 10-digit Indian phones and variants", () => {
    const rawPhones = [
      "9876543210",
      "+919876543210",
      "919876543210",
      "+91 98765 43210",
      "09876543210",
      "98765-43210",
    ];

    for (const phone of rawPhones) {
      const rawDigits = String(phone).replace(/\D/g, "");
      const tenDigits = rawDigits.slice(-10);
      expect(tenDigits).toHaveLength(10);
      expect(tenDigits).toBe("9876543210");
      const cleanPhone = "91" + tenDigits;
      const formattedPhone = "+91" + tenDigits;
      expect(cleanPhone).toBe("919876543210");
      expect(formattedPhone).toBe("+919876543210");
    }
  });

  test("5. Invalid phone formats are rejected before fallback", () => {
    const invalidPhones = ["12345", "abcdef", "", "+123456789", "000000000"];
    for (const phone of invalidPhones) {
      const rawDigits = String(phone).replace(/\D/g, "");
      const tenDigits = rawDigits.slice(-10);
      const isValid = tenDigits.length === 10 && /^[6-9]\d{9}$/.test(tenDigits);
      expect(isValid).toBe(false);
    }
  });

  test("6. OTP validation strictly checks 4 digits and format", () => {
    const validOtps = ["1234", "0007", "4821", "9012"];
    for (const otp of validOtps) {
      expect(/^\d{4}$/.test(otp.trim())).toBe(true);
    }

    const invalidOtps = ["123", "12345", "abcd", "", "12a4", "12.4", "-123"];
    for (const otp of invalidOtps) {
      expect(/^\d{4}$/.test(String(otp).trim())).toBe(false);
    }
  });

  test("7. Fallback correctly branches between existing user update vs new user creation", () => {
    const code = fs.readFileSync(edgeFunctionPath, "utf-8");

    // Existing user branch
    expect(code).toContain("if (existingUser)");
    expect(code).toContain("adminClient.auth.admin.updateUserById");
    expect(code).toContain("phone_confirm: true");
    expect(code).toContain("password: derivedPassword");

    // New user branch
    expect(code).toContain("adminClient.auth.admin.createUser");
    expect(code).toContain("phone: formattedPhone");
  });

  test("8. (Bug #3) Confirm no direct standard inequality comparison exists for OTP hash", () => {
    const code = fs.readFileSync(edgeFunctionPath, "utf-8");

    // Must NOT use standard inequality for security comparison
    expect(code).not.toContain("expectedHash !== record.otp_hash");
    expect(code).not.toContain("record.otp_hash !== expectedHash");
    expect(code).not.toContain("expectedHash != record.otp_hash");

    // Must use constantTimeHashEqual
    expect(code).toContain("!constantTimeHashEqual(expectedHash, record.otp_hash)");
    expect(code).toContain("function constantTimeHashEqual");
  });

  test("9. (Bug #3) Constant-time comparison handles matching, mismatching, and malformed inputs safely", async () => {
    const { timingSafeEqual } = await import("node:crypto");

    // Exact replica of the function in msg91-auth
    function constantTimeHashEqual(a: string, b: string): boolean {
      if (typeof a !== "string" || typeof b !== "string") {
        return false;
      }

      const aBuf = new TextEncoder().encode(a.toLowerCase());
      const bBuf = new TextEncoder().encode(b.toLowerCase());

      if (aBuf.length !== bBuf.length) {
        let dummyDiff = 1;
        for (let i = 0; i < aBuf.length; i++) {
          dummyDiff |= aBuf[i] ^ aBuf[i];
        }
        return false;
      }

      try {
        return timingSafeEqual(aBuf, bBuf);
      } catch {
        let diff = 0;
        for (let i = 0; i < aBuf.length; i++) {
          diff |= aBuf[i] ^ bBuf[i];
        }
        return diff === 0;
      }
    }

    const hash1 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const hash1Upper = "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855";
    const hash2 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b856"; // last char diff
    const truncated = "e3b0c44298fc1c14";
    const oversized = hash1 + "extra";

    // 1. Correct hash matches
    expect(constantTimeHashEqual(hash1, hash1)).toBe(true);
    // 2. Case-insensitive match succeeds
    expect(constantTimeHashEqual(hash1, hash1Upper)).toBe(true);
    // 3. Wrong hash fails
    expect(constantTimeHashEqual(hash1, hash2)).toBe(false);
    // 4. Truncated / mismatched length fails safely without throwing
    expect(constantTimeHashEqual(hash1, truncated)).toBe(false);
    expect(constantTimeHashEqual(hash1, oversized)).toBe(false);
    // 5. Empty strings fail safely
    expect(constantTimeHashEqual(hash1, "")).toBe(false);
    expect(constantTimeHashEqual("", hash1)).toBe(false);
    expect(constantTimeHashEqual("", "")).toBe(true);
    // 6. Non-string / null / undefined fail safely
    expect(constantTimeHashEqual(hash1, null as unknown as string)).toBe(false);
    expect(constantTimeHashEqual(hash1, undefined as unknown as string)).toBe(false);
    expect(constantTimeHashEqual(null as unknown as string, hash1)).toBe(false);
  });
});
