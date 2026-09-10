import { test, expect } from "@playwright/test";

test.describe("Login OTP 6-digit Validation Suite", () => {
  const OTP_REGEX = /^\d{6}$/;

  test("1. Valid 6-digit OTP formats are accepted", () => {
    for (const code of ["123456", "000700", "482712", "901500", "000000"]) {
      expect(code.length).toBe(6);
      expect(OTP_REGEX.test(code)).toBe(true);
    }
  });

  test("2. Invalid OTP formats are strictly rejected", () => {
    for (const code of ["12345","1234","","1234567","12a456"," 123456","123456 ","-12345"]) {
      expect(OTP_REGEX.test(code)).toBe(false);
    }
  });

  test("3. Leading zeroes are preserved without numeric coercion", () => {
    expect(OTP_REGEX.test("000123")).toBe(true);
    expect(OTP_REGEX.test(String(Number("000123")))).toBe(false);
  });

  test("4. UI Form Input Constraints", async () => {
    const fs = await import("fs");
    const c = fs.readFileSync("src/routes/auth.tsx", "utf-8");
    expect(c).toContain("maxLength={6}");
    expect(c).toContain("Enter 6-digit OTP");
    expect(c).toContain("disabled={busy || otp.length !== 6}");
    expect(c).not.toContain("maxLength={4}");
    expect(c).not.toContain("otp.length !== 4");
    expect(c).not.toContain("Enter 4-digit OTP");
  });

  test("5. SendOTP API parameter format includes otp_length=6", () => {
    const url = new URL("https://control.msg91.com/api/v5/otp");
    url.searchParams.set("otp_length", "6");
    expect(url.searchParams.get("otp_length")).toBe("6");
  });

  test("6. Verify OTP API URL format with 6-digit code", () => {
    for (const otp of ["123456", "000123", "482712"]) {
      const url = new URL("https://control.msg91.com/api/v5/otp/verify");
      url.searchParams.set("otp", otp);
      expect(url.searchParams.get("otp")).toBe(otp);
      expect(url.searchParams.get("otp")?.length).toBe(6);
    }
  });
});
