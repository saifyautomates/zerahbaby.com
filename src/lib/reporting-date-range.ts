/**
 * CANONICAL REPORTING DATE-RANGE ENGINE
 *
 * Provides single source-of-truth date boundaries and state synchronization
 * across Dashboard, Sales Details, Profit Details, Revenue Details, POS Sales,
 * Returns, Reports, and Exports.
 *
 * Strict Semantics:
 * - Timezone: Indian Standard Time (UTC+5:30)
 * - Start Boundary: INCLUSIVE (>= startMs, exactly 00:00:00.000 IST)
 * - End Boundary: EXCLUSIVE (< endMsExclusive, exactly 00:00:00.000 IST of next day)
 * - Legacy helper: endMs (inclusive <= 23:59:59.999 IST)
 */
import { useState, useEffect, useCallback, useMemo } from "react";

export const IST_OFFSET_MS = 330 * 60 * 1000; // 5 hours 30 minutes in ms

export type DatePreset = "today" | "yesterday" | "7d" | "30d" | "this_month" | "all" | "custom";

export interface CanonicalDateBounds {
  preset: DatePreset;
  startDate?: string; // YYYY-MM-DD in IST
  endDate?: string; // YYYY-MM-DD in IST
  startMs: number; // UTC ms for start inclusive (00:00:00.000 IST)
  endMsExclusive: number; // UTC ms for end exclusive (00:00:00.000 IST of next day)
  endMs: number; // UTC ms for end inclusive (23:59:59.999 IST)
  prevStartMs: number;
  prevEndMsExclusive: number;
  prevEndMs: number;
  startIso: string;
  endExclusiveIso: string;
  dateRangeText: string;
  compareLabel: string;
  inCurrentPeriod: (dateInput: string | number | Date | null | undefined) => boolean;
  inPrevPeriod: (dateInput: string | number | Date | null | undefined) => boolean;
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Constructs a UTC epoch timestamp representing an IST calendar moment
 */
export function istToUtcMs(
  year: number,
  monthIndex: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): number {
  return Date.UTC(year, monthIndex, day, hour, minute, second, millisecond) - IST_OFFSET_MS;
}

/**
 * Parses YYYY-MM-DD string into year, monthIndex (0-11), and day numbers
 */
export function parseDateParts(
  dateStr: string,
): { year: number; month: number; day: number } | null {
  const parts = dateStr.split("-").map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return { year: parts[0], month: parts[1] - 1, day: parts[2] };
}

/**
 * Format an epoch timestamp into IST YYYY-MM-DD
 */
export function formatToISTDate(epochMs: number): string {
  const ist = new Date(epochMs + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Pure mathematical calculation of canonical IST boundaries
 */
export function calculateCanonicalISTBounds({
  preset = "7d",
  startDate,
  endDate,
  referenceNow = new Date(),
}: {
  preset?: DatePreset;
  startDate?: string;
  endDate?: string;
  referenceNow?: Date;
}): CanonicalDateBounds {
  const istNow = new Date(referenceNow.getTime() + IST_OFFSET_MS);
  const curY = istNow.getUTCFullYear();
  const curM = istNow.getUTCMonth();
  const curD = istNow.getUTCDate();

  let startMs: number;
  let endMsExclusive: number;
  let prevStartMs = 0;
  let prevEndMsExclusive = 0;
  let dateRangeText = "";
  let compareLabel = "last period";

  switch (preset) {
    case "today": {
      startMs = istToUtcMs(curY, curM, curD, 0, 0, 0, 0);
      endMsExclusive = istToUtcMs(curY, curM, curD + 1, 0, 0, 0, 0);

      prevStartMs = istToUtcMs(curY, curM, curD - 1, 0, 0, 0, 0);
      prevEndMsExclusive = startMs;

      dateRangeText = `Today, ${MONTH_NAMES[curM]} ${String(curD).padStart(2, "0")}, ${curY}`;
      compareLabel = "yesterday";
      break;
    }

    case "yesterday": {
      startMs = istToUtcMs(curY, curM, curD - 1, 0, 0, 0, 0);
      endMsExclusive = istToUtcMs(curY, curM, curD, 0, 0, 0, 0);

      prevStartMs = istToUtcMs(curY, curM, curD - 2, 0, 0, 0, 0);
      prevEndMsExclusive = startMs;

      const yestDate = new Date(referenceNow.getTime() - 24 * 60 * 60 * 1000 + IST_OFFSET_MS);
      dateRangeText = `Yesterday, ${MONTH_NAMES[yestDate.getUTCMonth()]} ${String(yestDate.getUTCDate()).padStart(2, "0")}, ${yestDate.getUTCFullYear()}`;
      compareLabel = "prev day";
      break;
    }

    case "7d": {
      // 7 full days ending with today: [curD - 6] through [curD + 1 exclusive]
      startMs = istToUtcMs(curY, curM, curD - 6, 0, 0, 0, 0);
      endMsExclusive = istToUtcMs(curY, curM, curD + 1, 0, 0, 0, 0);

      prevStartMs = istToUtcMs(curY, curM, curD - 13, 0, 0, 0, 0);
      prevEndMsExclusive = startMs;

      const startD = new Date(startMs + IST_OFFSET_MS);
      dateRangeText = `${MONTH_NAMES[startD.getUTCMonth()]} ${String(startD.getUTCDate()).padStart(2, "0")} – ${MONTH_NAMES[curM]} ${String(curD).padStart(2, "0")}, ${curY}`;
      compareLabel = "last 7 days";
      break;
    }

    case "30d": {
      // 30 full days ending with today: [curD - 29] through [curD + 1 exclusive]
      startMs = istToUtcMs(curY, curM, curD - 29, 0, 0, 0, 0);
      endMsExclusive = istToUtcMs(curY, curM, curD + 1, 0, 0, 0, 0);

      prevStartMs = istToUtcMs(curY, curM, curD - 59, 0, 0, 0, 0);
      prevEndMsExclusive = startMs;

      const startD = new Date(startMs + IST_OFFSET_MS);
      dateRangeText = `${MONTH_NAMES[startD.getUTCMonth()]} ${String(startD.getUTCDate()).padStart(2, "0")} – ${MONTH_NAMES[curM]} ${String(curD).padStart(2, "0")}, ${curY}`;
      compareLabel = "last 30 days";
      break;
    }

    case "this_month": {
      startMs = istToUtcMs(curY, curM, 1, 0, 0, 0, 0);
      endMsExclusive = istToUtcMs(curY, curM + 1, 1, 0, 0, 0, 0);

      prevStartMs = istToUtcMs(curY, curM - 1, 1, 0, 0, 0, 0);
      prevEndMsExclusive = startMs;

      dateRangeText = `${MONTH_NAMES[curM]} 01 – ${MONTH_NAMES[curM]} ${String(curD).padStart(2, "0")}, ${curY}`;
      compareLabel = "last month";
      break;
    }

    case "custom": {
      const parsedStart = startDate ? parseDateParts(startDate) : null;
      const parsedEnd = endDate ? parseDateParts(endDate) : null;

      if (parsedStart && parsedEnd) {
        startMs = istToUtcMs(parsedStart.year, parsedStart.month, parsedStart.day, 0, 0, 0, 0);
        // End date is inclusive day -> exclusive next day at 00:00:00 IST
        endMsExclusive = istToUtcMs(parsedEnd.year, parsedEnd.month, parsedEnd.day + 1, 0, 0, 0, 0);

        const durationMs = endMsExclusive - startMs;
        prevStartMs = startMs - durationMs;
        prevEndMsExclusive = startMs;

        dateRangeText = `${MONTH_NAMES[parsedStart.month]} ${String(parsedStart.day).padStart(2, "0")} – ${MONTH_NAMES[parsedEnd.month]} ${String(parsedEnd.day).padStart(2, "0")}, ${parsedEnd.year}`;
        compareLabel = "prior period";
      } else {
        // Fallback to 7d
        startMs = istToUtcMs(curY, curM, curD - 6, 0, 0, 0, 0);
        endMsExclusive = istToUtcMs(curY, curM, curD + 1, 0, 0, 0, 0);
        dateRangeText = "Custom (Invalid — 7d default)";
      }
      break;
    }

    case "all":
    default: {
      startMs = 0;
      endMsExclusive = Number.MAX_SAFE_INTEGER;
      prevStartMs = 0;
      prevEndMsExclusive = 0;
      dateRangeText = "All Time (Since Launch)";
      compareLabel = "all time";
      break;
    }
  }

  const endMs =
    endMsExclusive === Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : endMsExclusive - 1;
  const prevEndMs = prevEndMsExclusive === 0 ? 0 : prevEndMsExclusive - 1;

  const inCurrentPeriod = (dateInput: string | number | Date | null | undefined): boolean => {
    if (!dateInput) return false;
    if (preset === "all") return true;
    let t: number;
    if (typeof dateInput === "number") t = dateInput;
    else if (dateInput instanceof Date) t = dateInput.getTime();
    else t = new Date(dateInput).getTime();
    if (Number.isNaN(t)) return false;
    return t >= startMs && t < endMsExclusive;
  };

  const inPrevPeriod = (dateInput: string | number | Date | null | undefined): boolean => {
    if (!dateInput || preset === "all") return false;
    let t: number;
    if (typeof dateInput === "number") t = dateInput;
    else if (dateInput instanceof Date) t = dateInput.getTime();
    else t = new Date(dateInput).getTime();
    if (Number.isNaN(t)) return false;
    return t >= prevStartMs && t < prevEndMsExclusive;
  };

  return {
    preset,
    startDate,
    endDate,
    startMs,
    endMsExclusive,
    endMs,
    prevStartMs,
    prevEndMsExclusive,
    prevEndMs,
    startIso: new Date(startMs).toISOString(),
    endExclusiveIso:
      endMsExclusive === Number.MAX_SAFE_INTEGER
        ? "9999-12-31T23:59:59.999Z"
        : new Date(endMsExclusive).toISOString(),
    dateRangeText,
    compareLabel,
    inCurrentPeriod,
    inPrevPeriod,
  };
}

const STORAGE_KEY = "zerah_reporting_date_range";
const CHANGE_EVENT = "zerah:reporting-date-range-changed";

function getInitialState(): { preset: DatePreset; startDate?: string; endDate?: string } {
  if (typeof window === "undefined") {
    return { preset: "7d" };
  }

  const params = new URLSearchParams(window.location.search);
  const urlPreset = params.get("datePreset") as DatePreset | null;
  const urlStart = params.get("startDate") || undefined;
  const urlEnd = params.get("endDate") || undefined;

  if (
    urlPreset &&
    ["today", "yesterday", "7d", "30d", "this_month", "all", "custom"].includes(urlPreset)
  ) {
    return { preset: urlPreset, startDate: urlStart, endDate: urlEnd };
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (
        parsed.preset &&
        ["today", "yesterday", "7d", "30d", "this_month", "all", "custom"].includes(parsed.preset)
      ) {
        return parsed;
      }
    }
  } catch {
    // Ignore JSON parsing errors
  }

  return { preset: "7d" };
}

/**
 * Master React Hook for synchronized reporting date ranges.
 * Integrates URL params, localStorage, and back/forward browser navigation.
 */
export function useReportingDateRange() {
  const [state, setState] = useState(getInitialState);

  const syncFromUrlOrStorage = useCallback(() => {
    setState(getInitialState());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    window.addEventListener("popstate", syncFromUrlOrStorage);
    window.addEventListener(CHANGE_EVENT, syncFromUrlOrStorage);

    return () => {
      window.removeEventListener("popstate", syncFromUrlOrStorage);
      window.removeEventListener(CHANGE_EVENT, syncFromUrlOrStorage);
    };
  }, [syncFromUrlOrStorage]);

  const setDateRange = useCallback(
    (newPreset: DatePreset, newStartDate?: string, newEndDate?: string) => {
      const nextState = { preset: newPreset, startDate: newStartDate, endDate: newEndDate };
      setState(nextState);

      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
        } catch {
          // Ignore localStorage errors
        }

        const url = new URL(window.location.href);
        url.searchParams.set("datePreset", newPreset);
        if (newPreset === "custom" && newStartDate && newEndDate) {
          url.searchParams.set("startDate", newStartDate);
          url.searchParams.set("endDate", newEndDate);
        } else {
          url.searchParams.delete("startDate");
          url.searchParams.delete("endDate");
        }

        window.history.replaceState({}, "", url.toString());
        window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
      }
    },
    [],
  );

  const bounds = useMemo(() => {
    return calculateCanonicalISTBounds({
      preset: state.preset,
      startDate: state.startDate,
      endDate: state.endDate,
    });
  }, [state.preset, state.startDate, state.endDate]);

  return {
    preset: state.preset,
    startDate: state.startDate,
    endDate: state.endDate,
    bounds,
    setDateRange,
  };
}
