/**
 * ZÉRAH BABY & KIDS — Payment Recovery / App-Switch Safety
 *
 * Persists in-progress Razorpay payment state to sessionStorage so that:
 * 1. If user switches to UPI app and browser is backgrounded/killed, we can recover on return.
 * 2. If Razorpay callback fires (normal path), we use and clear this state.
 * 3. If browser refresh happens mid-payment, we detect the pending state and show verification UI.
 * 4. Double-clicks and retries are idempotent via the stored idempotency_key.
 */

const STORAGE_KEY = "zerah_pending_payment";

export interface PendingPaymentAttempt {
  /** Checkout session ID from create_checkout_session RPC */
  session_id: string;
  /** Razorpay order ID from create-razorpay-order edge function */
  rzp_order_id: string;
  /** Authoritative amount in paise (from server) */
  amount_paise: number;
  /** Idempotency key used to create the checkout session */
  idempotency_key: string;
  /** Unix timestamp (ms) when this attempt was saved */
  saved_at: number;
  /** Expiry (30 min from save — matches checkout_session expiry) */
  expires_at: number;
}

/** Save a pending payment attempt before opening Razorpay */
export function savePendingPayment(data: Omit<PendingPaymentAttempt, "saved_at" | "expires_at">): void {
  try {
    const record: PendingPaymentAttempt = {
      ...data,
      saved_at: Date.now(),
      expires_at: Date.now() + 30 * 60 * 1000, // 30 minutes
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // sessionStorage may be unavailable in some private modes — safe to ignore
  }
}

/** Retrieve a pending payment attempt (returns null if none or expired) */
export function getPendingPayment(): PendingPaymentAttempt | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as PendingPaymentAttempt;
    if (Date.now() > data.expires_at) {
      clearPendingPayment();
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/** Clear pending payment state (call after success or explicit cancel) */
export function clearPendingPayment(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Check URL params for Razorpay-injected payment ID on redirect-based flows.
 * On some Android devices / webviews, Razorpay may append payment details to the return URL.
 */
export function getPaymentParamsFromUrl(): {
  razorpay_payment_id?: string;
  razorpay_order_id?: string;
  razorpay_signature?: string;
} | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const payment_id = params.get("razorpay_payment_id");
    const order_id = params.get("razorpay_order_id");
    const signature = params.get("razorpay_signature");
    if (payment_id) {
      return {
        razorpay_payment_id: payment_id,
        razorpay_order_id: order_id ?? undefined,
        razorpay_signature: signature ?? undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Strip Razorpay URL params to clean up the URL after processing */
export function stripPaymentParamsFromUrl(): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("razorpay_payment_id");
    url.searchParams.delete("razorpay_order_id");
    url.searchParams.delete("razorpay_signature");
    window.history.replaceState({}, "", url.toString());
  } catch {
    // ignore
  }
}

/** Detect if running on a mobile/touch device */
export function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  return (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    (window.innerWidth <= 768 && "ontouchstart" in window)
  );
}
