import { test, expect } from "@playwright/test";

test.describe("Footer 'Developed by Saify Automates' Contact Modal Suite", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("1. Footer text is exactly 'Developed by Saify Automates' and does not redirect to an external site", async ({
    page,
  }) => {
    const devBtn = page.locator("#developed-by-saify-automates-btn");
    await devBtn.scrollIntoViewIfNeeded();
    await expect(devBtn).toBeVisible({ timeout: 10000 });
    await expect(devBtn).toHaveText("Developed by Saify Automates");

    // Ensure it is a button element, not an external navigation link to another website
    const tagName = await devBtn.evaluate((el) => el.tagName.toLowerCase());
    expect(tagName).toBe("button");

    const currentUrlBefore = page.url();
    await devBtn.click();

    // Verify URL did not navigate away
    expect(page.url()).toBe(currentUrlBefore);
  });

  test("2. Opens polished modal with exactly TWO contact options: WhatsApp & Email", async ({
    page,
  }) => {
    const devBtn = page.locator("#developed-by-saify-automates-btn");
    await devBtn.scrollIntoViewIfNeeded();
    await expect(devBtn).toBeVisible({ timeout: 10000 });
    await devBtn.click();

    // Verify modal is open
    const modal = page.locator("#developer-contact-modal");
    await expect(modal).toBeVisible({ timeout: 7000 });

    const title = page.locator("#developer-contact-title");
    await expect(title).toHaveText("Saify Automates");

    // Check contact options
    const whatsappLink = page.locator("#developer-contact-whatsapp");
    const emailLink = page.locator("#developer-contact-email");

    await expect(whatsappLink).toBeVisible();
    await expect(emailLink).toBeVisible();

    // Verify EXACTLY TWO contact options exist (no third option)
    const allContactLinks = modal.locator("a[id^='developer-contact-']");
    expect(await allContactLinks.count()).toBe(2);

    // Verify WhatsApp URL format & prefilled message
    const expectedWaMessage =
      "Hi Saify Automates, I am interested in your website development services.";
    const waHref = await whatsappLink.getAttribute("href");
    expect(waHref).toContain("wa.me/919928010786");
    expect(waHref).toContain(`text=${encodeURIComponent(expectedWaMessage)}`);
    expect(await whatsappLink.getAttribute("target")).toBe("_blank");

    // Verify Email mailto format, subject, and body
    const expectedEmailSubject = "Website Development Services Inquiry";
    const expectedEmailBody =
      "Hi Saify Automates, I am interested in your website development services. Please share the details and pricing.";
    const emailHref = await emailLink.getAttribute("href");
    expect(emailHref).toContain("mailto:saifyautomates@gmail.com");
    expect(emailHref).toContain(`subject=${encodeURIComponent(expectedEmailSubject)}`);
    expect(emailHref).toContain(`body=${encodeURIComponent(expectedEmailBody)}`);
  });

  test("3. Close button dismisses modal", async ({ page }) => {
    const devBtn = page.locator("#developed-by-saify-automates-btn");
    await devBtn.scrollIntoViewIfNeeded();
    await expect(devBtn).toBeVisible({ timeout: 10000 });
    await devBtn.click();

    const modal = page.locator("#developer-contact-modal");
    await expect(modal).toBeVisible({ timeout: 7000 });

    const closeBtn = page.locator("#developer-modal-close-btn");
    await closeBtn.click();

    await expect(modal).toBeHidden();
  });

  test("4. Escape key dismisses modal", async ({ page }) => {
    const devBtn = page.locator("#developed-by-saify-automates-btn");
    await devBtn.scrollIntoViewIfNeeded();
    await expect(devBtn).toBeVisible({ timeout: 10000 });
    await devBtn.click();

    const modal = page.locator("#developer-contact-modal");
    await expect(modal).toBeVisible({ timeout: 7000 });

    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();
  });

  test("5. Outside click (backdrop) dismisses modal", async ({ page }) => {
    const devBtn = page.locator("#developed-by-saify-automates-btn");
    await devBtn.scrollIntoViewIfNeeded();
    await expect(devBtn).toBeVisible({ timeout: 10000 });
    await devBtn.click();

    const modal = page.locator("#developer-contact-modal");
    await expect(modal).toBeVisible({ timeout: 7000 });

    // Click outside on the backdrop
    const backdrop = page.locator("#developer-contact-backdrop");
    await backdrop.click({ position: { x: 10, y: 10 } });
    await expect(modal).toBeHidden();
  });
});
