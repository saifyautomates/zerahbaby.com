import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { name: "320px (Mobile Mini)", width: 320, height: 600 },
  { name: "360px (Galaxy S8+)", width: 360, height: 740 },
  { name: "375px (iPhone SE)", width: 375, height: 667 },
  { name: "390px (iPhone 14)", width: 390, height: 844 },
  { name: "393px (Pixel 7)", width: 393, height: 851 },
  { name: "412px (Galaxy S20)", width: 412, height: 915 },
  { name: "430px (iPhone 14 Pro Max)", width: 430, height: 932 },
  { name: "768px (iPad Portrait)", width: 768, height: 1024 },
  { name: "820px (iPad Air)", width: 820, height: 1180 },
  { name: "1024px (iPad Landscape)", width: 1024, height: 768 },
  { name: "1280px (Desktop Small)", width: 1280, height: 800 },
  { name: "1440px (Desktop Standard)", width: 1440, height: 900 },
  { name: "1920px (Desktop FHD)", width: 1920, height: 1080 },
];

test.describe("Checkout Page Mobile Overflow & Responsive Audit", () => {
  for (const vp of VIEWPORTS) {
    test(`Zero horizontal overflow on ${vp.name} (${vp.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      // Mock profile response to match real saved address
      await page.route("**/rest/v1/profiles*", async (route) => {
        if (route.request().method() === "GET") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              id: "00000000-0000-0000-0000-000000000001",
              full_name: "saif",
              phone: "07014098198",
              address: "rose block 1 rk nagar kota",
              city: "Kota",
              state: "Rajasthan",
              pincode: "324001",
              profile_completed: true,
            }),
          });
        } else {
          await route.continue();
        }
      });

      // Mock products in case store loads
      await page.route("**/rest/v1/products*", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              id: "prod-test-1",
              uuid: "00000000-0000-0000-0000-000000000010",
              name: "Organic Cotton Romper",
              slug: "organic-cotton-romper",
              price: 1500,
              mrp: 1999,
              image: "https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af",
              category: "clothing",
              stock: 10,
              is_active: true,
              sales_channel: "OMNICHANNEL",
            },
          ]),
        });
      });

      // Set test admin auth and cart
      await page.addInitScript(() => {
        localStorage.setItem("zerah_test_admin", "true");
        localStorage.setItem(
          "zerah-cart-00000000-0000-0000-0000-000000000001",
          JSON.stringify([
            {
              id: "prod-test-1",
              qty: 1,
            },
          ])
        );
      });

      await page.goto("http://localhost:8080/checkout");
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(1000);

      const metrics = await page.evaluate(() => {
        const docScrollWidth = document.documentElement.scrollWidth;
        const docClientWidth = document.documentElement.clientWidth;
        const bodyScrollWidth = document.body.scrollWidth;
        const winInnerWidth = window.innerWidth;

        // Check overflowing elements
        const overflowingElements: string[] = [];
        const allElements = document.querySelectorAll("*");
        allElements.forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.right > winInnerWidth + 1.5) {
            overflowingElements.push(
              `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 40)} (right: ${Math.round(rect.right)} > ${winInnerWidth})`
            );
          }
        });

        return {
          docScrollWidth,
          docClientWidth,
          bodyScrollWidth,
          winInnerWidth,
          hasOverflow: docScrollWidth > winInnerWidth + 1 || bodyScrollWidth > winInnerWidth + 1,
          overflowingElements: overflowingElements.slice(0, 5),
        };
      });

      if (metrics.hasOverflow) {
        console.log(`[OVERFLOW at ${vp.width}px]`, metrics);
      }

      // Assert document and body do not horizontally overflow
      expect(metrics.docScrollWidth).toBeLessThanOrEqual(metrics.winInnerWidth + 1);
      expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.winInnerWidth + 1);

      // Verify specific elements exist and are not overflowing
      const deliveryHeading = page.getByRole("heading", { name: /Delivery Address/i });
      if (await deliveryHeading.isVisible()) {
        const dBox = await deliveryHeading.boundingBox();
        if (dBox) {
          expect(dBox.x + dBox.width).toBeLessThanOrEqual(vp.width + 1);
        }
      }

      const paymentHeading = page.getByRole("heading", { name: /Payment & Notes/i });
      if (await paymentHeading.isVisible()) {
        const pBox = await paymentHeading.boundingBox();
        if (pBox) {
          expect(pBox.x + pBox.width).toBeLessThanOrEqual(vp.width + 1);
        }
      }

      const addressBtn = page.getByRole("button", { name: /Enter a new address|Use saved address/i });
      if (await addressBtn.isVisible()) {
        const aBox = await addressBtn.boundingBox();
        if (aBox) {
          expect(aBox.x + aBox.width).toBeLessThanOrEqual(vp.width + 1);
        }
      }

      const selectPaymentSpan = page.locator("span", { hasText: "Select payment method" });
      if (await selectPaymentSpan.isVisible()) {
        const sBox = await selectPaymentSpan.boundingBox();
        if (sBox) {
          expect(sBox.x + sBox.width).toBeLessThanOrEqual(vp.width + 1);
        }
      }

      const payNowTrigger = page.locator("#checkout-pay-now-trigger");
      if (await payNowTrigger.isVisible()) {
        const pBox = await payNowTrigger.boundingBox();
        if (pBox) {
          expect(pBox.x + pBox.width).toBeLessThanOrEqual(vp.width + 1);
        }
      }
    });
  }
});
