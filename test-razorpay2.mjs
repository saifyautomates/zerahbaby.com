import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Navigating to product...");
  await page.goto("http://localhost:8080/product/kids-frock-floral");

  console.log("Adding to cart...");
  await page.click('button:has-text("Add to bag")');

  console.log("Going to checkout...");
  await page.goto("http://localhost:8080/checkout");

  console.log("Filling details...");
  // Wait for the form to appear
  await page.waitForSelector('input[name="full_name"]', { state: "visible" });
  await page.fill('input[name="full_name"]', "Test User");
  await page.fill('input[name="phone"]', "9999999999");
  await page.fill('input[name="email"]', "test@example.com");
  await page.fill('input[name="address"]', "123 Test St");
  await page.fill('input[name="city"]', "Test City");
  await page.fill('input[name="state"]', "TS");
  await page.fill('input[name="pincode"]', "123456");

  console.log("Submitting order...");
  await page.click('button:has-text("Place order")');

  console.log("Waiting for Razorpay modal...");
  try {
    await page.waitForSelector("iframe.razorpay-checkout-frame", { timeout: 15000 });
    console.log("Razorpay modal opened successfully!");
    await page.screenshot({
      path: "C:/Users/jackx/.gemini/antigravity-ide/brain/2baa45ed-6154-4f36-9e15-b150c8f89d14/scratch/razorpay-success.png",
    });
  } catch (e) {
    console.log("Razorpay modal did not open or timed out.");
    await page.screenshot({
      path: "C:/Users/jackx/.gemini/antigravity-ide/brain/2baa45ed-6154-4f36-9e15-b150c8f89d14/scratch/razorpay-error.png",
    });
    console.error(e);
  }

  await browser.close();
})();
