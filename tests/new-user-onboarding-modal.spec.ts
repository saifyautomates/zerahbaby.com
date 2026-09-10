import { test, expect } from "@playwright/test";

test.describe("New User Onboarding Profile Details Modal Suite", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("zerah_test_new_user", "true");
      sessionStorage.removeItem("onboarding_dismissed");
    });
  });

  test("1. Onboarding modal opens when triggered and displays all required customer fields", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger onboarding event
    await page.evaluate(() => {
      sessionStorage.removeItem("onboarding_dismissed");
      window.dispatchEvent(new CustomEvent("zerah:open-onboarding"));
    });

    // Verify modal element presence and accessibility attributes
    const modal = page.locator("[role='dialog'][aria-labelledby='onboarding-modal-title']");
    await expect(modal).toBeVisible({ timeout: 7000 });

    // Verify header and brand text
    await expect(page.locator("#onboarding-modal-title")).toContainText("Welcome to");
    await expect(page.locator("text=Complete Your Profile")).toBeVisible();

    // Verify all 6 critical customer profile fields exist
    const fullNameInput = page.locator("#onboarding-full-name");
    const phoneInput = page.locator("#onboarding-phone");
    const addressInput = page.locator("#onboarding-address");
    const cityInput = page.locator("#onboarding-city");
    const stateSelect = page.locator("#onboarding-state");
    const pincodeInput = page.locator("#onboarding-pincode");

    await expect(fullNameInput).toBeVisible();
    await expect(phoneInput).toBeVisible();
    await expect(addressInput).toBeVisible();
    await expect(cityInput).toBeVisible();
    await expect(stateSelect).toBeVisible();
    await expect(pincodeInput).toBeVisible();

    // Verify buttons
    await expect(page.locator("#onboarding-submit-btn")).toBeVisible();
    await expect(page.locator("#onboarding-skip-btn")).toBeVisible();

    // Verify Indian states dropdown has options
    const stateOptions = await stateSelect.locator("option").allTextContents();
    expect(stateOptions).toContain("Maharashtra");
    expect(stateOptions).toContain("Delhi");
    expect(stateOptions).toContain("Karnataka");
    expect(stateOptions.length).toBeGreaterThan(25);
  });

  test("2. Input constraints: pincode restricts to 6 numeric digits", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("zerah:open-onboarding"));
    });

    const pincodeInput = page.locator("#onboarding-pincode");
    await expect(pincodeInput).toBeVisible({ timeout: 7000 });

    // Fill 6 digits
    await pincodeInput.fill("400001");
    expect(await pincodeInput.inputValue()).toBe("400001");

    // Test non-digit stripping
    await pincodeInput.fill("12ab34");
    expect(await pincodeInput.inputValue()).toBe("1234");
  });

  test("3. Skip for now button dismisses the modal", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("zerah:open-onboarding"));
    });

    const modal = page.locator("[role='dialog'][aria-labelledby='onboarding-modal-title']");
    await expect(modal).toBeVisible({ timeout: 7000 });

    await page.locator("#onboarding-skip-btn").click();
    await expect(modal).toBeHidden({ timeout: 3000 });
  });
});
