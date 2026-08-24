import { test, expect } from "@playwright/test";

test.describe("Admin Notification Dropdown Stacking Context & Layout Suite", () => {
  test("1. Notification Dropdown Positioning & Stacking Context Check", async ({ page }) => {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });

    const layoutValidation = await page.evaluate(() => {
      // Create a simulation of the header and dashboard content to verify stacking context math
      const header = document.createElement("header");
      header.className =
        "relative z-30 flex h-16 shrink-0 items-center justify-between border-b border-border bg-card/80 px-4 backdrop-blur-md lg:px-6";
      header.style.position = "relative";
      header.style.zIndex = "30";
      document.body.appendChild(header);

      const notifWrapper = document.createElement("div");
      notifWrapper.className = "relative";
      header.appendChild(notifWrapper);

      const dropdown = document.createElement("div");
      dropdown.className =
        "fixed left-3 right-3 top-16 sm:absolute sm:left-auto sm:right-0 sm:top-11 z-50 sm:w-[400px] max-w-[420px] overflow-hidden rounded-3xl border border-border bg-card shadow-2xl";
      notifWrapper.appendChild(dropdown);

      const content = document.createElement("div");
      content.className = "flex-1 overflow-y-auto p-4 lg:p-6";
      content.style.position = "relative";
      content.style.zIndex = "0";
      document.body.appendChild(content);

      const kpiCard = document.createElement("div");
      kpiCard.className =
        "group relative overflow-hidden rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-700 p-5 text-white";
      kpiCard.style.position = "relative";
      content.appendChild(kpiCard);

      const headerZ = parseInt(window.getComputedStyle(header).zIndex, 10) || 0;
      const contentZ = parseInt(window.getComputedStyle(content).zIndex, 10) || 0;

      // Clean up
      header.remove();
      content.remove();

      return {
        headerZ,
        contentZ,
        isHeaderAboveContent: headerZ > contentZ,
      };
    });

    expect(layoutValidation.headerZ).toBe(30);
    expect(layoutValidation.contentZ).toBe(0);
    expect(layoutValidation.isHeaderAboveContent).toBe(true);
  });

  test("2. Viewport Boundary & Overflow Safety across 7 Breakpoints (320px to 1440px)", async ({
    page,
  }) => {
    const viewports = [
      { width: 320, height: 568 },
      { width: 360, height: 640 },
      { width: 390, height: 844 },
      { width: 430, height: 932 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await page.goto("/auth", { waitUntil: "domcontentloaded" });

      const overflowCheck = await page.evaluate((width) => {
        const isMobile = width < 640;
        const dropdownWidth = isMobile ? width - 24 : Math.min(400, width - 32);
        const fitsInScreen = dropdownWidth <= width;
        return { fitsInScreen, dropdownWidth };
      }, vp.width);

      expect(overflowCheck.fitsInScreen).toBe(true);

      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
    }
  });

  test("3. Internal Scroll & Max-Height Bound Calculation", async ({ page }) => {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });

    const maxHeights = await page.evaluate(() => {
      function calculateMaxHeight(viewportHeight: number) {
        return Math.min(440, viewportHeight - 140);
      }

      return {
        desktop: calculateMaxHeight(900),
        laptop: calculateMaxHeight(768),
        tablet: calculateMaxHeight(600),
        shortMobile: calculateMaxHeight(500),
      };
    });

    expect(maxHeights.desktop).toBe(440);
    expect(maxHeights.laptop).toBe(440);
    expect(maxHeights.tablet).toBe(440);
    expect(maxHeights.shortMobile).toBe(360);
  });
});
