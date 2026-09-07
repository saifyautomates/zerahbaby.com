import { test, expect } from "@playwright/test";

test.describe("Add to Cart Interaction & Cart Section Suite", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate and clear guest cart storage
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.removeItem("zerah-cart-guest");
      sessionStorage.clear();
    });
    await page.waitForTimeout(200);
  });

  test("1. Simple product add: creates rich cart item card below with all details", async ({
    page,
  }) => {
    await page.goto("/product/dangri", { waitUntil: "networkidle" });

    // Ensure cart section is not visible initially
    await expect(page.locator("#cart-section")).toHaveCount(0);

    // Primary product action button
    const addToBagBtn = page.locator("main").getByRole("button", { name: /^Add to bag$/i }).first();
    await expect(addToBagBtn).toBeVisible();
    await addToBagBtn.click();

    // 2. Immediately show/update the cart item card in the cart section below
    const cartSection = page.locator("#cart-section");
    await expect(cartSection).toBeVisible({ timeout: 5000 });

    // 3. The newly added item must appear as a proper existing cart-item card
    const cartItemCard = cartSection.locator("li").first();
    await expect(cartItemCard).toBeVisible();

    // 4. The card must show: image, name, price, quantity controls, remove button
    await expect(cartItemCard.locator("img")).toBeVisible();
    await expect(cartItemCard.getByRole("link", { name: "dangri" }).first()).toBeVisible();
    await expect(cartItemCard.getByRole("button", { name: "Decrease quantity" })).toBeVisible();
    await expect(cartItemCard.getByRole("button", { name: "Increase quantity" })).toBeVisible();
    await expect(cartItemCard.getByRole("button", { name: /Remove/i })).toBeVisible();

    // Verify quantity is 1
    await expect(cartItemCard.locator("span.w-5")).toHaveText("1");

    // 7. Cart count in header updates instantly
    const cartBadge = page.locator('a[href="/cart"] span');
    await expect(cartBadge).toHaveText("1");
  });

  test("2. Same variant/SKU added twice: increases quantity on existing card without duplicate", async ({
    page,
  }) => {
    await page.goto("/product/dangri", { waitUntil: "networkidle" });

    const addToBagBtn = page.locator("main").getByRole("button", { name: /^Add to bag$/i }).first();
    await expect(addToBagBtn).toBeVisible();

    // Add once
    await addToBagBtn.click();
    const cartSection = page.locator("#cart-section");
    await expect(cartSection).toBeVisible({ timeout: 5000 });
    await expect(cartSection.locator("li")).toHaveCount(1);
    await expect(cartSection.locator("li").first().locator("span.w-5")).toHaveText("1");

    // Wait for rapid-click lock to clear
    await page.waitForTimeout(300);

    // Add second time (same product/variant)
    await addToBagBtn.click();

    // Must still have exactly 1 card, but with quantity = 2
    await expect(cartSection.locator("li")).toHaveCount(1);
    await expect(cartSection.locator("li").first().locator("span.w-5")).toHaveText("2");

    // Cart badge in header should update to 2
    const cartBadge = page.locator('a[href="/cart"] span');
    await expect(cartBadge).toHaveText("2");
  });

  test("3. Product with variants: selects and displays authoritative variant attributes", async ({
    page,
  }) => {
    await page.goto("/product/dangri", { waitUntil: "networkidle" });

    const addToBagBtn = page.locator("main").getByRole("button", { name: /^Add to bag$/i }).first();
    await expect(addToBagBtn).toBeVisible();
    await addToBagBtn.click();

    const cartSection = page.locator("#cart-section");
    await expect(cartSection).toBeVisible({ timeout: 5000 });

    const cartItem = cartSection.locator("li").first();
    await expect(cartItem).toBeVisible();
    await cartItem.scrollIntoViewIfNeeded();
    await expect(cartItem.locator("img")).toBeVisible();

    // Verify SKU or price is displayed on card
    const skuElem = cartItem.locator('p:has-text("ZR-CL-825985")').first();
    await expect(skuElem).toBeAttached();
    await expect(skuElem).toContainText("ZR-CL-825985");
    await expect(cartItem.getByText("₹999").first()).toBeVisible();
  });

  test("4. Card controls: Quantity changes (+/-) and Remove button work instantly", async ({
    page,
  }) => {
    await page.goto("/product/dangri", { waitUntil: "networkidle" });

    const addToBagBtn = page.locator("main").getByRole("button", { name: /^Add to bag$/i }).first();
    await addToBagBtn.click();

    const cartSection = page.locator("#cart-section");
    await expect(cartSection).toBeVisible({ timeout: 5000 });
    const cartItem = cartSection.locator("li").first();

    // Initial qty = 1
    await expect(cartItem.locator("span.w-5")).toHaveText("1");

    // Increase qty to 2
    const incBtn = cartItem.getByRole("button", { name: "Increase quantity" });
    await incBtn.click();
    await expect(cartItem.locator("span.w-5")).toHaveText("2");

    // Decrease qty back to 1
    const decBtn = cartItem.getByRole("button", { name: "Decrease quantity" });
    await decBtn.click();
    await expect(cartItem.locator("span.w-5")).toHaveText("1");

    // Click "Remove"
    const removeBtn = cartItem.getByRole("button", { name: /Remove/i });
    await removeBtn.click();

    // Section should disappear
    await expect(cartSection).toHaveCount(0);
  });

  test("5. Persistence: Cart items persist across full page refresh", async ({ page }) => {
    await page.goto("/product/dangri", { waitUntil: "networkidle" });

    const addToBagBtn = page.locator("main").getByRole("button", { name: /^Add to bag$/i }).first();
    await addToBagBtn.click();

    const cartSection = page.locator("#cart-section");
    await expect(cartSection).toBeVisible({ timeout: 5000 });
    await expect(cartSection.locator("li")).toHaveCount(1);

    // Refresh page
    await page.reload({ waitUntil: "networkidle" });

    // Verify cart section still contains the persisted item card
    const reloadedCartSection = page.locator("#cart-section");
    await expect(reloadedCartSection).toBeVisible({ timeout: 5000 });
    await expect(reloadedCartSection.locator("li")).toHaveCount(1);
    await expect(reloadedCartSection.locator("li").first().locator("span.w-5")).toHaveText("1");
  });

  test("6. Main /cart page uses the exact same CartItemCard design", async ({ page }) => {
    await page.goto("/product/dangri", { waitUntil: "networkidle" });

    const addToBagBtn = page.locator("main").getByRole("button", { name: /^Add to bag$/i }).first();
    await addToBagBtn.click();

    // Wait for cart section to appear
    const cartSection = page.locator("#cart-section");
    await expect(cartSection).toBeVisible({ timeout: 5000 });

    // Navigate to full cart page via cart section link
    await cartSection.locator('a[href="/cart"]').first().click();
    await expect(page).toHaveURL(/\/cart/);
    await expect(page.getByRole("heading", { name: "Your bag" })).toBeVisible();

    // Card should be rendered using the exact same CartItemCard
    const mainCartItem = page.locator("ul.space-y-4 > li").first();
    await expect(mainCartItem).toBeVisible();
    await expect(mainCartItem.locator("img")).toBeVisible();
    await expect(mainCartItem.getByRole("button", { name: "Increase quantity" })).toBeVisible();
    await expect(mainCartItem.getByRole("button", { name: "Decrease quantity" })).toBeVisible();
    await expect(mainCartItem.getByRole("button", { name: /Remove/i })).toBeVisible();
  });
});
