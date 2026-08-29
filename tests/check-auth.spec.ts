import { test, expect } from "@playwright/test";

test("Check Full Auth Flow", async ({ page }) => {
  // Go to auth page
  await page.goto("/auth");
  
  // Fill email
  const emailInput = page.locator('#auth-contact-input');
  await emailInput.waitFor({ state: "visible" });
  await emailInput.fill(`testuser_${Date.now()}@example.com`);
  
  // Click Get OTP
  await page.locator('#auth-send-otp-btn').click();
  
  // Wait for OTP field or error
  // Wait to see if error toaster appears, or if OTP input appears
  try {
    await page.locator('#auth-otp-input').waitFor({ state: "visible", timeout: 10000 });
    console.log("OTP field appeared successfully! Email sent.");
  } catch (e) {
    // If it fails, check for error toaster
    const errorToast = page.locator('[data-sonner-toast]');
    if (await errorToast.isVisible()) {
      const errorText = await errorToast.innerText();
      console.log(`Auth failed with error: ${errorText}`);
      throw new Error(`Auth failed: ${errorText}`);
    } else {
      throw e;
    }
  }
});
