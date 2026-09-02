/**
 * ZÉRAH BABY & KIDS — Master Pricing & Financial Calculation Engine
 * Single Authoritative Source of Truth for all Monetary Calculations.
 *
 * Core Principles:
 * 1. Safe Monetary Rounding: No floating-point precision drift.
 * 2. Strict Mathematical Invariants:
 *    - Line Subtotal = Unit Price × Quantity
 *    - Subtotal = Sum(Line Subtotals)
 *    - Base Product Savings = Sum(max(0, MRP - Unit Price) × Quantity)
 *    - Net Subtotal = max(0, Subtotal - Coupon Discount)
 *    - Shipping = 0 if (FreeDeliveryEnabled AND Net Subtotal >= Threshold) else Standard Shipping
 *    - Final Total = Net Subtotal + Shipping
 * 3. Gateway Conversion:
 *    - 1 INR = 100 Paise (Exact integer conversion at integration boundary)
 */

export interface PricingLineItem {
  id?: string;
  name?: string;
  price: number;
  mrp?: number;
  qty: number;
}

export interface CouponRule {
  code: string;
  id?: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  minimumOrderValue?: number;
  maximumDiscount?: number;
}

export interface ShippingConfig {
  freeDeliveryEnabled?: boolean;
  freeDeliveryThreshold?: number;
  standardShippingCharge?: number;
  freeDeliveryMessage?: string;
}

export interface CartFinancialsBreakdown {
  subtotal: number;
  baseProductSavings: number;
  couponDiscount: number;
  netSubtotal: number;
  shipping: number;
  isFreeDelivery: boolean;
  amountToFreeDelivery: number;
  freeDeliveryMessage: string | null;
  finalTotal: number;
}

export interface POSFinancialsBreakdown {
  subtotal: number;
  mrpTotal: number;
  productSavings: number;
  couponDiscount: number;
  couponCode: string | null;
  discount: number;
  discountType: "percentage" | "fixed" | "none";
  discountValue: number;
  finalTotal: number;
}

/**
 * Standard Monetary Rounding (INR Integer Safe / 2 decimal places max)
 */
export function roundMoney(amount: number): number {
  if (isNaN(amount) || !isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/**
 * Integer Currency Rounding (For INR storefront final display & totals)
 */
export function roundCurrencyInt(amount: number): number {
  if (isNaN(amount) || !isFinite(amount)) return 0;
  return Math.round(amount);
}

/**
 * Convert Rupees to Razorpay Paise (exact integer)
 */
export function toPaise(rupees: number): number {
  if (isNaN(rupees) || !isFinite(rupees)) return 0;
  return Math.round(roundMoney(rupees) * 100);
}

/**
 * Convert Razorpay Paise to Rupees
 */
export function toRupees(paise: number): number {
  if (isNaN(paise) || !isFinite(paise)) return 0;
  return roundMoney(paise / 100);
}

/**
 * Calculate line subtotal for an item
 */
export function calculateLineSubtotal(unitPrice: number, qty: number): number {
  const p = Math.max(0, unitPrice || 0);
  const q = Math.max(0, Math.floor(qty || 0));
  return roundMoney(p * q);
}

/**
 * Calculate authoritative coupon discount based on subtotal and coupon rules
 */
export function calculateCouponDiscount(
  subtotal: number,
  coupon: CouponRule | null | undefined,
): number {
  if (!coupon || subtotal <= 0) return 0;

  const minOrder = Math.max(0, coupon.minimumOrderValue || 0);
  if (subtotal < minOrder) return 0;

  const discountType = coupon.discountType || "percentage";
  const discountVal = Math.max(0, coupon.discountValue || 0);
  const maxDiscount = Math.max(0, coupon.maximumDiscount || 0);

  let discount = 0;
  if (discountType === "percentage") {
    if (discountVal > 0) {
      discount = roundMoney((subtotal * discountVal) / 100);
      if (maxDiscount > 0 && discount > maxDiscount) {
        discount = maxDiscount;
      }
    }
  } else if (discountType === "fixed") {
    discount = Math.min(subtotal, discountVal);
  }

  // Discount can never exceed subtotal and cannot be negative
  return Math.max(0, Math.min(subtotal, roundCurrencyInt(discount)));
}

/**
 * Master Cart Financial Calculator
 * Used identically on Cart, Checkout, and Buy Now flows.
 */
export function calculateCartFinancials({
  items = [],
  coupon = null,
  shippingConfig = {},
  customShippingCharge,
}: {
  items: PricingLineItem[];
  coupon?: CouponRule | null;
  shippingConfig?: ShippingConfig;
  customShippingCharge?: number;
}): CartFinancialsBreakdown {
  // 1. Calculate Subtotal and Base Product Savings
  let subtotal = 0;
  let baseProductSavings = 0;

  for (const item of items) {
    const qty = Math.max(0, Math.floor(item.qty || 0));
    const price = Math.max(0, item.price || 0);
    const mrp = Math.max(price, item.mrp || price);

    const lineSubtotal = calculateLineSubtotal(price, qty);
    subtotal += lineSubtotal;
    baseProductSavings += Math.max(0, (mrp - price) * qty);
  }

  subtotal = roundMoney(subtotal);
  baseProductSavings = roundMoney(baseProductSavings);

  // 2. Calculate Coupon Discount
  const couponDiscount = calculateCouponDiscount(subtotal, coupon);

  // 3. Net Subtotal (Payable base after coupon)
  const netSubtotal = Math.max(0, roundMoney(subtotal - couponDiscount));

  // 4. Shipping Calculation
  const freeDeliveryEnabled = shippingConfig.freeDeliveryEnabled !== false;
  const threshold = Math.max(0, shippingConfig.freeDeliveryThreshold ?? 999);
  const standardCharge = Math.max(0, shippingConfig.standardShippingCharge ?? 79);

  // Business Rule: Free delivery applies when netSubtotal meets or exceeds threshold
  const isFreeDelivery = subtotal > 0 && freeDeliveryEnabled && netSubtotal >= threshold;

  let shipping = 0;
  if (subtotal > 0) {
    if (customShippingCharge !== undefined) {
      shipping = isFreeDelivery ? 0 : Math.max(0, customShippingCharge);
    } else {
      shipping = isFreeDelivery ? 0 : standardCharge;
    }
  }
  shipping = roundMoney(shipping);

  const amountToFreeDelivery =
    freeDeliveryEnabled && !isFreeDelivery && subtotal > 0
      ? Math.max(0, threshold - netSubtotal)
      : 0;

  let freeDeliveryMessage: string | null = null;
  if (freeDeliveryEnabled && subtotal > 0) {
    if (isFreeDelivery) {
      freeDeliveryMessage = "🎉 FREE DELIVERY UNLOCKED";
    } else {
      const template =
        shippingConfig.freeDeliveryMessage || "Add ₹{amount} more for FREE DELIVERY 🎉";
      freeDeliveryMessage = template.replace(
        "{amount}",
        roundCurrencyInt(amountToFreeDelivery).toString(),
      );
    }
  }

  // 5. Final Payable Total
  const finalTotal = subtotal > 0 ? Math.max(0, roundMoney(netSubtotal + shipping)) : 0;

  return {
    subtotal,
    baseProductSavings,
    couponDiscount,
    netSubtotal,
    shipping,
    isFreeDelivery,
    amountToFreeDelivery,
    freeDeliveryMessage,
    finalTotal,
  };
}

/**
 * Master POS Financial Calculator
 * Authoritatively computes items subtotal, MRP savings, coupon discounts,
 * manual cashier discounts, and final net payable total.
 */
export function calculatePOSFinancials({
  items = [],
  discountType = "none",
  discountValue = 0,
  coupon = null,
}: {
  items: PricingLineItem[];
  discountType?: "percentage" | "fixed" | "none";
  discountValue?: number;
  coupon?: CouponRule | null;
}): POSFinancialsBreakdown {
  let subtotal = 0;
  let mrpTotal = 0;

  for (const item of items) {
    const qty = Math.max(0, Math.floor(item.qty || 0));
    const price = Math.max(0, item.price || 0);
    const mrp = Math.max(price, item.mrp || price);

    subtotal += calculateLineSubtotal(price, qty);
    mrpTotal += calculateLineSubtotal(mrp, qty);
  }

  subtotal = roundMoney(subtotal);
  mrpTotal = roundMoney(mrpTotal);
  const productSavings = Math.max(0, roundMoney(mrpTotal - subtotal));

  // 1. Authoritative Coupon Discount
  const couponDiscount = coupon ? calculateCouponDiscount(subtotal, coupon) : 0;
  const couponCode = couponDiscount > 0 && coupon?.code ? coupon.code.toUpperCase() : null;

  // 2. Manual Cashier Discount (applied on subtotal after coupon to prevent double-discounting)
  const remainingSubtotal = Math.max(0, roundMoney(subtotal - couponDiscount));
  let discount = 0;
  const dVal = Math.max(0, discountValue || 0);

  if (discountType === "percentage") {
    const cappedPct = Math.min(100, dVal);
    discount = roundMoney((remainingSubtotal * cappedPct) / 100);
  } else if (discountType === "fixed") {
    discount = Math.min(remainingSubtotal, dVal);
  }

  discount = Math.max(0, Math.min(remainingSubtotal, roundCurrencyInt(discount)));
  const finalTotal = Math.max(0, roundMoney(subtotal - couponDiscount - discount));

  return {
    subtotal,
    mrpTotal,
    productSavings,
    couponDiscount,
    couponCode,
    discount,
    discountType,
    discountValue: dVal,
    finalTotal,
  };
}
