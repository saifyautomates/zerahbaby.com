/**
 * Resolve a historical POS return unit price from the original sale snapshot.
 *
 * The saved final_unit_paid_price is authoritative when valid. The fallback
 * deliberately includes both cashier/bill discount and coupon discount so old
 * rows with missing or unadjusted snapshots cannot return at the full selling
 * price when the customer paid less.
 */
export type HistoricalReturnPricingInput = {
  finalUnitPaidPrice: number;
  unitSellingPrice: number;
  saleSubtotal: number;
  saleTotal?: number;
  saleDiscount: number;
  saleCouponDiscount?: number;
  allocatedBillDiscount: number;
  allocatedCouponDiscount: number;
};

export type HistoricalReturnPricingResult = {
  finalUnitPaidPrice: number;
  allocatedBillDiscount: number;
  allocatedCouponDiscount: number;
};

function nonNegativeNumber(value: number | undefined | null): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

export function resolveHistoricalReturnPricing(
  input: HistoricalReturnPricingInput,
): HistoricalReturnPricingResult {
  const snapshotPrice = nonNegativeNumber(input.finalUnitPaidPrice);
  const unitSellingPrice = nonNegativeNumber(input.unitSellingPrice);
  const billDiscount = nonNegativeNumber(input.saleDiscount);
  const couponDiscount = nonNegativeNumber(input.saleCouponDiscount);
  const totalDiscount = billDiscount + couponDiscount;

  // A missing subtotal can be reconstructed from a net total plus its discounts.
  const suppliedSubtotal = nonNegativeNumber(input.saleSubtotal);
  const saleSubtotal =
    suppliedSubtotal > 0
      ? suppliedSubtotal
      : nonNegativeNumber(input.saleTotal) + totalDiscount;

  const hasSaleDiscount = totalDiscount > 0;
  const snapshotLooksUndiscounted =
    snapshotPrice > 0 &&
    hasSaleDiscount &&
    Math.abs(snapshotPrice - unitSellingPrice) < 0.001;

  let finalUnitPaidPrice = snapshotPrice;
  if (finalUnitPaidPrice <= 0 || snapshotLooksUndiscounted) {
    if (saleSubtotal > 0 && hasSaleDiscount) {
      const discountRatio = Math.min(1, totalDiscount / saleSubtotal);
      finalUnitPaidPrice = round4(Math.max(0, unitSellingPrice * (1 - discountRatio)));
    } else {
      finalUnitPaidPrice = unitSellingPrice;
    }
  }

  const proportionalBillDiscount =
    saleSubtotal > 0 ? round4((unitSellingPrice * billDiscount) / saleSubtotal) : 0;
  const proportionalCouponDiscount =
    saleSubtotal > 0 ? round4((unitSellingPrice * couponDiscount) / saleSubtotal) : 0;

  return {
    finalUnitPaidPrice,
    allocatedBillDiscount:
      nonNegativeNumber(input.allocatedBillDiscount) > 0
        ? nonNegativeNumber(input.allocatedBillDiscount)
        : proportionalBillDiscount,
    allocatedCouponDiscount:
      nonNegativeNumber(input.allocatedCouponDiscount) > 0
        ? nonNegativeNumber(input.allocatedCouponDiscount)
        : proportionalCouponDiscount,
  };
}
