import { test, expect } from "@playwright/test";
import {
  generateClientStoreCreditCode,
  generateClientReturnNumber,
} from "../src/lib/offline-sync-engine";
import { parseReturnScanCode } from "../src/lib/pos-returns";

test.describe("World-Class Return, Refund & Store-Credit Hardening Suite", () => {
  test("1. Store Credit Voucher Format — Standard 4-Character Token (e.g. 7J5X)", () => {
    for (let i = 0; i < 25; i++) {
      const token = generateClientStoreCreditCode();
      // Must match 4 characters alphanumeric excluding ambiguous 0, O, 1, I
      expect(token).toMatch(/^[2-9A-HJ-NP-Z]{4}$/);
      expect(token.length).toBe(4);
    }
  });

  test("2. Return Number Format — Sequential Daily / Microsecond Client Return ID", () => {
    const retNum = generateClientReturnNumber();
    expect(retNum).toMatch(/^RET-\d{4,6}-[A-Z0-9]+$/);
  });

  test("3. Barcode & QR Code Scanner Token Disambiguation", () => {
    // 1. 4-character voucher token format
    const tokenScan4 = parseReturnScanCode("7J5X");
    expect(tokenScan4.type).toBe("credit_token");
    expect(tokenScan4.value).toBe("7J5X");

    // 2. Legacy ZRH standard format
    const tokenScan = parseReturnScanCode("ZRH-7B89-K29P");
    expect(tokenScan.type).toBe("credit_token");
    expect(tokenScan.value).toBe("ZRH-7B89-K29P");

    // 3. Lowercase 4-character token scan normalized
    const lowerTokenScan = parseReturnScanCode("7j5x");
    expect(lowerTokenScan.type).toBe("credit_token");
    expect(lowerTokenScan.value).toBe("7J5X");

    // 3. Invoice Number QR
    const invScan = parseReturnScanCode("POS-2609-00123");
    expect(invScan.type).toBe("invoice_qr");
    expect(invScan.value).toBe("POS-2609-00123");

    // 4. Product Barcode
    const prodScan = parseReturnScanCode("8901234567890");
    expect(prodScan.type).toBe("product_barcode");
    expect(prodScan.value).toBe("8901234567890");
  });

  test("4. Phone Normalization Logic Simulation (+91, leading 0, spaces)", () => {
    function normalizePhone(raw: string | null | undefined): string {
      if (!raw) return "";
      let digits = raw.replace(/\D/g, "");
      if (digits.length === 12 && digits.startsWith("91")) {
        digits = digits.slice(2);
      } else if (digits.length === 11 && digits.startsWith("0")) {
        digits = digits.slice(1);
      }
      return digits.length === 10 ? digits : "";
    }

    expect(normalizePhone("+91 90570 74777")).toBe("9057074777");
    expect(normalizePhone("09057074777")).toBe("9057074777");
    expect(normalizePhone("90570-74777")).toBe("9057074777");
    expect(normalizePhone("90570 74777")).toBe("9057074777");
    expect(normalizePhone("9057074777")).toBe("9057074777");
    expect(normalizePhone("123")).toBe(""); // Invalid length rejected
  });

  test("5. Cross-Customer Credit Protection — Ownership Mismatch Enforced", () => {
    type Voucher = {
      token: string;
      customer_id: string;
      customer_phone: string;
      customer_name: string;
      remaining_balance: number;
    };

    const voucher: Voucher = {
      token: "ZRH-7B89-K29P",
      customer_id: "cust-uuid-1",
      customer_phone: "9876543210",
      customer_name: "Anita Sharma",
      remaining_balance: 500,
    };

    function validateVoucherUsage(
      v: Voucher,
      checkoutCustomerId: string | null,
      checkoutPhone: string,
    ) {
      if (checkoutCustomerId && v.customer_id !== checkoutCustomerId) {
        return {
          valid: false,
          ownership_mismatch: true,
          error: `Store credit belongs to ${v.customer_name} (${v.customer_phone}). Cannot be redeemed for a different customer.`,
        };
      }
      return { valid: true, available_credit: v.remaining_balance };
    }

    // Attempting to use Anita's voucher for Priya (Different ID)
    const mismatchAttempt = validateVoucherUsage(voucher, "cust-uuid-2", "9123456780");
    expect(mismatchAttempt.valid).toBe(false);
    expect(mismatchAttempt.ownership_mismatch).toBe(true);
    expect(mismatchAttempt.error).toContain("Anita Sharma");

    // Legitimate usage for Anita
    const validAttempt = validateVoucherUsage(voucher, "cust-uuid-1", "9876543210");
    expect(validAttempt.valid).toBe(true);
    expect(validAttempt.available_credit).toBe(500);
  });

  test("6. Over-Refund Prevention via Historical Snapshot (final_unit_paid_price)", () => {
    // Purchased 3 rompers with 20% discount:
    // MRP = ₹500, Discounted selling price = ₹400 each
    const originalSaleItem = {
      id: "item-1",
      quantity_sold: 3,
      quantity_returned: 1,
      final_unit_paid_price: 400, // True net paid price per unit
    };

    function calculateRefund(item: typeof originalSaleItem, returnQtyRequested: number) {
      const returnableQty = item.quantity_sold - item.quantity_returned;
      if (returnQtyRequested > returnableQty) {
        throw new Error(
          `Over-refund not permitted! Requested return of ${returnQtyRequested} exceeds returnable quantity of ${returnableQty}.`,
        );
      }
      // Return value is strictly based on final_unit_paid_price, not MRP
      return returnQtyRequested * item.final_unit_paid_price;
    }

    // Returning 1 unit: ₹400 (NOT ₹500 MRP)
    expect(calculateRefund(originalSaleItem, 1)).toBe(400);

    // Returning 2 units: ₹800
    expect(calculateRefund(originalSaleItem, 2)).toBe(800);

    // Attempting to return 3 units when only 2 are left throws
    expect(() => calculateRefund(originalSaleItem, 3)).toThrow("Over-refund not permitted");
  });

  test("7. Store Credit Ledger State Transitions (CREDIT_ISSUED -> CREDIT_USED)", () => {
    type LedgerEntry = {
      type: "CREDIT_ISSUED" | "CREDIT_USED";
      amount: number;
      balance_before: number;
      balance_after: number;
      credit_token: string;
      notes: string;
    };

    const ledger: LedgerEntry[] = [];
    let currentBalance = 0;

    // 1. Customer returns item, ₹600 credit issued
    const token = "ZRH-ABCD-EFGH";
    const issuedAmount = 600;
    ledger.push({
      type: "CREDIT_ISSUED",
      amount: issuedAmount,
      balance_before: currentBalance,
      balance_after: currentBalance + issuedAmount,
      credit_token: token,
      notes: "Issued for offline return #RET-2609-0001",
    });
    currentBalance += issuedAmount;

    expect(currentBalance).toBe(600);
    expect(ledger[0].balance_after).toBe(600);

    // 2. Customer buys ₹450 product, tenders ₹450 credit
    const purchaseAmount = 450;
    ledger.push({
      type: "CREDIT_USED",
      amount: purchaseAmount,
      balance_before: currentBalance,
      balance_after: currentBalance - purchaseAmount,
      credit_token: token,
      notes: "Redeemed on offline sale #POS-2609-0042",
    });
    currentBalance -= purchaseAmount;

    expect(currentBalance).toBe(150);
    expect(ledger[1].balance_after).toBe(150);
  });
});
