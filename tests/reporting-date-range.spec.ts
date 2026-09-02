/**
 * CANONICAL REPORTING DATE-RANGE REGRESSION TEST SUITE
 * 
 * Validates:
 * 1. Today preset (inclusive 00:00:00 IST, exclusive tomorrow 00:00:00 IST)
 * 2. Yesterday preset (exact 24h IST interval)
 * 3. Last 7 Days preset (exact 7-day interval ending today)
 * 4. Custom range semantics (start inclusive, end next day exclusive)
 * 5. Month boundary transitions (e.g. Aug 31 to Sep 01)
 * 6. Midnight (00:00:00.000 IST) and 23:59:59.999 IST transaction boundary testing
 * 7. Browser timezone neutrality (IST vs UTC vs arbitrary local time)
 * 8. Mathematical Population Equivalence: Same Range + Same Metric = Same Population = Same Total
 */
import { test, expect } from "@playwright/test";
import {
  calculateCanonicalISTBounds,
  istToUtcMs,
  formatToISTDate,
  IST_OFFSET_MS,
} from "../src/lib/reporting-date-range";
import { calculateFinancialMetrics } from "../src/lib/financial-reporting";

test.describe("Canonical Reporting Date-Range Synchronization", () => {
  // Reference moment: Sep 03, 2026 at 01:20:54 IST (UTC: Sep 02, 2026 19:50:54 UTC)
  const REF_MOMENT = new Date(Date.UTC(2026, 8, 2, 19, 50, 54));

  test("1. Today Preset: Covers exactly 24 hours of current IST calendar date", () => {
    const bounds = calculateCanonicalISTBounds({ preset: "today", referenceNow: REF_MOMENT });

    // In IST, cur date is 2026-09-03
    const expectedStart = istToUtcMs(2026, 8, 3, 0, 0, 0, 0);
    const expectedEndExclusive = istToUtcMs(2026, 8, 4, 0, 0, 0, 0);

    expect(bounds.startMs).toBe(expectedStart);
    expect(bounds.endMsExclusive).toBe(expectedEndExclusive);
    expect(bounds.endMsExclusive - bounds.startMs).toBe(24 * 60 * 60 * 1000);
    expect(bounds.dateRangeText).toContain("Sep 03, 2026");
  });

  test("2. Yesterday Preset: Covers exactly 24 hours of preceding IST calendar date", () => {
    const bounds = calculateCanonicalISTBounds({ preset: "yesterday", referenceNow: REF_MOMENT });

    const expectedStart = istToUtcMs(2026, 8, 2, 0, 0, 0, 0);
    const expectedEndExclusive = istToUtcMs(2026, 8, 3, 0, 0, 0, 0);

    expect(bounds.startMs).toBe(expectedStart);
    expect(bounds.endMsExclusive).toBe(expectedEndExclusive);
    expect(bounds.endMsExclusive - bounds.startMs).toBe(24 * 60 * 60 * 1000);
    expect(bounds.dateRangeText).toContain("Sep 02, 2026");
  });

  test("3. Last 7 Days Preset: Covers exactly 7 full 24h days ending today", () => {
    const bounds = calculateCanonicalISTBounds({ preset: "7d", referenceNow: REF_MOMENT });

    // 7 days ending Sep 03: Aug 28, 29, 30, 31, Sep 01, 02, 03
    const expectedStart = istToUtcMs(2026, 7, 28, 0, 0, 0, 0); // Month 7 is August (0-indexed)
    const expectedEndExclusive = istToUtcMs(2026, 8, 4, 0, 0, 0, 0);

    expect(bounds.startMs).toBe(expectedStart);
    expect(bounds.endMsExclusive).toBe(expectedEndExclusive);
    expect(bounds.endMsExclusive - bounds.startMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(bounds.dateRangeText).toBe("Aug 28 – Sep 03, 2026");
  });

  test("4. Custom Range Semantics: Aug 27 through Sep 03 00:00:00 IST exclusive", () => {
    const bounds = calculateCanonicalISTBounds({
      preset: "custom",
      startDate: "2026-08-27",
      endDate: "2026-09-02",
      referenceNow: REF_MOMENT,
    });

    const expectedStart = istToUtcMs(2026, 7, 27, 0, 0, 0, 0);
    const expectedEndExclusive = istToUtcMs(2026, 8, 3, 0, 0, 0, 0); // Sep 03 00:00:00 IST exclusive

    expect(bounds.startMs).toBe(expectedStart);
    expect(bounds.endMsExclusive).toBe(expectedEndExclusive);
    expect(bounds.dateRangeText).toBe("Aug 27 – Sep 02, 2026");

    // Aug 27 00:00:00 IST is included
    expect(bounds.inCurrentPeriod(expectedStart)).toBe(true);
    // Sep 02 23:59:59.999 IST is included
    expect(bounds.inCurrentPeriod(expectedEndExclusive - 1)).toBe(true);
    // Sep 03 00:00:00 IST is excluded
    expect(bounds.inCurrentPeriod(expectedEndExclusive)).toBe(false);
  });

  test("5. Midnight (00:00:00.000 IST) and 23:59:59.999 IST Transaction Boundaries", () => {
    const bounds = calculateCanonicalISTBounds({ preset: "today", referenceNow: REF_MOMENT });

    // Exact midnight of today in IST: 2026-09-03 00:00:00.000 IST
    const midnightTodayUtcIso = new Date(istToUtcMs(2026, 8, 3, 0, 0, 0, 0)).toISOString();
    expect(bounds.inCurrentPeriod(midnightTodayUtcIso)).toBe(true);

    // 1 millisecond before midnight of today (Sep 02 23:59:59.999 IST) -> MUST be excluded from Today
    const oneMsBeforeTodayIso = new Date(istToUtcMs(2026, 8, 3, 0, 0, 0, 0) - 1).toISOString();
    expect(bounds.inCurrentPeriod(oneMsBeforeTodayIso)).toBe(false);

    // Last millisecond of today: 2026-09-03 23:59:59.999 IST -> MUST be included
    const lastMsTodayIso = new Date(istToUtcMs(2026, 8, 3, 23, 59, 59, 999)).toISOString();
    expect(bounds.inCurrentPeriod(lastMsTodayIso)).toBe(true);

    // Midnight of tomorrow: 2026-09-04 00:00:00.000 IST -> MUST be excluded (exclusive boundary)
    const midnightTomorrowIso = new Date(istToUtcMs(2026, 8, 4, 0, 0, 0, 0)).toISOString();
    expect(bounds.inCurrentPeriod(midnightTomorrowIso)).toBe(false);
  });

  test("6. Month Boundary Transitions: Correct multi-month window calculations", () => {
    // Reference on first day of month: Sep 01, 2026 12:00:00 IST
    const refSep1 = new Date(Date.UTC(2026, 8, 1, 6, 30, 0));
    const bounds = calculateCanonicalISTBounds({ preset: "7d", referenceNow: refSep1 });

    // Sep 01 minus 6 days is Aug 26
    const expectedStart = istToUtcMs(2026, 7, 26, 0, 0, 0, 0);
    const expectedEndExclusive = istToUtcMs(2026, 8, 2, 0, 0, 0, 0);

    expect(bounds.startMs).toBe(expectedStart);
    expect(bounds.endMsExclusive).toBe(expectedEndExclusive);
    expect(bounds.dateRangeText).toBe("Aug 26 – Sep 01, 2026");
  });

  test("7. Browser Timezone Neutrality: Output timestamps are identical regardless of local timezone", () => {
    // Both simulate same absolute point in time
    const t1 = new Date("2026-09-03T01:20:54+05:30");
    const t2 = new Date("2026-09-02T19:50:54Z");

    const b1 = calculateCanonicalISTBounds({ preset: "7d", referenceNow: t1 });
    const b2 = calculateCanonicalISTBounds({ preset: "7d", referenceNow: t2 });

    expect(b1.startMs).toBe(b2.startMs);
    expect(b1.endMsExclusive).toBe(b2.endMsExclusive);
    expect(b1.dateRangeText).toBe(b2.dateRangeText);
    expect(formatToISTDate(b1.startMs)).toBe("2026-08-28");
  });

  test("8. Mathematical Equivalence: Same Range + Same Metric = Same Population = Same Total", () => {
    const bounds = calculateCanonicalISTBounds({ preset: "7d", referenceNow: REF_MOMENT });

    const testSales = [
      // Within 7d window (Aug 29)
      {
        id: "sale-in-1",
        sale_number: "POS-001",
        created_at: new Date(istToUtcMs(2026, 7, 29, 14, 0)).toISOString(),
        status: "completed",
        total: 1500,
        subtotal: 1500,
      },
      // Within 7d window (Sep 03 at 00:30 IST)
      {
        id: "sale-in-2",
        sale_number: "POS-002",
        created_at: new Date(istToUtcMs(2026, 8, 3, 0, 30)).toISOString(),
        status: "completed",
        total: 2500,
        subtotal: 2500,
      },
      // Outside 7d window (Aug 20)
      {
        id: "sale-out-old",
        sale_number: "POS-003",
        created_at: new Date(istToUtcMs(2026, 7, 20, 11, 0)).toISOString(),
        status: "completed",
        total: 5000,
        subtotal: 5000,
      },
      // Outside 7d window (Sep 04 future)
      {
        id: "sale-out-future",
        sale_number: "POS-004",
        created_at: new Date(istToUtcMs(2026, 8, 4, 1, 0)).toISOString(),
        status: "completed",
        total: 9000,
        subtotal: 9000,
      },
    ];

    // Population A: Filtered by inCurrentPeriod predicate
    const filteredByPredicate = testSales.filter((s) => bounds.inCurrentPeriod(s.created_at));
    const totalFromPredicate = filteredByPredicate.reduce((sum, s) => sum + s.total, 0);

    // Population B: Dashboard calculateFinancialMetrics
    const dashboardMetrics = calculateFinancialMetrics({
      orders: [],
      posSales: testSales as any,
      returns: [],
      products: [],
      filterDate: bounds.inCurrentPeriod,
    });

    expect(filteredByPredicate.length).toBe(2);
    expect(totalFromPredicate).toBe(4000);
    expect(dashboardMetrics.validPosSalesCount).toBe(2);
    expect(dashboardMetrics.offlineGrossRevenue).toBe(4000);
    expect(totalFromPredicate).toBe(dashboardMetrics.offlineGrossRevenue);
  });
});
