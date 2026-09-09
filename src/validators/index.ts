/**
 * ZÉRAH BABY & KIDS — Reusable Application Validators
 * Pure, deterministic validation functions for forms, inputs, and business rules.
 */

import { ValidationError } from "@/domain/errors";
import type { CheckoutCustomerInfo } from "@/domain/models";

/**
 * Validates 6-digit Indian Postal Pincode format
 */
export function validatePincode(pincode: string | null | undefined): boolean {
  if (!pincode) return false;
  const clean = pincode.trim();
  return /^[1-9][0-9]{5}$/.test(clean);
}

/**
 * Validates 10-digit Indian Mobile Phone Number format
 */
export function validateIndianPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const clean = phone.replace(/\D/g, "");
  // Accept 10 digits or 12 digits with 91 prefix
  if (clean.length === 10) {
    return /^[6-9]\d{9}$/.test(clean);
  }
  if (clean.length === 12 && clean.startsWith("91")) {
    return /^[6-9]\d{9}$/.test(clean.slice(2));
  }
  return false;
}

/**
 * Validates cart item quantity boundaries
 */
export function validateCartQuantity(
  qty: number,
  availableStock: number,
  maxPerItem = 10,
): { valid: boolean; error?: string } {
  if (isNaN(qty) || !Number.isInteger(qty) || qty <= 0) {
    return { valid: false, error: "Quantity must be a positive integer greater than zero." };
  }
  if (qty > maxPerItem) {
    return { valid: false, error: `Maximum quantity per item is ${maxPerItem}.` };
  }
  if (availableStock > 0 && qty > availableStock) {
    return {
      valid: false,
      error: `Only ${availableStock} units available in stock.`,
    };
  }
  return { valid: true };
}

/**
 * Validates customer checkout address fields
 */
export function validateCheckoutAddress(info: Partial<CheckoutCustomerInfo>): {
  valid: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};

  if (!info.full_name || info.full_name.trim().length < 2) {
    errors.full_name = "Full name must be at least 2 characters.";
  }

  if (!info.phone || !validateIndianPhone(info.phone)) {
    errors.phone = "Please provide a valid 10-digit mobile number.";
  }

  if (!info.address || info.address.trim().length < 5) {
    errors.address = "Please enter a complete delivery street address.";
  }

  if (!info.city || info.city.trim().length < 2) {
    errors.city = "City is required.";
  }

  if (!info.state || info.state.trim().length < 2) {
    errors.state = "State is required.";
  }

  if (!info.pincode || !validatePincode(info.pincode)) {
    errors.pincode = "Please enter a valid 6-digit PIN code.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Validates coupon code input format
 */
export function validateCouponCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const clean = code.trim().toUpperCase();
  if (clean.length < 3 || clean.length > 30) return null;
  if (!/^[A-Z0-9_-]+$/.test(clean)) return null;
  return clean;
}

/**
 * Validates cashier manual discount on POS billing
 */
export function validatePOSCashierDiscount(
  discountType: "percentage" | "fixed" | "none",
  discountValue: number,
  subtotal: number,
): { valid: boolean; discountAmount: number; error?: string } {
  if (discountType === "none" || discountValue <= 0) {
    return { valid: true, discountAmount: 0 };
  }

  if (isNaN(discountValue) || discountValue < 0) {
    return { valid: false, discountAmount: 0, error: "Discount value cannot be negative." };
  }

  if (discountType === "percentage") {
    if (discountValue > 100) {
      return { valid: false, discountAmount: 0, error: "Percentage discount cannot exceed 100%." };
    }
    const amt = Math.round(((subtotal * discountValue) / 100) * 100) / 100;
    return { valid: true, discountAmount: Math.min(subtotal, amt) };
  }

  if (discountType === "fixed") {
    if (discountValue > subtotal) {
      return {
        valid: false,
        discountAmount: 0,
        error: "Fixed discount cannot exceed total bill subtotal.",
      };
    }
    return { valid: true, discountAmount: discountValue };
  }

  return { valid: true, discountAmount: 0 };
}

/**
 * Validates return quantity against original and previously returned quantities
 */
export function validateReturnEligibility(
  purchasedQty: number,
  previouslyReturnedQty: number,
  requestedReturnQty: number,
): { eligible: boolean; remainingReturnable: number; error?: string } {
  const remaining = Math.max(0, purchasedQty - previouslyReturnedQty);

  if (requestedReturnQty <= 0) {
    return {
      eligible: false,
      remainingReturnable: remaining,
      error: "Return quantity must be at least 1.",
    };
  }

  if (requestedReturnQty > remaining) {
    return {
      eligible: false,
      remainingReturnable: remaining,
      error: `Cannot return ${requestedReturnQty} units. Maximum returnable is ${remaining}.`,
    };
  }

  return { eligible: true, remainingReturnable: remaining };
}
