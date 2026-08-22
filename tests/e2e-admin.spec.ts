import { test, expect } from "@playwright/test";

test.describe("Zerah Baby And Kids - Admin Security & Functionality Tests", () => {
  // Test 1: Redirect to Auth
  test("Admin routes should redirect to Auth when unauthenticated", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/.*\/auth/);
    await expect(page.getByRole("heading", { name: /Sign in/i })).toBeVisible();
    await expect(page.getByPlaceholder(/Email or Mobile Number/i)).toBeVisible();
  });

  test("Supabase RLS should prevent unauthenticated product creation", async ({ request }) => {
    const response = await request.post(
      process.env.VITE_SUPABASE_URL + "/rest/v1/products" ||
        "http://127.0.0.1:54321/rest/v1/products",
      {
        data: {
          name: "Hacked Product",
          slug: "hacked",
        },
        headers: {
          apikey: process.env.VITE_SUPABASE_ANON_KEY || "",
        },
      },
    );
    // Should be unauthorized or forbidden because of RLS
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });
});
