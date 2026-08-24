import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Navigating to auth page...");
  await page.goto('http://localhost:8080/auth');

  console.log("Testing Email OTP Flow...");
  await page.fill('#auth-contact-input', 'test-auth-robot@example.com');
  await page.click('#auth-send-otp-btn');
  
  try {
    const success = await page.waitForSelector('text="6-digit OTP sent to your email!"', { timeout: 3000 }).catch(() => null);
    if (success) {
      console.log("Email OTP success message appeared.");
    } else {
      // Try to read any toast error
      const toast = await page.locator('[data-sonner-toast]').first();
      const text = await toast.textContent({ timeout: 2000 }).catch(() => null);
      if (text) {
         console.log("Email OTP failed with toast error: " + text);
      } else {
         console.log("Email OTP failed silently.");
      }
    }
  } catch(e) {
    console.log("Error checking toast.", e);
  }

  await browser.close();
})();
