import { useEffect, useRef } from "react";

// Timing threshold in ms. Physical barcode scanners emit chars with ~10-60ms intervals.
// Humans typing naturally take >= 150-300ms per key.
// 180ms comfortably accommodates wireless 2.4GHz dongles and Bluetooth scanner jitter on Windows.
const MAX_KEY_INTERVAL_MS = 180;
const MIN_BARCODE_LENGTH = 4;
const QUIET_ZONE_COMMIT_MS = 150;

export const SCANNER_EVENT_NAME = "zerah:barcode-scan";

export interface BarcodeScanDetail {
  code: string;
  rawCode: string;
  timestamp: number;
}

/**
 * Sanitizes raw scanned input:
 * 1. Strips non-printable ASCII control characters (STX, ETX, ESC, etc.)
 * 2. Strips ISO/IEC 15424 AIM symbology identifiers (e.g. ]e0, ]C1, ]A0, ]Q3, ]d2)
 * 3. Trims leading/trailing whitespace
 */
export function sanitizeBarcode(raw: string): string {
  if (!raw) return "";
  let clean = raw.trim();
  // Strip non-printable ASCII control characters
  clean = clean.replace(/[\x00-\x1F\x7F-\x9F]/g, "");
  // Strip AIM symbology identifier prefix (e.g. ]C1, ]e0, ]A0, ]Q3, ]d2)
  clean = clean.replace(/^\][a-zA-Z0-9]{2,3}/, "");
  return clean.trim();
}

/**
 * Generates barcode candidates to seamlessly match UPC-A (12 digits) and EAN-13 (13 digits).
 * Hardware scanners set to EAN-13 automatically prepend a 0 to 12-digit barcodes.
 */
export function getBarcodeCandidates(raw: string): string[] {
  const clean = sanitizeBarcode(raw);
  if (!clean) return [];

  const candidates: string[] = [clean];

  // EAN-13 to UPC-A: if 13 digits starting with '0', candidate without leading 0
  if (clean.length === 13 && clean.startsWith("0")) {
    const withoutZero = clean.slice(1);
    if (!candidates.includes(withoutZero)) {
      candidates.push(withoutZero);
    }
  }

  // UPC-A to EAN-13: if 12 digits, candidate with leading 0
  if (clean.length === 12 && /^\d+$/.test(clean)) {
    const withZero = "0" + clean;
    if (!candidates.includes(withZero)) {
      candidates.push(withZero);
    }
  }

  return candidates;
}

// Global queue for scans that occurred while navigating or before POS mount
const pendingScanQueue: string[] = [];

export function pushPendingScan(code: string) {
  const clean = sanitizeBarcode(code);
  if (!clean) return;
  pendingScanQueue.push(clean);
  if (typeof window !== "undefined") {
    (window as unknown as { __PENDING_BARCODE_QUEUE: string[] }).__PENDING_BARCODE_QUEUE =
      pendingScanQueue;
  }
}

export function popPendingScans(): string[] {
  const items = [...pendingScanQueue];
  pendingScanQueue.length = 0;
  if (typeof window !== "undefined") {
    (window as unknown as { __PENDING_BARCODE_QUEUE: string[] }).__PENDING_BARCODE_QUEUE = [];
  }
  return items;
}

export function hasPendingScans(): boolean {
  return pendingScanQueue.length > 0;
}

export function clearPendingScans(): void {
  pendingScanQueue.length = 0;
  if (typeof window !== "undefined") {
    (window as unknown as { __PENDING_BARCODE_QUEUE: string[] }).__PENDING_BARCODE_QUEUE = [];
  }
}

/**
 * Global scanner state and burst tracking
 */
let globalBuffer = "";
let globalLastKeyTime = 0;
let burstStartTime = 0;
let burstKeyCount = 0;
let isGlobalListenerBound = false;
let quietTimer: ReturnType<typeof setTimeout> | null = null;

const globalCallbacks = new Set<(code: string) => void>();
let lastFiredCode = "";
let lastFiredTime = 0;

/**
 * Commits a validated barcode scan:
 * - Cleans up active input if characters leaked into it
 * - Broadcasts event and triggers callbacks
 */
function commitBarcode(rawString: string, activeElement?: HTMLElement | null): boolean {
  const clean = sanitizeBarcode(rawString);
  const now = Date.now();

  if (clean.length < MIN_BARCODE_LENGTH) {
    return false;
  }

  // 300ms debounce prevents double-fire while permitting rapid scanning of identical items
  if (clean === lastFiredCode && now - lastFiredTime < 300) {
    return false;
  }

  lastFiredCode = clean;
  lastFiredTime = now;

  // If the scanner inadvertently typed into an active input field, clean up the input
  const target = activeElement || (typeof document !== "undefined" ? document.activeElement : null);
  if (target instanceof HTMLInputElement) {
    const val = target.value;
    if (val === rawString || val.endsWith(rawString) || val === clean || val.endsWith(clean)) {
      const charsToRemove = val.endsWith(rawString) ? rawString.length : clean.length;
      const newValue = val.slice(0, -charsToRemove);
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;

      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(target, newValue);
        target.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        target.value = newValue;
        target.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    // Retain focus on POS universal scan input so subsequent scans are continuous
    if (target.id !== "pos-barcode-search-input") {
      target.blur();
    }
  }

  // Push to pending queue
  pushPendingScan(clean);

  // Dispatch custom event to all listeners
  const event = new CustomEvent<BarcodeScanDetail>(SCANNER_EVENT_NAME, {
    detail: { code: clean, rawCode: rawString, timestamp: now },
  });
  window.dispatchEvent(event);

  // Call all registered explicit callbacks
  globalCallbacks.forEach((cb) => cb(clean));

  return true;
}

const handleGlobalKeyDown = (e: KeyboardEvent) => {
  // Ignore modifier combinations (Ctrl, Alt, Meta)
  if (e.ctrlKey || e.metaKey || e.altKey) {
    if (quietTimer) {
      clearTimeout(quietTimer);
      quietTimer = null;
    }
    globalBuffer = "";
    burstKeyCount = 0;
    return;
  }

  const now = Date.now();

  // 1. Barcode scanners typically terminate the sequence with 'Enter' or 'Tab'
  if (e.key === "Enter" || e.key === "Tab") {
    if (quietTimer) {
      clearTimeout(quietTimer);
      quietTimer = null;
    }

    const raw = globalBuffer;
    const clean = sanitizeBarcode(raw);
    const interval = now - globalLastKeyTime;

    // Up to 800ms suffix delay is permitted because all preceding characters already arrived rapidly
    if (clean.length >= MIN_BARCODE_LENGTH && interval <= 800) {
      e.preventDefault();
      e.stopPropagation();

      const committed = commitBarcode(raw, e.target as HTMLElement | null);
      if (committed) {
        globalBuffer = "";
        burstKeyCount = 0;
        return;
      }
    }

    globalBuffer = "";
    burstKeyCount = 0;
    return;
  }

  // 2. Only process printable single characters
  if (e.key.length === 1) {
    const interval = now - globalLastKeyTime;
    globalLastKeyTime = now;

    // If interval between keys is too slow for a scanner burst, start a fresh buffer
    if (interval > MAX_KEY_INTERVAL_MS) {
      globalBuffer = e.key;
      burstStartTime = now;
      burstKeyCount = 1;
    } else {
      globalBuffer += e.key;
      burstKeyCount++;
    }

    // 3. Quiet-Zone Auto-Commit for hardware scanners WITHOUT Enter/Tab suffix
    // When keys arrive at scanner burst speed, start a quiet-zone timer.
    // If no new character arrives within 150ms and the burst characteristics indicate a hardware scan,
    // auto-commit the barcode!
    if (quietTimer) {
      clearTimeout(quietTimer);
      quietTimer = null;
    }

    const currentClean = sanitizeBarcode(globalBuffer);
    if (currentClean.length >= MIN_BARCODE_LENGTH) {
      const activeEl = e.target as HTMLElement | null;
      quietTimer = setTimeout(() => {
        const bufferedRaw = globalBuffer;
        const bufferedClean = sanitizeBarcode(bufferedRaw);
        const burstDuration = Date.now() - burstStartTime;
        const avgKeyInterval = burstKeyCount > 1 ? burstDuration / burstKeyCount : 999;

        // Verify this was truly a machine scanner burst (< 110ms average inter-key time)
        if (bufferedClean.length >= MIN_BARCODE_LENGTH && avgKeyInterval <= 110) {
          commitBarcode(bufferedRaw, activeEl);
          globalBuffer = "";
          burstKeyCount = 0;
        }
      }, QUIET_ZONE_COMMIT_MS);
    }
  }
};

/**
 * Initializes the global barcode listener that listens to window keydown events.
 * It identifies hardware barcode scans, prevents form submission, strips digits if typed into an input,
 * and broadcasts the custom event 'zerah:barcode-scan'.
 */
export function initGlobalBarcodeScanner(onScan?: (code: string) => void): () => void {
  if (typeof window === "undefined") return () => {};

  if (onScan) {
    globalCallbacks.add(onScan);
  }

  if (!isGlobalListenerBound) {
    window.addEventListener("keydown", handleGlobalKeyDown, true);
    isGlobalListenerBound = true;
  }

  return () => {
    if (onScan) {
      globalCallbacks.delete(onScan);
    }
  };
}

// Auto-bind on browser boot
if (typeof window !== "undefined" && !isGlobalListenerBound) {
  window.addEventListener("keydown", handleGlobalKeyDown, true);
  isGlobalListenerBound = true;
  (window as unknown as Record<string, unknown>).__zerahBarcodeScanner = {
    initGlobalBarcodeScanner,
    pushPendingScan,
    popPendingScans,
    hasPendingScans,
  };
}

/**
 * React hook to listen for barcode scanner events inside components (e.g. POSTab, POSReturnsTab)
 */
export function useGlobalBarcodeScanner(onScan: (code: string) => void, enabled: boolean = true) {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const lastHandledRef = useRef<{ code: string; time: number }>({ code: "", time: 0 });

  useEffect(() => {
    if (!enabled) return;

    // 1. Drain any pending scans that arrived before this component was mounted
    const pending = popPendingScans();
    if (pending.length > 0) {
      pending.forEach((code) => {
        const now = Date.now();
        if (lastHandledRef.current.code === code && now - lastHandledRef.current.time < 300) {
          return;
        }
        lastHandledRef.current = { code, time: now };
        onScanRef.current(code);
      });
    }

    // 2. Listen for live barcode scan events
    const listener = (e: Event) => {
      const detail = (e as CustomEvent<BarcodeScanDetail>).detail;
      if (detail && detail.code) {
        const now = Date.now();
        if (
          lastHandledRef.current.code === detail.code &&
          now - lastHandledRef.current.time < 300
        ) {
          return;
        }
        lastHandledRef.current = { code: detail.code, time: now };
        onScanRef.current(detail.code);
      }
    };
    window.addEventListener(SCANNER_EVENT_NAME, listener);
    return () => {
      window.removeEventListener(SCANNER_EVENT_NAME, listener);
    };
  }, [enabled]);
}
