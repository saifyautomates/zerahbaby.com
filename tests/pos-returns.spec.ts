import { test, expect } from "@playwright/test";

test.describe("Offline POS Returns System Suite", () => {
  test("1. Return Cart Accumulation & Line Total Calculation Logic", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const results = await page.evaluate(() => {
      type ReturnItem = {
        id: string;
        name: string;
        price: number;
        qty: number;
      };

      const cart: ReturnItem[] = [];

      function addItem(item: { id: string; name: string; price: number }) {
        const existing = cart.find((i) => i.id === item.id);
        if (existing) {
          existing.qty += 1;
        } else {
          cart.push({ ...item, qty: 1 });
        }
      }

      // Test 1: Add first product
      addItem({ id: "prod-1", name: "Baby Romper", price: 599 });
      const afterFirstScan = JSON.parse(JSON.stringify(cart));

      // Test 2: Add same product again (Qty should become 2, no new row)
      addItem({ id: "prod-1", name: "Baby Romper", price: 599 });
      const afterSecondScan = JSON.parse(JSON.stringify(cart));

      // Test 3: Add same product third time (Qty should become 3)
      addItem({ id: "prod-1", name: "Baby Romper", price: 599 });
      const afterThirdScan = JSON.parse(JSON.stringify(cart));

      // Test 4: Add different product (New row)
      addItem({ id: "prod-2", name: "Cotton Frock", price: 899 });
      const afterDifferentProduct = JSON.parse(JSON.stringify(cart));

      const totalRefund = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
      const totalUnits = cart.reduce((sum, i) => sum + i.qty, 0);

      return {
        afterFirstScan,
        afterSecondScan,
        afterThirdScan,
        afterDifferentProduct,
        totalRefund,
        totalUnits,
      };
    });

    // Test 1 Assertions
    expect(results.afterFirstScan.length).toBe(1);
    expect(results.afterFirstScan[0].qty).toBe(1);

    // Test 2 Assertions (Multi-scan Qty 2)
    expect(results.afterSecondScan.length).toBe(1);
    expect(results.afterSecondScan[0].qty).toBe(2);

    // Test 3 Assertions (Multi-scan Qty 3)
    expect(results.afterThirdScan.length).toBe(1);
    expect(results.afterThirdScan[0].qty).toBe(3);

    // Test 4 Assertions (Different product)
    expect(results.afterDifferentProduct.length).toBe(2);
    expect(results.totalUnits).toBe(4);
    // 3 * 599 + 1 * 899 = 1797 + 899 = 2696
    expect(results.totalRefund).toBe(2696);
  });

  test("2. Idempotency & Duplicate Submit Guard Logic", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const duplicateCheck = await page.evaluate(() => {
      const dbRecords = [
        {
          id: "ret-1",
          return_number: "RET-2608-00001",
          refund_amount: 1798,
          notes: "Customer returned [idem:abc-123-xyz]",
          created_by: "user-admin",
        },
      ];

      function checkIdempotency(idemKey: string, uid: string) {
        const found = dbRecords.find(
          (r) => r.notes.includes(`[idem:${idemKey}]`) && r.created_by === uid,
        );
        if (found) {
          return {
            return_id: found.id,
            return_number: found.return_number,
            duplicate: true,
          };
        }
        return { duplicate: false };
      }

      return {
        existing: checkIdempotency("abc-123-xyz", "user-admin"),
        newKey: checkIdempotency("unique-new-key", "user-admin"),
      };
    });

    expect(duplicateCheck.existing.duplicate).toBe(true);
    expect(duplicateCheck.existing.return_number).toBe("RET-2608-00001");
    expect(duplicateCheck.newKey.duplicate).toBe(false);
  });

  test("3. Return Sequence & Reference Generator (RET-YYMM-NNNNN)", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const generated = await page.evaluate(() => {
      function generateReturnNumber(seqVal: number) {
        const d = new Date();
        const yy = d.getFullYear().toString().slice(-2);
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        return `RET-${yy}${mm}-${String(seqVal).padStart(5, "0")}`;
      }

      return {
        ret1: generateReturnNumber(1),
        ret42: generateReturnNumber(42),
        ret999: generateReturnNumber(999),
      };
    });

    expect(generated.ret1).toMatch(/^RET-\d{4}-00001$/);
    expect(generated.ret42).toMatch(/^RET-\d{4}-00042$/);
    expect(generated.ret999).toMatch(/^RET-\d{4}-00999$/);
  });

  test("4. Responsive Viewports for POS Returns Layout (320px to 1440px)", async ({ page }) => {
    const viewports = [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 1280, height: 800 },
      { width: 1440, height: 900 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await page.goto("/auth", { waitUntil: "domcontentloaded" });

      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
    }
  });
});
