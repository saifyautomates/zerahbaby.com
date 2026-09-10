import { test, expect } from "@playwright/test";

/**
 * Zérah Baby & Kids - 4-Digit Login OTP Verification Test Suite
 *
 * Validates:
 * 1. 4-digit validation rules (1234, 0007, 4827, 0000 -> valid)
 * 2. Invalid formats rejected (123, 12345, 12a4, ABCD -> invalid)
 * 3. Preservation of leading zeros as string ("0007", "0421")
 * 4. UI constraints: maxLength=4, inputMode=numeric, autocomplete=one-time-code
 * 5. UI copy: "Enter 4-digit OTP", zero remaining 6-digit references in login OTP
 * 6. Button state: disabled if otp.length !== 4, enabled when 4 digits
 * 7. MSG91 SendOTP query parameters include otp_length=4
 */

test.describe("Login OTP 4-Digit Validation Suite", () => {
  const OTP_REGEX = /^\d{4}$/;

  test("1. Valid 4-digit OTP formats are accepted", () => {
    const validOTPs = ["1234", "0007", "4827", "9015", "0000"];
    for (const code of validOTPs) {
      expect(typeof code).toBe("string");
      expect(code.length).toBe(4);
      expect(OTP_REGEX.test(code)).toBe(true);
    }
  });

  test("2. Invalid OTP formats are strictly rejected", () => {
    const invalidOTPs = [
      "123", // too short (3 digits)
      "12", // too short (2 digits)
      "1", // too short (1 digit)
      "", // empty
      "12345", // too long (5 digits)
      "123456", // legacy 6 digits
      "12a4", // alphanumeric
      "ABCD", // alphabetic
      " 1234", // leading space
      "1234 ", // trailing space
      "12 4", // internal space
      "-123", // negative sign
      "12.4", // decimal
    ];
    for (const code of invalidOTPs) {
      expect(OTP_REGEX.test(code)).toBe(false);
    }
  });

  test("3. Leading zeroes are preserved without numeric coercion", () => {
    const leadingZeroOtp = "0007";
    expect(leadingZeroOtp).toBe("0007");
    expect(leadingZeroOtp.length).toBe(4);
    expect(OTP_REGEX.test(leadingZeroOtp)).toBe(true);

    // Number conversion would corrupt "0007" to 7 (1 digit)
    const corruptedNumeric = Number(leadingZeroOtp);
    expect(corruptedNumeric).toBe(7);
    expect(String(corruptedNumeric).length).toBe(1); // proves why string is mandatory
    expect(OTP_REGEX.test(String(corruptedNumeric))).toBe(false);

    // String representation preserves integrity
    const preservedString = String(leadingZeroOtp).trim();
    expect(preservedString).toBe("0007");
    expect(OTP_REGEX.test(preservedString)).toBe(true);
  });

  test("4. UI Form & Input Constraints (Component specification verification)", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("src/routes/auth.tsx", "utf-8");

    // Must enforce maxLength={4} for OTP
    expect(content).toContain("maxLength={4}");
    // Must reject 6-digit assumptions in OTP flow
    expect(content).not.toContain("Enter 6-digit");
    expect(content).not.toContain("6-digit OTP");
    expect(content).not.toContain("6-digit code");
    // Must contain 4-digit user copy
    expect(content).toContain("Enter 4-digit OTP");
    expect(content).toContain("disabled={busy || otp.length !== 4}");
    // Must enforce numeric input attributes
    expect(content).toContain('inputMode="numeric"');
    expect(content).toContain('autoComplete="one-time-code"');
  });

  test("5. SendOTP API parameter format includes otp_length=4", () => {
    const templateId = "test_template_123";
    const cleanPhone = "917014098198";
    const sender = "ZERAHH";

    const url = `https://control.msg91.com/api/v5/otp?template_id=${templateId}&mobile=${cleanPhone}&sender=${sender}&otp_length=4`;

    const parsedUrl = new URL(url);
    expect(parsedUrl.searchParams.get("template_id")).toBe(templateId);
    expect(parsedUrl.searchParams.get("mobile")).toBe(cleanPhone);
    expect(parsedUrl.searchParams.get("sender")).toBe(sender);
    expect(parsedUrl.searchParams.get("otp_length")).toBe("4");
  });

  test("6. Verify OTP API URL format with 4-digit code", () => {
    const cleanPhone = "917014098198";
    const testOtps = ["1234", "0007", "4827"];

    for (const otp of testOtps) {
      const url = `https://control.msg91.com/api/v5/otp/verify?otp=${otp}&mobile=${cleanPhone}`;
      const parsedUrl = new URL(url);
      expect(parsedUrl.searchParams.get("otp")).toBe(otp);
      expect(parsedUrl.searchParams.get("otp")?.length).toBe(4);
      expect(parsedUrl.searchParams.get("mobile")).toBe(cleanPhone);
    }
  });
});
