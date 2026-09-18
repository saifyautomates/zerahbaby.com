import { test, expect } from "@playwright/test";

const phoneWidths = [
  { name: "Small Android (360px)", width: 360, height: 740 },
  { name: "iPhone SE (375px)", width: 375, height: 667 },
  { name: "iPhone 14/15 (390px)", width: 390, height: 844 },
  { name: "Samsung Galaxy (412px)", width: 412, height: 915 },
];

for (const phone of phoneWidths) {
  test(`Checkout layout fit on ${phone.name}`, async ({ page }) => {
    await page.setViewportSize({ width: phone.width, height: phone.height });

    // Set mock local session with 3-part valid JWT
    await page.addInitScript(() => {
      const mockSession = {
        access_token: "header.eyJzdWIiOiJtb2NrLXVzZXItMTIzIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJlbWFpbCI6InNhaWZAZXhhbXBsZS5jb20ifQ.signature",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: "mock-refresh",
        user: {
          id: "mock-user-123",
          aud: "authenticated",
          role: "authenticated",
          email: "saif@example.com",
          user_metadata: { full_name: "Saif", name: "Saif" },
          app_metadata: { provider: "email" },
          created_at: new Date().toISOString(),
        },
      };
      localStorage.setItem("sb-wbbatgbvizhghtkvuguf-auth-token", JSON.stringify(mockSession));
      localStorage.setItem("zerah_cart", JSON.stringify([{
        product: {
          id: "prod-1",
          name: "Organic Cotton Baby Romper",
          price: 999,
          image: "https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af",
          category: "Rompers",
          stock: 10
        },
        qty: 1,
        variantId: "v1",
        price: 999
      }]));
    });

    await page.goto("/checkout", { waitUntil: "domcontentloaded" });

    // If redirected to auth or on checkout, ensure page is responsive without overflow
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(hasHorizontalOverflow).toBe(false);

    // Verify BottomNav is present
    await expect(page.locator("nav >> text=Home")).toBeVisible();
    await expect(page.locator("nav >> text=Categories")).toBeVisible();

    // Take screenshot for audit artifact
    await page.screenshot({ path: `test-results/checkout-${phone.width}px.png` });
  });
}
