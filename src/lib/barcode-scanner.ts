import { useEffect, useRef } from "react";

// Timing threshold in ms. Physical barcode scanners emit chars with ~10-40ms intervals.
// Humans typing naturally take >= 120-250ms per key.
const MAX_KEY_INTERVAL_MS = 75;
const MIN_BARCODE_LENGTH = 4;

export const SCANNER_EVENT_NAME = "zerah:barcode-scan";

export interface BarcodeScanDetail {
  code: string;
  timestamp: number;
}

// Global queue for scans that occurred while navigating or before POS mount
const pendingScanQueue: string[] = [];

export function pushPendingScan(code: string) {
  pendingScanQueue.push(code);
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
 * Initializes the global barcode listener that listens to window keydown events.
 * It identifies hardware barcode scans, prevents form submission, strips digits if typed into an input,
 * and broadcasts the custom event 'zerah:barcode-scan'.
 */
let globalBuffer = "";
let globalLastKeyTime = 0;
let isGlobalListenerBound = false;

const globalCallbacks = new Set<(code: string) => void>();
let lastFiredCode = "";
let lastFiredTime = 0;

const handleGlobalKeyDown = (e: KeyboardEvent) => {
  // Ignore modifier combinations (Ctrl, Alt, Meta)
  if (e.ctrlKey || e.metaKey || e.altKey) {
    globalBuffer = "";
    return;
  }

  const now = Date.now();

  // Barcode scanners typically terminate the sequence with 'Enter'
  if (e.key === "Enter") {
    const code = globalBuffer.trim();
    const interval = now - globalLastKeyTime;

    if (code.length >= MIN_BARCODE_LENGTH && interval <= 120) {
      if (code === lastFiredCode && now - lastFiredTime < 1200) {
        e.preventDefault();
        e.stopPropagation();
        globalBuffer = "";
        return;
      }
      lastFiredCode = code;
      lastFiredTime = now;

      // We have a confirmed barcode burst!
      e.preventDefault();
      e.stopPropagation();

      const target = e.target as HTMLElement | null;
      const isInput =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;

      // If the scanner inadvertently typed into an active input field, clean up the input
      if (isInput && target instanceof HTMLInputElement) {
        if (target.value === code || target.value.endsWith(code)) {
          const newValue = target.value.slice(0, -code.length);
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
        target.blur();
      }

      globalBuffer = "";

      // Push to pending queue
      pushPendingScan(code);

      // Dispatch custom event to all listeners
      const event = new CustomEvent<BarcodeScanDetail>(SCANNER_EVENT_NAME, {
        detail: { code, timestamp: now },
      });
      window.dispatchEvent(event);

      // Call all registered explicit callbacks
      globalCallbacks.forEach((cb) => cb(code));
    } else {
      globalBuffer = "";
    }
    return;
  }

  // Only process printable single characters
  if (e.key.length === 1) {
    const interval = now - globalLastKeyTime;
    globalLastKeyTime = now;

    // If interval between keys is too slow, start a new buffer
    if (interval > MAX_KEY_INTERVAL_MS) {
      globalBuffer = e.key;
    } else {
      globalBuffer += e.key;
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
        if (lastHandledRef.current.code === code && now - lastHandledRef.current.time < 1200) {
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
          now - lastHandledRef.current.time < 1200
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
