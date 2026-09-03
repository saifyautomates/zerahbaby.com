/**
 * Comprehensive Functional & Validation Test Suite:
 * Marketing & Social Links Engine (Zérah Baby & Kids)
 */
import { test, expect } from "@playwright/test";
import {
  validateAndNormalizeInstagram,
  validateAndNormalizeFacebook,
  validateAndNormalizeWhatsApp,
  validateAndNormalizeAnnouncementLink,
  containsDangerousProtocol,
} from "../src/lib/marketing-links";

test.describe("Marketing & Social Links Validation and Normalization Engine", () => {
  // --- 1. INSTAGRAM FIELD ---
  test("1. Instagram: Accepts valid full HTTPS URL", () => {
    const res = validateAndNormalizeInstagram("https://www.instagram.com/zerah_kids/");
    expect(res.isValid).toBe(true);
    expect(res.normalizedUrl).toBe("https://www.instagram.com/zerah_kids/");
  });

  test("2. Instagram: Accepts username with @ prefix and normalizes to canonical URL", () => {
    const res = validateAndNormalizeInstagram("@zerah_kids");
    expect(res.isValid).toBe(true);
    expect(res.normalizedUrl).toBe("https://www.instagram.com/zerah_kids/");
  });

  test("3. Instagram: Accepts bare username without @ and normalizes", () => {
    const res = validateAndNormalizeInstagram("zerah_kids");
    expect(res.isValid).toBe(true);
    expect(res.normalizedUrl).toBe("https://www.instagram.com/zerah_kids/");
  });

  test("4. Instagram: Rejects non-Instagram host", () => {
    const res = validateAndNormalizeInstagram("https://phishing-site.com/zerah_kids");
    expect(res.isValid).toBe(false);
    expect(res.error).toContain("Must be an official Instagram link");
  });

  test("5. Instagram: Rejects dangerous protocols (javascript:, data:)", () => {
    const res1 = validateAndNormalizeInstagram("javascript:alert(document.cookie)");
    expect(res1.isValid).toBe(false);
    expect(res1.error).toContain("Unsafe protocol detected");

    const res2 = validateAndNormalizeInstagram(
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    );
    expect(res2.isValid).toBe(false);
    expect(res2.error).toContain("Unsafe protocol detected");
  });

  // --- 2. FACEBOOK FIELD ---
  test("6. Facebook: Accepts valid full HTTPS Page URL", () => {
    const res = validateAndNormalizeFacebook("https://www.facebook.com/zerahbaby/");
    expect(res.isValid).toBe(true);
    expect(res.normalizedUrl).toBe("https://www.facebook.com/zerahbaby");
  });

  test("7. Facebook: Accepts username and normalizes", () => {
    const res = validateAndNormalizeFacebook("zerahbaby");
    expect(res.isValid).toBe(true);
    expect(res.normalizedUrl).toBe("https://www.facebook.com/zerahbaby");
  });

  test("8. Facebook: Accepts fb.com shortlink", () => {
    const res = validateAndNormalizeFacebook("https://fb.com/zerahbaby");
    expect(res.isValid).toBe(true);
    expect(res.normalizedUrl).toContain("facebook.com/zerahbaby");
  });

  test("9. Facebook: Rejects non-Facebook host", () => {
    const res = validateAndNormalizeFacebook("https://evil-site.com/zerahbaby");
    expect(res.isValid).toBe(false);
    expect(res.error).toContain("Must be an official Facebook page URL");
  });

  test("10. Facebook: Rejects dangerous protocol", () => {
    const res = validateAndNormalizeFacebook("javascript:stealCredentials()");
    expect(res.isValid).toBe(false);
    expect(res.error).toContain("Unsafe protocol detected");
  });

  // --- 3. WHATSAPP FIELD ---
  test("11. WhatsApp: Accepts 10-digit Indian mobile and formats to wa.me/91<number>", () => {
    const res = validateAndNormalizeWhatsApp("9057074777");
    expect(res.isValid).toBe(true);
    expect(res.normalizedUrl).toBe("https://wa.me/919057074777");
  });

  test("12. WhatsApp: Accepts formatted phone (+91 90570 74777)", () => {
    const res = validateAndNormalizeWhatsApp("+91 90570 74777");
    expect(res.isValid).toBe(true);
    expect(res.normalizedUrl).toBe("https://wa.me/919057074777");
  });

  test("13. WhatsApp: Accepts phone with leading zero (09057074777)", () => {
    const res = validateAndNormalizeWhatsApp("09057074777");
    expect(res.isValid).toBe(true);
    expect(res.normalizedUrl).toBe("https://wa.me/919057074777");
  });

  test("14. WhatsApp: Accepts direct wa.me link", () => {
    const res = validateAndNormalizeWhatsApp("https://wa.me/919057074777");
    expect(res.isValid).toBe(true);
    expect(res.normalizedUrl).toBe("https://wa.me/919057074777");
  });

  test("15. WhatsApp: Accepts api.whatsapp.com link", () => {
    const res = validateAndNormalizeWhatsApp("https://api.whatsapp.com/send?phone=919057074777");
    expect(res.isValid).toBe(true);
    expect(res.normalizedUrl).toBe("https://api.whatsapp.com/send?phone=919057074777");
  });

  test("16. WhatsApp: Rejects invalid phone numbers (< 10 digits)", () => {
    const res = validateAndNormalizeWhatsApp("90570");
    expect(res.isValid).toBe(false);
    expect(res.error).toBeDefined();
  });

  test("17. WhatsApp: Rejects malicious protocols", () => {
    const res = validateAndNormalizeWhatsApp("javascript:alert('pwned')");
    expect(res.isValid).toBe(false);
    expect(res.error).toContain("Unsafe protocol detected");
  });

  test("18. WhatsApp: Rejects non-WhatsApp domains", () => {
    const res = validateAndNormalizeWhatsApp("https://telegram.org/dl");
    expect(res.isValid).toBe(false);
    expect(res.error).toContain("Must be a valid WhatsApp link");
  });

  // --- 4. ANNOUNCEMENT TARGET LINK ---
  test("19. Target Link: Accepts internal relative paths (/shop)", () => {
    const res = validateAndNormalizeAnnouncementLink("/shop");
    expect(res.isValid).toBe(true);
    expect(res.normalizedUrl).toBe("/shop");
  });

  test("20. Target Link: Accepts external HTTPS link", () => {
    const res = validateAndNormalizeAnnouncementLink("https://zerahkids.com/products/sale");
    expect(res.isValid).toBe(true);
    expect(res.normalizedUrl).toBe("https://zerahkids.com/products/sale");
  });

  test("21. Target Link: Rejects javascript: protocol", () => {
    const res = validateAndNormalizeAnnouncementLink("javascript:alert(1)");
    expect(res.isValid).toBe(false);
    expect(res.error).toContain("Unsafe protocol detected");
  });

  // --- 5. TEST CHAT LINK INTEGRITY ---
  test("22. Test Chat Link: Opens exactly the saved destination", () => {
    const inputPhone = "9057074777";
    const waValidation = validateAndNormalizeWhatsApp(inputPhone);
    expect(waValidation.isValid).toBe(true);

    // Simulated Test Chat Link anchor href
    const testChatLinkHref = waValidation.normalizedUrl;
    expect(testChatLinkHref).toBe("https://wa.me/919057074777");

    // Must have proper destination scheme
    expect(testChatLinkHref.startsWith("https://wa.me/")).toBe(true);
  });

  // --- 6. SAFE EMPTY FIELD HANDLING ---
  test("23. Empty inputs return valid empty strings without errors", () => {
    expect(validateAndNormalizeInstagram("").isValid).toBe(true);
    expect(validateAndNormalizeFacebook("").isValid).toBe(true);
    expect(validateAndNormalizeWhatsApp("").isValid).toBe(true);
    expect(validateAndNormalizeAnnouncementLink("").isValid).toBe(true);
  });

  // --- 7. DANGEROUS PROTOCOL SANITIZER ---
  test("24. containsDangerousProtocol detects obfuscated javascript protocols", () => {
    expect(containsDangerousProtocol("  javascript:alert(1)")).toBe(true);
    expect(containsDangerousProtocol("JAVASCRIPT:alert(1)")).toBe(true);
    expect(containsDangerousProtocol("data:text/html,...")).toBe(true);
    expect(containsDangerousProtocol("vbscript:msgbox")).toBe(true);
    expect(containsDangerousProtocol("https://wa.me/919057074777")).toBe(false);
  });
});
