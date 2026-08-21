import { test, expect } from "@playwright/test";

test.describe("Zerah Baby And Kids - Admin Security Tests", () => {
  test("Admin routes should redirect to Auth when unauthenticated", async ({ page }) => {
    // Attempt to navigate to the admin page directly
    await page.goto("/admin");

    // In TanStack Start, the auth middleware redirect might append the redirect param
    await expect(page).toHaveURL(/.*\/auth/);

    // The auth page should clearly indicate you need to sign in
    await expect(page.getByRole("heading", { name: /Sign in/i })).toBeVisible();
    await expect(page.getByPlaceholder(/Email or Mobile Number/i)).toBeVisible();
  });
});
