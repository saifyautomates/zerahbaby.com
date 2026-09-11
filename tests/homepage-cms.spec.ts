import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { resolveSectionProducts, type HomepageSection } from "../src/lib/homepage-sections";
import type { Product } from "../src/lib/store";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://wbbatgbvizhghtkvuguf.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_WiczJQTx4afGJ02WAiUIUw_8YlWjkSP";

const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

test.describe("Homepage Multi-Section CMS & Security Suite", () => {
  // ─── 1. DATABASE RLS SECURITY TESTS ─────────────────────────────
  test("1. RLS: Anonymous users can only query published and visible sections", async () => {
    const { data, error } = await anonClient
      .from("homepage_sections")
      .select("id, title, status, is_visible");

    expect(error).toBeNull();
    expect(data).toBeDefined();
    // All returned rows MUST be published and visible
    for (const row of data || []) {
      expect(row.status).toBe("published");
      expect(row.is_visible).toBe(true);
    }
  });

  test("2. RLS: Anonymous users CANNOT insert new homepage sections", async () => {
    const { data, error } = await anonClient.from("homepage_sections").insert({
      title: "Hacked Section",
      slug: "hacked-section-" + Date.now(),
      section_type: "PRODUCT_GRID",
      source_type: "MANUAL",
      sort_order: 999,
      status: "published",
      is_visible: true,
    } as any);

    // Must fail due to RLS
    expect(error).toBeDefined();
    expect(error?.message).toMatch(/permission denied|violates row-level security|new row violates/i);
    expect(data).toBeNull();
  });

  test("3. RLS: Anonymous users CANNOT update any homepage section", async () => {
    // Attempt to update the first section
    const { data: sections } = await anonClient
      .from("homepage_sections")
      .select("id")
      .limit(1);

    if (sections && sections.length > 0) {
      const targetId = sections[0].id;
      const { data, error } = await anonClient
        .from("homepage_sections")
        .update({ title: "Attacker Renamed Title" } as any)
        .eq("id", targetId)
        .select();

      // Either error or empty data (RLS prevents update)
      if (error) {
        expect(error.message).toMatch(/permission denied|violates row-level security/i);
      } else {
        expect(data?.length ?? 0).toBe(0);
      }
    }
  });

  test("4. RLS: Anonymous users CANNOT delete any homepage section", async () => {
    const { data: sections } = await anonClient
      .from("homepage_sections")
      .select("id")
      .limit(1);

    if (sections && sections.length > 0) {
      const targetId = sections[0].id;
      const { data, error } = await anonClient
        .from("homepage_sections")
        .delete()
        .eq("id", targetId)
        .select();

      if (error) {
        expect(error.message).toMatch(/permission denied|violates row-level security/i);
      } else {
        expect(data?.length ?? 0).toBe(0);
      }
    }
  });

  test("5. RLS: Anonymous users CANNOT tamper with homepage_section_items", async () => {
    const { data, error } = await anonClient
      .from("homepage_section_items")
      .insert({
        section_id: "00000000-0000-0000-0000-000000000000",
        product_id: "00000000-0000-0000-0000-000000000000",
        sort_order: 1,
      } as any);

    expect(error).toBeDefined();
    expect(error?.message).toMatch(/permission denied|violates row-level security/i);
  });

  // ─── 2. STOREFRONT PUBLIC VISITOR TESTS ─────────────────────────
  test("6. Public Storefront: Renders database-backed sections without admin controls", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Verify sections container is present
    await page.waitForSelector("main", { timeout: 15000 });

    // Verify admin toolbar / buttons are strictly NOT visible for public visitors
    const addSectionBtn = page.getByRole("button", { name: /\+ Add Section/i });
    await expect(addSectionBtn).not.toBeVisible();

    const adminEditBtns = page.getByRole("button", { name: /Edit Section/i });
    await expect(adminEditBtns).toHaveCount(0);

    // Check that at least one product section title exists on the homepage
    const sectionHeadings = page.locator("h2");
    const count = await sectionHeadings.count();
    expect(count).toBeGreaterThan(0);
  });

  // ─── 3. RESOLUTION LOGIC UNIT TESTS ─────────────────────────────
  test("7. Section Logic: resolveSectionProducts correctly resolves MANUAL items in order", () => {
    const mockProducts: Product[] = [
      {
        id: "prod-1",
        uuid: "uuid-1",
        name: "Organic Romper",
        price: 599,
        mrp: 999,
        image: "https://example.com/1.jpg",
        category: "clothing",
        rating: 4.8,
        reviewsCount: 12,
        stock: 5,
        description: "Test",
        features: [],
        featured: true,
        tags: ["organic"],
      },
      {
        id: "prod-2",
        uuid: "uuid-2",
        name: "Wooden Teether",
        price: 349,
        mrp: 499,
        image: "https://example.com/2.jpg",
        category: "toys",
        rating: 4.9,
        reviewsCount: 25,
        stock: 10,
        description: "Test",
        features: [],
        featured: true,
        tags: ["wooden"],
      },
      {
        id: "prod-3",
        uuid: "uuid-3",
        name: "Cotton Blanket",
        price: 799,
        mrp: 1299,
        image: "https://example.com/3.jpg",
        category: "care",
        rating: 4.7,
        reviewsCount: 8,
        stock: 2,
        description: "Test",
        features: [],
        featured: false,
        tags: [],
      },
    ];

    const manualSection: HomepageSection = {
      id: "sec-manual",
      title: "Handpicked Favorites",
      subtitle: "Specially selected",
      slug: "handpicked",
      section_type: "PRODUCT_GRID",
      source_type: "MANUAL",
      status: "published",
      is_visible: true,
      sort_order: 1,
      display_settings: {
        max_products: 8,
        show_subtitle: true,
        show_cta: true,
      },
      items: [
        {
          id: "item-2",
          section_id: "sec-manual",
          product_id: "prod-2",
          sort_order: 1,
          is_visible: true,
        },
        {
          id: "item-1",
          section_id: "sec-manual",
          product_id: "prod-1",
          sort_order: 2,
          is_visible: true,
        },
      ],
    };

    const resolved = resolveSectionProducts(manualSection, mockProducts);
    expect(resolved.length).toBe(2);
    // Preserves item order (prod-2 first, then prod-1)
    expect(resolved[0].id).toBe("prod-2");
    expect(resolved[1].id).toBe("prod-1");
  });

  test("8. Section Logic: resolveSectionProducts respects max_products", () => {
    const mockProducts: Product[] = Array.from({ length: 20 }, (_, i) => ({
      id: `p-${i}`,
      uuid: `u-${i}`,
      name: `Product ${i}`,
      price: 500,
      mrp: 800,
      image: "https://example.com/p.jpg",
      category: "clothing",
      rating: 4.5,
      reviewsCount: 1,
      stock: 5,
      description: "Desc",
      features: [],
      featured: true,
      tags: [],
    }));

    const bestsellerSection: HomepageSection = {
      id: "sec-best",
      title: "Bestsellers",
      subtitle: "Top picks",
      slug: "bestsellers",
      section_type: "PRODUCT_GRID",
      source_type: "BESTSELLERS",
      status: "published",
      is_visible: true,
      sort_order: 1,
      display_settings: {
        max_products: 4,
      },
    };

    const resolved = resolveSectionProducts(bestsellerSection, mockProducts);
    expect(resolved.length).toBe(4);
  });
});
