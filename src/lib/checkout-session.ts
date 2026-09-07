import { supabase } from "@/integrations/supabase/client";

export interface CheckoutSessionItem {
  variant_id: string;
  qty: number;
}

export interface CreateCheckoutSessionInput {
  items: CheckoutSessionItem[];
  coupon_code?: string | null;
  full_name: string;
  email: string;
  phone: string;
  alt_phone?: string;
  address: string;
  address_line2?: string;
  landmark?: string;
  city: string;
  state: string;
  pincode: string;
  notes?: string;
  idempotency_key?: string;
  payment_method?: "online" | "cod";
}

export interface CheckoutSessionResult {
  success: boolean;
  session_id: string;
  subtotal: number;
  shipping_fee: number;
  discount: number;
  cod_fee: number;
  total: number;
  currency: string;
  error?: string;
}

export interface PlaceCodOrderResult {
  success: boolean;
  order_id: string;
  order_number: string;
  invoice_no: string;
  total: number;
  payment_status: "pending";
  status: "processing";
  error?: string;
}

/**
 * Creates an authoritative checkout session on the database server.
 * Validates prices, coupons, and calculates authoritative totals.
 */
export async function createCheckoutSession(
  input: CreateCheckoutSessionInput,
): Promise<CheckoutSessionResult> {
  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: CheckoutSessionResult | null; error: { message: string } | null }>)(
    "create_checkout_session",
    {
      _items: input.items,
      _coupon_code: input.coupon_code || null,
      _full_name: input.full_name,
      _email: input.email,
      _phone: input.phone,
      _alt_phone: input.alt_phone || null,
      _address: input.address,
      _address_line2: input.address_line2 || null,
      _landmark: input.landmark || null,
      _city: input.city,
      _state: input.state,
      _pincode: input.pincode,
      _notes: input.notes || null,
      _idempotency_key: input.idempotency_key || null,
      _payment_method: input.payment_method || "online",
    },
  );

  if (error) {
    throw new Error(error.message || "Failed to initialize checkout session");
  }

  if (!data || !data.success) {
    throw new Error(data?.error || "Failed to create checkout session");
  }

  return data;
}

/**
 * Marks a checkout session as cancelled when customer closes the gateway
 * or intentionally aborts payment.
 */
export async function cancelCheckoutSession(
  sessionId: string,
  reason: string = "Customer closed payment modal",
): Promise<void> {
  try {
    await (supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>)("cancel_checkout_session", {
      _session_id: sessionId,
      _reason: reason,
    });
  } catch (err) {
    console.warn("[checkout-session] cancelCheckoutSession notice:", err);
  }
}

/**
 * Places a Cash on Delivery order authoritatively from an existing valid checkout session.
 */
export async function placeCodOrder(sessionId: string): Promise<PlaceCodOrderResult> {
  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: PlaceCodOrderResult | null; error: { message: string } | null }>)(
    "place_cod_order",
    {
      _session_id: sessionId,
    },
  );

  if (error) {
    throw new Error(error.message || "Failed to place COD order");
  }

  if (!data || !data.success) {
    throw new Error(data?.error || "Failed to place COD order");
  }

  return data;
}
