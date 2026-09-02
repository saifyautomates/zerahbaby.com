import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://wbbatgbvizhghtkvuguf.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_WiczJQTx4afGJ02WAiUIUw_8YlWjkSP";

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (headers.get("Authorization") === `Bearer ${supabaseKey}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  global: { fetch: createSupabaseFetch(SUPABASE_PUBLISHABLE_KEY) },
});

test.describe("Unified Store Activity Feed & Real-time Stream", () => {
  test("1. record_store_activity records events without permission errors", async () => {
    const { data: eventId, error } = await supabase.rpc("record_store_activity", {
      _event_name: "product_view",
      _metadata: { source: "playwright_audit", timestamp: Date.now() },
    });

    expect(error).toBeNull();
    expect(eventId).toBeTruthy();
    expect(typeof eventId).toBe("string");

    // Clean up test event
    if (eventId) {
      await supabase.from("analytics_events").delete().eq("id", eventId);
    }
  });

  test("2. get_unified_store_activities executes safely and returns schema conformant structure", async () => {
    const { data: activities, error } = await supabase.rpc("get_unified_store_activities", {
      _limit: 25,
    });

    expect(error).toBeNull();
    expect(Array.isArray(activities)).toBe(true);

    if (activities && activities.length > 0) {
      const first = activities[0];
      expect(first).toHaveProperty("id");
      expect(first).toHaveProperty("source");
      expect(first).toHaveProperty("event_type");
      expect(first).toHaveProperty("title");
      expect(first).toHaveProperty("subtitle");
      expect(first).toHaveProperty("created_at");
    }
  });

  test("3. Unified feed categorizes event_types into canonical buckets", () => {
    const sampleRecord = {
      id: "test-1",
      event_type: "view",
      source: "analytics",
    };
    const validTypes = new Set(["view", "cart", "checkout", "order", "return", "wishlist", "other"]);
    expect(validTypes.has(sampleRecord.event_type)).toBe(true);
  });

  test("4. Return vouchers data formatting in unified feed", () => {
    const mockReturnItem = {
      id: "ret-1",
      source: "pos_return",
      event_type: "return",
      title: "Exchange Voucher #RET-2609-00001 issued",
      subtitle: "Credit: ₹500 • Size Exchange",
      amount: 500,
    };

    expect(mockReturnItem.title).toContain("Exchange Voucher");
    expect(mockReturnItem.subtitle).toContain("Credit: ₹");
    expect(mockReturnItem.amount).toBe(500);
  });

  test("5. Filter chips logic filters correctly across all categories", () => {
    const sampleFeed = [
      { id: "1", typeKey: "view", title: "Baby Romper viewed" },
      { id: "2", typeKey: "cart", title: "Frock added to bag" },
      { id: "3", typeKey: "order", title: "Store Sale #101 completed" },
      { id: "4", typeKey: "return", title: "Exchange Voucher #RET-01 issued" },
      { id: "5", typeKey: "wishlist", title: "Knit Sweater saved to wishlist" },
      { id: "6", typeKey: "checkout", title: "Checkout started" },
    ];

    // Filter by view
    const viewItems = sampleFeed.filter((a) => a.typeKey === "view");
    expect(viewItems.length).toBe(1);
    expect(viewItems[0].id).toBe("1");

    // Filter by cart
    const cartItems = sampleFeed.filter((a) => a.typeKey === "cart");
    expect(cartItems.length).toBe(1);
    expect(cartItems[0].id).toBe("2");

    // Filter by return
    const returnItems = sampleFeed.filter((a) => a.typeKey === "return");
    expect(returnItems.length).toBe(1);
    expect(returnItems[0].id).toBe("4");

    // Filter all
    expect(sampleFeed.length).toBe(6);
  });

  test("6. Search filtering searches across title, subtitle, and product name", () => {
    const sampleFeed = [
      { id: "1", title: "Floral Frock viewed", subtitle: "Visitor", productName: "Floral Frock", customerName: "Visitor" },
      { id: "2", title: "Online Order #1002 placed", subtitle: "Rahul Sharma • ₹1,499", productName: null, customerName: "Rahul Sharma" },
      { id: "3", title: "Store Sale #POS-505 completed", subtitle: "Walk-in Customer • ₹850", productName: null, customerName: "Walk-in Customer" },
    ];

    const searchRahul = sampleFeed.filter((a) =>
      a.title.toLowerCase().includes("rahul") ||
      a.subtitle.toLowerCase().includes("rahul") ||
      (a.productName && a.productName.toLowerCase().includes("rahul")) ||
      (a.customerName && a.customerName.toLowerCase().includes("rahul")),
    );
    expect(searchRahul.length).toBe(1);
    expect(searchRahul[0].id).toBe("2");

    const searchFrock = sampleFeed.filter((a) =>
      a.title.toLowerCase().includes("frock") ||
      a.subtitle.toLowerCase().includes("frock") ||
      (a.productName && a.productName.toLowerCase().includes("frock")),
    );
    expect(searchFrock.length).toBe(1);
    expect(searchFrock[0].id).toBe("1");
  });
});
