import { expect, test } from "@playwright/test";
import { resolveHistoricalReturnPricing } from "../src/lib/return-pricing";

test.describe("Historical POS return price regression", () => {
  test("uses the exact stored discounted price when the snapshot is valid", () => {
    expect(
      resolveHistoricalReturnPricing({
        finalUnitPaidPrice: 680,
        unitSellingPrice: 800,
        saleSubtotal: 1_000,
        saleTotal: 850,
        saleDiscount: 100,
        saleCouponDiscount: 50,
        allocatedBillDiscount: 80,
        allocatedCouponDiscount: 40,
      }),
    ).toEqual({
      finalUnitPaidPrice: 680,
      allocatedBillDiscount: 80,
      allocatedCouponDiscount: 40,
    });
  });

  test("rebuilds a missing snapshot using bill and coupon discounts together", () => {
    expect(
      resolveHistoricalReturnPricing({
        finalUnitPaidPrice: 0,
        unitSellingPrice: 800,
        saleSubtotal: 1_000,
        saleTotal: 850,
        saleDiscount: 100,
        saleCouponDiscount: 50,
        allocatedBillDiscount: 0,
        allocatedCouponDiscount: 0,
      }),
    ).toEqual({
      finalUnitPaidPrice: 680,
      allocatedBillDiscount: 80,
      allocatedCouponDiscount: 40,
    });
  });

  test("repairs a positive but undiscounted legacy snapshot", () => {
    const result = resolveHistoricalReturnPricing({
      finalUnitPaidPrice: 800,
      unitSellingPrice: 800,
      saleSubtotal: 1_000,
      saleTotal: 850,
      saleDiscount: 100,
      saleCouponDiscount: 50,
      allocatedBillDiscount: 0,
      allocatedCouponDiscount: 0,
    });

    expect(result.finalUnitPaidPrice).toBe(680);
    expect(result.allocatedBillDiscount).toBe(80);
    expect(result.allocatedCouponDiscount).toBe(40);
  });

  test("reconstructs a missing subtotal from net total and discounts", () => {
    const result = resolveHistoricalReturnPricing({
      finalUnitPaidPrice: 0,
      unitSellingPrice: 800,
      saleSubtotal: 0,
      saleTotal: 850,
      saleDiscount: 100,
      saleCouponDiscount: 50,
      allocatedBillDiscount: 0,
      allocatedCouponDiscount: 0,
    });

    expect(result.finalUnitPaidPrice).toBe(680);
  });

  test("uses selling price when there are no sale-level discounts", () => {
    expect(
      resolveHistoricalReturnPricing({
        finalUnitPaidPrice: 0,
        unitSellingPrice: 800,
        saleSubtotal: 1_000,
        saleTotal: 1_000,
        saleDiscount: 0,
        saleCouponDiscount: 0,
        allocatedBillDiscount: 0,
        allocatedCouponDiscount: 0,
      }).finalUnitPaidPrice,
    ).toBe(800);
  });
});
