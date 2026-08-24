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

/**
 * Initializes the global barcode listener that listens to window keydown events.
 * It identifies hardware barcode scans, prevents form submission, strips digits if typed into an input,
 * and broadcasts the custom event 'zerah:barcode-scan'.
 */
export function initGlobalBarcodeScanner(onScan?: (code: string) => void): () => void {
  if (typeof window === "undefined") return () => {};

  let buffer = "";
  let lastKeyTime = 0;

  const handleKeyDown = (e: KeyboardEvent) => {
    // Ignore modifier combinations (Ctrl, Alt, Meta)
    if (e.ctrlKey || e.metaKey || e.altKey) {
      buffer = "";
      return;
    }

    const now = Date.now();

    // Barcode scanners typically terminate the sequence with 'Enter'
    if (e.key === "Enter") {
      const code = buffer.trim();
      const interval = now - lastKeyTime;

      if (code.length >= MIN_BARCODE_LENGTH && interval <= 120) {
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
            target.value = target.value.slice(0, -code.length);
            target.dispatchEvent(new Event("input", { bubbles: true }));
          }
          target.blur();
        }

        buffer = "";

        // Push to pending queue
        pushPendingScan(code);

        // Dispatch custom event to all listeners
        const event = new CustomEvent<BarcodeScanDetail>(SCANNER_EVENT_NAME, {
          detail: { code, timestamp: now },
        });
        window.dispatchEvent(event);

        if (onScan) {
          onScan(code);
        }
      } else {
        buffer = "";
      }
      return;
    }

    // Only process printable single characters
    if (e.key.length === 1) {
      const interval = now - lastKeyTime;
      lastKeyTime = now;

      // If interval between keys is too slow, start a new buffer
      if (interval > MAX_KEY_INTERVAL_MS) {
        buffer = e.key;
      } else {
        buffer += e.key;
      }
    }
  };

  window.addEventListener("keydown", handleKeyDown, true);
  return () => {
    window.removeEventListener("keydown", handleKeyDown, true);
  };
}

/**
 * React hook to listen for barcode scanner events inside components (e.g. POSTab)
 */
export function useGlobalBarcodeScanner(onScan: (code: string) => void) {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    // 1. Drain any pending scans that arrived before this component was mounted
    const pending = popPendingScans();
    if (pending.length > 0) {
      pending.forEach((code) => {
        onScanRef.current(code);
      });
    }

    // 2. Listen for live barcode scan events
    const handleCustomScan = (e: Event) => {
      const customEvent = e as CustomEvent<BarcodeScanDetail>;
      if (customEvent.detail?.code) {
        onScanRef.current(customEvent.detail.code);
      }
    };

    window.addEventListener(SCANNER_EVENT_NAME, handleCustomScan);
    return () => {
      window.removeEventListener(SCANNER_EVENT_NAME, handleCustomScan);
    };
  }, []);
}
