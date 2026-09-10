import { test, expect } from "@playwright/test";

test.describe("Zérah Baby & Kids — Production World-Class SEO Suite", () => {
  const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || "http://localhost:8080";

  test("robots.txt: correctly configured with disallows and sitemap reference", async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/robots.txt`);
    expect(res.status()).toBe(200);
    const body = await res.text();

    expect(body).toContain("User-agent: *");
    expect(body).toContain("Disallow: /admin");
    expect(body).toContain("Disallow: /cart");
    expect(body).toContain("Disallow: /checkout");
    expect(body).toContain("Disallow: /orders");
    expect(body).toContain("Disallow: /wishlist");
    expect(body).toContain("Disallow: /profile");
    expect(body).toContain("Disallow: /auth");
    expect(body).toContain("Sitemap: https://zerahkids.com/sitemap.xml");
  });

  test("sitemap.xml: live database-driven sitemap has valid XML and proper filtering", async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/sitemap.xml`);
    expect(res.status()).toBe(200);
    const contentType = res.headers()["content-type"];
    expect(contentType).toContain("xml");

    const xml = await res.text();
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');

    // Public pages present
    expect(xml).toContain("<loc>https://zerahkids.com/</loc>");
    expect(xml).toContain("<loc>https://zerahkids.com/shop</loc>");
    expect(xml).toContain("<loc>https://zerahkids.com/about</loc>");
    expect(xml).toContain("<loc>https://zerahkids.com/contact</loc>");

    // Private pages MUST NOT be present
    expect(xml).not.toContain("<loc>https://zerahkids.com/cart</loc>");
    expect(xml).not.toContain("<loc>https://zerahkids.com/admin");
    expect(xml).not.toContain("<loc>https://zerahkids.com/checkout");
    expect(xml).not.toContain("<loc>https://zerahkids.com/orders");
    expect(xml).not.toContain("<loc>https://zerahkids.com/profile");
    expect(xml).not.toContain("<loc>https://zerahkids.com/auth");
    expect(xml).not.toContain("<loc>https://zerahkids.com/wishlist");
  });

  test("feed.xml: Google Merchant Center RSS 2.0 product feed", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/feed.xml`);
    expect(res.status()).toBe(200);
    const contentType = res.headers()["content-type"];
    expect(contentType).toContain("xml");

    const xml = await res.text();
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">');
    expect(xml).toContain("<title>Zérah Baby &amp; Kids Products Feed</title>");
    expect(xml).toContain("<link>https://zerahkids.com</link>");
  });

  test("Homepage: canonical, meta tags, and structured data", async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState("domcontentloaded");

    // Title & Canonical
    const title = await page.title();
    expect(title).toContain("Zérah Baby & Kids");

    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical).toBe("https://zerahkids.com");

    // Meta description
    const desc = await page.locator('meta[name="description"]').getAttribute("content");
    expect(desc).toBeTruthy();
    expect(desc?.length).toBeGreaterThan(20);

    // OpenGraph
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute("content");
    expect(ogTitle).toContain("Zérah Baby & Kids");
    const ogUrl = await page.locator('meta[property="og:url"]').getAttribute("content");
    expect(ogUrl).toBe("https://zerahkids.com");
  });

  test("Shop page: canonical, meta tags, and schema", async ({ page }) => {
    await page.goto(`${BASE_URL}/shop`);
    await page.waitForLoadState("domcontentloaded");

    const title = await page.title();
    expect(title).toContain("Shop Baby & Kids");

    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical).toBe("https://zerahkids.com/shop");

    const desc = await page.locator('meta[name="description"]').getAttribute("content");
    expect(desc).toContain("Browse the full Zérah Baby & Kids range");

    // Breadcrumb Schema
    const scriptLd = page.locator('script[type="application/ld+json"]');
    const count = await scriptLd.count();
    expect(count).toBeGreaterThanOrEqual(1);

    let foundBreadcrumb = false;
    for (let i = 0; i < count; i++) {
      const text = await scriptLd.nth(i).textContent();
      if (text && text.includes("BreadcrumbList")) {
        foundBreadcrumb = true;
        const parsed = JSON.parse(text);
        expect(parsed["@type"]).toBe("BreadcrumbList");
      }
    }
    expect(foundBreadcrumb).toBe(true);
  });

  test("Contact page: LocalBusiness / Store structured data", async ({ page }) => {
    await page.goto(`${BASE_URL}/contact`);
    await page.waitForLoadState("domcontentloaded");

    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical).toBe("https://zerahkids.com/contact");

    const scriptLd = page.locator('script[type="application/ld+json"]');
    const count = await scriptLd.count();
    let foundStore = false;
    for (let i = 0; i < count; i++) {
      const text = await scriptLd.nth(i).textContent();
      if (text && (text.includes("ClothingStore") || text.includes("Store"))) {
        foundStore = true;
        const parsed = JSON.parse(text);
        expect(parsed.name).toContain("Zérah Baby & Kids");
        expect(parsed.address.addressLocality).toContain("Kota");
        expect(parsed.telephone).toEqual(
          expect.arrayContaining(["+919057074777", "+919667571712"]),
        );
      }
    }
    expect(foundStore).toBe(true);
  });

  test("Private pages: cart, auth, checkout have noindex directive", async ({ page }) => {
    // /cart
    await page.goto(`${BASE_URL}/cart`);
    await page.waitForLoadState("domcontentloaded");
    const cartRobots = await page.locator('meta[name="robots"]').getAttribute("content");
    expect(cartRobots).toBe("noindex, nofollow");

    // /auth
    await page.goto(`${BASE_URL}/auth`);
    await page.waitForLoadState("domcontentloaded");
    const authRobots = await page.locator('meta[name="robots"]').getAttribute("content");
    expect(authRobots).toBe("noindex, nofollow");
  });

  test("Product page: dynamic metadata, schema, and open graph", async ({ page }) => {
    await page.goto(`${BASE_URL}/product/tshirrt`);
    await page.waitForLoadState("domcontentloaded");

    // Title
    const title = await page.title();
    expect(title).toContain("tshirrt");
    expect(title).toContain("Zérah Baby & Kids");

    // Canonical
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical).toBe("https://zerahkids.com/product/tshirrt");

    // OpenGraph
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute("content");
    expect(ogTitle).toContain("tshirrt");

    // Schema.org
    const scriptLd = page.locator('script[type="application/ld+json"]');
    const count = await scriptLd.count();
    expect(count).toBeGreaterThanOrEqual(1);

    let foundProductSchema = false;
    for (let i = 0; i < count; i++) {
      const text = await scriptLd.nth(i).textContent();
      if (text && text.includes('"@type":"Product"')) {
        foundProductSchema = true;
        const parsed = JSON.parse(text);
        expect(parsed.name).toBe("tshirrt");
        expect(parsed.brand.name).toBe("Zérah");
        expect(parsed.offers.price).toBe(499);
      }
    }
    expect(foundProductSchema).toBe(true);
  });
});
