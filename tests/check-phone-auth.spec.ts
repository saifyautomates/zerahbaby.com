import { test, expect } from "@playwright/test";

test("Check Phone Auth Flow", async ({ page }) => {
  page.on("console", (msg) => console.log("BROWSER CONSOLE:", msg.text()));
  page.on("pageerror", (err) => console.log("BROWSER ERROR:", err));

  // Go to auth page
  await page.goto("/auth");

  // Fill phone
  const phoneInput = page.locator("#auth-contact-input");
  await phoneInput.waitFor({ state: "visible" });
  await phoneInput.focus();
  await phoneInput.fill("9999999999");
  await expect(phoneInput).toHaveValue("9999999999");

  // Click Get OTP
  await page.locator("#auth-send-otp-btn").click();

  // Wait for OTP field or error toast
  const otpInput = page.locator("#auth-otp-input");
  const errorToast = page.locator("[data-sonner-toast][data-type='error']");

  await Promise.race([
    otpInput.waitFor({ state: "visible", timeout: 10000 }),
    errorToast.waitFor({ state: "visible", timeout: 10000 }),
  ]);

  if (await errorToast.isVisible()) {
    const errorText = await errorToast.innerText();
    console.log(`Auth failed with error: ${errorText}`);
    throw new Error(`Auth failed: ${errorText}`);
  }

  await expect(otpInput).toBeVisible({ timeout: 5000 });
  console.log("OTP field appeared successfully! Phone OTP sent.");
});
