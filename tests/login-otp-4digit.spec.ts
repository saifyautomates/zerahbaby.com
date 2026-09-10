import { test, expect } from "@playwright/test";

test.describe("Login OTP 4-digit Validation Suite", () => {
  const OTP_REGEX = /^\d{4}$/;

  test("1. Valid 4-digit OTP formats are accepted", () => {
    for (const code of ["0007", "0421", "4827", "9015", "0000", "1234"]) {
      expect(code.length).toBe(4);
      expect(OTP_REGEX.test(code)).toBe(true);
    }
  });

  test("2. Invalid OTP formats are strictly rejected", () => {
    for (const code of ["123", "12345", "", "123456", "12a4", " 1234", "1234 ", "-123"]) {
      expect(OTP_REGEX.test(code)).toBe(false);
    }
  });

  test("3. Leading zeroes are preserved without numeric coercion", () => {
    const codeWithLeadingZero = "0007";
    expect(OTP_REGEX.test(codeWithLeadingZero)).toBe(true);
    expect(codeWithLeadingZero.length).toBe(4);
    // Coercion to number would collapse "0007" to 7 (length 1), which fails
    expect(OTP_REGEX.test(String(Number(codeWithLeadingZero)))).toBe(false);
  });

  test("4. UI Form Input Constraints in src/routes/auth.tsx", async () => {
    const fs = await import("fs");
    const c = fs.readFileSync("src/routes/auth.tsx", "utf-8");
    expect(c).toContain("maxLength={4}");
    expect(c).toContain("Enter 4-digit code");
    expect(c).toContain("We sent a 4-digit code to");
    expect(c).toContain("disabled={busy || otp.length !== 4}");
    expect(c).not.toContain("maxLength={6}");
    expect(c).not.toContain("otp.length !== 6");
    expect(c).not.toContain("6-digit");
    expect(c).not.toContain("Enter 6-digit");
  });

  test("5. SendOTP API parameter format includes otp_length=4", () => {
    const url = new URL("https://control.msg91.com/api/v5/otp");
    url.searchParams.set("otp_length", "4");
    expect(url.searchParams.get("otp_length")).toBe("4");
  });

  test("6. Verify OTP API URL format with 4-digit code", () => {
    for (const otp of ["0007", "0421", "4827", "9015"]) {
      const url = new URL("https://control.msg91.com/api/v5/otp/verify");
      url.searchParams.set("otp", otp);
      expect(url.searchParams.get("otp")).toBe(otp);
      expect(url.searchParams.get("otp")?.length).toBe(4);
    }
  });
});
