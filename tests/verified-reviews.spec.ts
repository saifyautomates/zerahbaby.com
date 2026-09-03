import { test, expect } from "@playwright/test";
import { calculateReviewStats, type Review } from "../src/lib/reviews";

test.describe("Verified Purchase Reviews & Stats Engine Suite", () => {
  const mockReviews: Review[] = [
    {
      id: "r1",
      product_id: "prod-tshirt-1",
      user_id: "user-1",
      order_id: "ord-101",
      rating: 5,
      title: "Excellent baby tshirt!",
      comment: "Super soft pure organic cotton. Stays soft after multiple washes.",
      images: ["https://example.com/photo1.jpg", "https://example.com/photo2.jpg"],
      verified_purchase: true,
      status: "approved",
      created_at: "2026-08-20T10:00:00Z",
      updated_at: "2026-08-20T10:00:00Z",
      user_name: "Pooja Sharma",
    },
    {
      id: "r2",
      product_id: "prod-tshirt-1",
      user_id: "user-2",
      order_id: "ord-102",
      rating: 5,
      title: "Loved the quality",
      comment: "Fit is perfect for my 6-month-old.",
      images: ["https://example.com/photo3.jpg"],
      verified_purchase: true,
      status: "approved",
      created_at: "2026-08-21T12:00:00Z",
      updated_at: "2026-08-21T12:00:00Z",
      user_name: "Rahul Verma",
    },
    {
      id: "r3",
      product_id: "prod-tshirt-1",
      user_id: "user-3",
      order_id: "ord-103",
      rating: 4,
      title: "Good product",
      comment: "Color is slightly lighter than photo but fabric is genuinely organic.",
      images: [],
      verified_purchase: true,
      status: "approved",
      created_at: "2026-08-22T14:00:00Z",
      updated_at: "2026-08-22T14:00:00Z",
      user_name: "Anjali Gupta",
    },
    {
      id: "r4",
      product_id: "prod-tshirt-1",
      user_id: "user-4",
      order_id: "ord-104",
      rating: 2,
      title: "Size was small",
      comment: "Had to exchange for larger size.",
      images: [],
      verified_purchase: true,
      status: "approved",
      created_at: "2026-08-23T15:00:00Z",
      updated_at: "2026-08-23T15:00:00Z",
      user_name: "Vikram Singh",
    },
  ];

  test("1. Statistical Calculations (Average, Percentages, Counts)", () => {
    const stats = calculateReviewStats(mockReviews);

    // Sum: 5 + 5 + 4 + 2 = 16 / 4 = 4.0 average
    expect(stats.averageRating).toBe(4.0);
    expect(stats.totalRatings).toBe(4);
    expect(stats.totalReviews).toBe(4);

    // 5-Star: 2 out of 4 = 50%
    expect(stats.breakdown[5].count).toBe(2);
    expect(stats.breakdown[5].pct).toBe(50);

    // 4-Star: 1 out of 4 = 25%
    expect(stats.breakdown[4].count).toBe(1);
    expect(stats.breakdown[4].pct).toBe(25);

    // 3-Star: 0 out of 4 = 0%
    expect(stats.breakdown[3].count).toBe(0);
    expect(stats.breakdown[3].pct).toBe(0);

    // 2-Star: 1 out of 4 = 25%
    expect(stats.breakdown[2].count).toBe(1);
    expect(stats.breakdown[2].pct).toBe(25);

    // 1-Star: 0 out of 4 = 0%
    expect(stats.breakdown[1].count).toBe(0);
    expect(stats.breakdown[1].pct).toBe(0);

    // Recommendation % (ratings >= 4: 3 out of 4 = 75%)
    expect(stats.recommendPct).toBe(75);
  });

  test("2. Customer Photo Aggregation and Metadata Extraction", () => {
    const stats = calculateReviewStats(mockReviews);

    expect(stats.allImages.length).toBe(3);
    expect(stats.allImages[0].url).toBe("https://example.com/photo1.jpg");
    expect(stats.allImages[0].rating).toBe(5);
    expect(stats.allImages[1].url).toBe("https://example.com/photo2.jpg");
    expect(stats.allImages[2].url).toBe("https://example.com/photo3.jpg");
  });

  test("3. Empty Reviews Handling (Zero State Resilience)", () => {
    const stats = calculateReviewStats([]);

    expect(stats.averageRating).toBe(0);
    expect(stats.totalRatings).toBe(0);
    expect(stats.totalReviews).toBe(0);
    expect(stats.recommendPct).toBe(0);
    expect(stats.allImages.length).toBe(0);
    expect(stats.breakdown[5].pct).toBe(0);
  });

  test("4. Verified Buyer Specific Product Matching Logic", () => {
    // Simulating user who purchased only "organic-cotton-onesie"
    const userOrders = [
      {
        id: "ord-901",
        status: "delivered",
        order_items: [
          { product_id: "prod-onesie-uuid", product_slug: "organic-cotton-onesie" },
          { product_id: "prod-bib-uuid", product_slug: "baby-cotton-bib" },
        ],
      },
      {
        id: "ord-902",
        status: "cancelled", // Cancelled order must NOT grant review permission
        order_items: [{ product_id: "prod-toy-uuid", product_slug: "wooden-rattle-toy" }],
      },
    ];

    const canReviewPurchasedItem = userOrders.some(
      (o) =>
        o.status !== "cancelled" &&
        o.order_items.some((i) => i.product_slug === "organic-cotton-onesie"),
    );
    expect(canReviewPurchasedItem).toBe(true);

    const canReviewUnpurchasedItem = userOrders.some(
      (o) =>
        o.status !== "cancelled" &&
        o.order_items.some((i) => i.product_slug === "velvet-baby-dress"),
    );
    expect(canReviewUnpurchasedItem).toBe(false);

    const canReviewCancelledItem = userOrders.some(
      (o) =>
        o.status !== "cancelled" &&
        o.order_items.some((i) => i.product_slug === "wooden-rattle-toy"),
    );
    expect(canReviewCancelledItem).toBe(false);
  });

  test("5. UUID Regex Validator & Fallback Slug Protection", () => {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    const validUuid = "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d";
    const invalidSlug = "organic-cotton-onesie";
    const invalidShortId = "12345";

    expect(UUID_REGEX.test(validUuid)).toBe(true);
    expect(UUID_REGEX.test(invalidSlug)).toBe(false);
    expect(UUID_REGEX.test(invalidShortId)).toBe(false);

    // Resolves UUID from order_item if present
    const orderItem = {
      product_id: validUuid,
      product_slug: invalidSlug,
      name: "Organic Cotton Onesie",
    };

    const resolvedId =
      (UUID_REGEX.test(orderItem.product_id) ? orderItem.product_id : null) ||
      orderItem.product_slug;
    expect(resolvedId).toBe(validUuid);
  });
});
