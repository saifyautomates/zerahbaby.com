import { test, expect } from "@playwright/test";

test.describe("Admin Product Form - Homepage Sections Placement", () => {
  test("Can expand homepage sections selector, search sections, and select specific sections", async ({
    page,
  }) => {
    // 1. Mock homepage sections in database
    await page.route("**/rest/v1/homepage_sections*", async (route) => {
      const mockSections = [
        {
          id: "sec-diwali-1",
          title: "Diwali Specials",
          subtitle: "Festive celebration picks",
          slug: "diwali-specials",
          section_type: "PRODUCT_GRID",
          source_type: "MANUAL",
          status: "published",
          is_visible: true,
          sort_order: 1,
          badge_text: "Diwali Sale",
          display_settings: { max_products: 8 },
          homepage_section_items: [],
        },
        {
          id: "sec-summer-2",
          title: "Summer Essentials",
          subtitle: "Breezy cotton wear",
          slug: "summer-essentials",
          section_type: "PRODUCT_CAROUSEL",
          source_type: "MANUAL",
          status: "published",
          is_visible: true,
          sort_order: 2,
          badge_text: "Summer Pick",
          display_settings: { max_products: 8 },
          homepage_section_items: [],
        },
        {
          id: "sec-deals-3",
          title: "Deals of the week",
          subtitle: "Biggest savings",
          slug: "deals-of-the-week",
          section_type: "PRODUCT_GRID",
          source_type: "DISCOUNTED",
          status: "published",
          is_visible: true,
          sort_order: 3,
          badge_text: null,
          display_settings: { max_products: 8 },
          homepage_section_items: [],
        },
      ];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockSections),
      });
    });

    // 2. Set Admin bypass with init script before any navigation
    await page.addInitScript(() => {
      localStorage.setItem("zerah_test_admin", "true");
      localStorage.setItem("zerah_admin_active_tab", "products");
    });

    // 3. Open Admin products tab
    await page.goto("http://localhost:8080/admin?tab=products", { waitUntil: "networkidle" });

    // 4. Click "+ Add Product" button
    const addProductBtn = page.getByRole("button", { name: /Add product/i }).first();
    await expect(addProductBtn).toBeVisible({ timeout: 15000 });
    await addProductBtn.click();
    await page.waitForTimeout(600);

    // 5. Scroll down to Sales Channel & Visibility
    const sectionPlacementCard = page.locator("text=Homepage Sections Placement").first();
    await expect(sectionPlacementCard).toBeVisible();

    // 6. Check toggle button says "Select Sections ▼"
    const toggleBtn = page.locator("#toggle-homepage-sections-selector");
    await expect(toggleBtn).toBeVisible();
    await expect(toggleBtn).toContainText("Select Sections");

    // 7. Click to expand section picker
    await toggleBtn.click();
    await page.waitForTimeout(300);

    // 8. Verify the sections list is visible
    const diwaliItem = page.locator("div[role='button']:has-text('Diwali Specials')").first();
    const summerItem = page.locator("div[role='button']:has-text('Summer Essentials')").first();
    await expect(diwaliItem).toBeVisible();
    await expect(summerItem).toBeVisible();

    // 9. Select "Diwali Specials"
    await diwaliItem.click();
    await page.waitForTimeout(200);

    // Verify counter updated to "1 Section"
    await expect(toggleBtn).toContainText("1 Section");

    // 10. Close section picker
    await toggleBtn.click();
    await page.waitForTimeout(200);

    // 11. Verify summary chip for Diwali Specials appears
    const diwaliChip = page.locator("span:has-text('Diwali Specials')").first();
    await expect(diwaliChip).toBeVisible();

    // 12. Re-open and test search filtering
    await toggleBtn.click();
    await page.waitForTimeout(200);
    const searchInput = page.locator("input[placeholder*='Search sections']");
    await searchInput.fill("Summer");
    await page.waitForTimeout(200);

    await expect(summerItem).toBeVisible();
    await expect(diwaliItem).not.toBeVisible();

    // Select Summer Essentials as well
    await summerItem.click();
    await page.waitForTimeout(200);
    await expect(toggleBtn).toContainText("2 Sections");

    // Clear search
    await searchInput.fill("");
    await page.waitForTimeout(200);
    await expect(diwaliItem).toBeVisible();

    // Take screenshot of the section placement UI
    await page.screenshot({
      path: "C:/Users/jackx/.gemini/antigravity-ide/brain/08ae1c4e-cd51-4f35-aa08-92f5bcd5d741/product_sections_placement_verified.png",
    });
  });
});
