import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://wbbatgbvizhghtkvuguf.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_WiczJQTx4afGJ02WAiUIUw_8YlWjkSP";

test.describe("Zerah Baby And Kids - Admin Security & Functionality Tests", () => {
  test("1. Admin main route (/admin) redirects to Auth when unauthenticated", async ({ page }) => {
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/.*\/auth/, { timeout: 15000 });
    await expect(page.getByRole("heading", { name: /Sign in/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByPlaceholder(/Email or Mobile Number/i)).toBeVisible({ timeout: 15000 });
  });

  test("2. Admin splat sub-routes (/admin/billing, /admin/orders) redirect to Auth when unauthenticated", async ({
    page,
  }) => {
    await page.goto("/admin/billing", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/.*\/auth/, { timeout: 15000 });

    await page.goto("/admin/orders", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/.*\/auth/, { timeout: 15000 });
  });

  test("3. Database RLS: Anonymous access to offline_sales is strictly blocked", async () => {
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error, status } = await anonClient.from("offline_sales").select("*").limit(5);

    // Must be blocked by RLS / permissions
    const isBlocked = error !== null || status === 401 || status === 403 || !data || data.length === 0;
    expect(isBlocked).toBe(true);
    if (error) {
      expect(error.message).toMatch(/permission denied|not authorized|violates row-level security/i);
    }
  });

  test("4. Database RLS: Anonymous access to store_credit_ledger is strictly blocked", async () => {
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error, status } = await anonClient.from("store_credit_ledger").select("*").limit(5);

    const isBlocked = error !== null || status === 401 || status === 403 || !data || data.length === 0;
    expect(isBlocked).toBe(true);
    if (error) {
      expect(error.message).toMatch(/permission denied|not authorized|violates row-level security/i);
    }
  });

  test("5. Database RLS: Anonymous access to admin_notifications is strictly blocked", async () => {
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error, status } = await anonClient.from("admin_notifications").select("*").limit(5);

    const isBlocked = error !== null || status === 401 || status === 403 || !data || data.length === 0;
    expect(isBlocked).toBe(true);
    if (error) {
      expect(error.message).toMatch(/permission denied|not authorized|violates row-level security/i);
    }
  });

  test("6. Database RLS: Anonymous access to offline_sale_items is strictly blocked", async () => {
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error, status } = await anonClient.from("offline_sale_items").select("*").limit(5);

    const isBlocked = error !== null || status === 401 || status === 403 || !data || data.length === 0;
    expect(isBlocked).toBe(true);
    if (error) {
      expect(error.message).toMatch(/permission denied|not authorized|violates row-level security/i);
    }
  });

  test("7. Supabase RLS prevents unauthenticated product creation", async ({ request }) => {
    const response = await request.post(SUPABASE_URL + "/rest/v1/products", {
      data: {
        name: "Hacked Product",
        slug: "hacked",
      },
      headers: {
        apikey: SUPABASE_ANON_KEY,
      },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });
});
