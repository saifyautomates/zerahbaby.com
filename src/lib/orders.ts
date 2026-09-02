import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type OrderItem = {
  id: string;
  order_id?: string;
  product_slug: string;
  variant_id?: string | null;
  name: string;
  product_name_snapshot?: string | null;
  image_url: string | null;
  image_url_snapshot?: string | null;
  sku_snapshot?: string | null;
  barcode_snapshot?: string | null;
  color?: string | null;
  size?: string | null;
  price: number;
  price_at_time?: number;
  qty: number;
  subtotal?: number;
};

export type Order = {
  id: string;
  user_id: string;
  email: string;
  full_name: string;
  phone: string;
  address: string;
  address_line2: string;
  city: string;
  state: string;
  pincode: string;
  landmark: string;
  alt_phone: string;
  payment_method: string;
  payment_status?: string;
  fulfillment_status?: string;
  invoice_no: string | null;
  subtotal: number;
  shipping: number;
  discount: number;
  coupon_code: string | null;
  total: number;
  status: string;
  notes: string;
  cancellation_reason?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  owner_notification_status?: string | null;
  owner_notified_at?: string | null;
  created_at: string;
  order_items: OrderItem[];
  shiprocket_order_id?: number | null;
  shiprocket_shipment_id?: number | null;
  awb_code?: string | null;
  courier_name?: string | null;
  shiprocket_status?: string | null;
  open_box_eligible?: boolean | null;
  open_box_status?: string | null;
  open_box_inspected_at?: string | null;
  open_box_notes?: string | null;
};

export const orderStatuses = [
  "placed",
  "pending",
  "confirmed",
  "processing",
  "packed",
  "shipped",
  "out_for_delivery",
  "open_box_inspection",
  "open_box_accepted",
  "open_box_rejected",
  "delivered",
  "return_in_transit",
  "return_received",
  "refund_processing",
  "cancelled",
  "returned",
];

export const CANCELLABLE_ORDER_STATUSES = [
  "placed",
  "pending",
  "confirmed",
  "processing",
  "packed",
] as const;

export function isOrderCancellable(status: string | undefined): boolean {
  if (!status) return false;
  return (CANCELLABLE_ORDER_STATUSES as readonly string[]).includes(status.toLowerCase());
}

export function isOrderReturnable(order: Order | undefined | null, windowDays = 7): boolean {
  if (!order) return false;
  const status = (order.status || "").toLowerCase();
  if (status !== "delivered" && status !== "open_box_accepted") return false;

  const orderDate = new Date(order.created_at);
  const now = new Date();
  const diffDays = (now.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays <= windowDays;
}

export function isOpenBoxEligible(order: Order | undefined | null): boolean {
  if (!order) return false;
  const status = (order.status || "").toLowerCase();
  return (
    order.open_box_eligible === true &&
    (status === "out_for_delivery" || status === "open_box_inspection" || order.open_box_status === "INSPECTION_PENDING")
  );
}

export type Profile = {
  id: string;
  full_name: string | null;
  email?: string | null;
  phone: string | null;
  avatar_url?: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  created_at: string;
  [key: string]: unknown;
};

export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ["profile", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      await supabase.rpc("ensure_profile");
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw error;
      return data as Profile | null;
    },
  });
}

export function useSaveProfile(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      full_name?: string;
      phone?: string;
      address?: string;
      city?: string;
      state?: string;
      pincode?: string;
      avatar_url?: string | null;
    }) => {
      const { error } = await supabase.from("profiles").update(values).eq("id", userId!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile", userId] });
      qc.invalidateQueries({ queryKey: ["admin-customers"] });
    },
  });
}

export function useMyOrders(userId: string | undefined) {
  return useQuery({
    queryKey: ["my-orders", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*, order_items(*)")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Order[];
    },
  });
}

export function useAllOrders(enabled: boolean) {
  return useQuery({
    queryKey: ["admin-orders"],
    enabled,
    staleTime: 1000 * 5, // 5 seconds
    refetchInterval: 15000, // 15 seconds polling fallback
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*, order_items(*)")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) {
        console.error("[orders] useAllOrders query error:", error.message);
        throw error;
      }
      return (data ?? []) as unknown as Order[];
    },
  });
}

export function useCustomers(enabled: boolean) {
  return useQuery({
    queryKey: ["admin-customers"],
    enabled,
    staleTime: 1000 * 60 * 5, // 5 minutes
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Secure order placement via server-side RPC.
 * The server verifies all prices from the products table, validates coupons,
 * computes totals, and deducts stock atomically — preventing price manipulation,
 * race conditions, and double-deduction.
 */
export function usePlaceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      userId: string;
      email: string;
      full_name: string;
      phone: string;
      address: string;
      address_line2: string;
      city: string;
      state: string;
      pincode: string;
      landmark: string;
      alt_phone: string;
      payment_method: string;
      notes: string;
      subtotal: number;
      shipping: number;
      discount?: number;
      coupon_code?: string;
      idempotency_key?: string;
      items: {
        variant_id: string;
        product_slug: string;
        name: string;
        image_url: string | null;
        price: number;
        qty: number;
      }[];
    }) => {
      // Build items payload for the RPC (only variant_id + qty needed; server fetches prices)
      const rpcItems = input.items.map((item) => ({
        variant_id: item.variant_id,
        qty: item.qty,
      }));

      const timeoutPromise = new Promise<{
        data: unknown;
        error: { message?: string } | null;
      }>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                "Order placement timed out. Please check your internet connection and try again.",
              ),
            ),
          15000,
        ),
      );

      const rpcPromise = supabase.rpc("place_order", {
        _full_name: input.full_name,
        _email: input.email,
        _phone: input.phone,
        _alt_phone: input.alt_phone,
        _address: input.address,
        _address_line2: input.address_line2,
        _landmark: input.landmark,
        _city: input.city,
        _state: input.state,
        _pincode: input.pincode,
        _payment_method: input.payment_method,
        _notes: input.notes,
        _coupon_code: input.coupon_code || undefined,
        _items: rpcItems,
        _idempotency_key: input.idempotency_key || undefined,
      });

      const { data, error } = await Promise.race([rpcPromise, timeoutPromise]);

      if (error)
        throw new Error((error as { message?: string })?.message || "Failed to place order");
      return (data as { order_id: string }).order_id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-orders"] });
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
      qc.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

/**
 * Customer order cancellation hook.
 * Executes cancel_customer_order RPC atomically, ensuring stock restoration
 * and timeline logging.
 */
export function useCancelCustomerOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, reason }: { orderId: string; reason?: string }) => {
      const { data, error } = await supabase.rpc("cancel_customer_order", {
        order_id: orderId,
        reason: reason || undefined,
      });
      if (error) throw error;

      // Trigger order cancellation SMS (non-blocking)
      supabase.functions
        .invoke("msg91-transactional", {
          body: {
            order_id: orderId,
            event_type: "order_cancelled",
            notify_owner: false,
          },
        })
        .catch(() => {});

      return data;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["my-orders"] });
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["order-history", variables.orderId] });
    },
  });
}

/**
 * Manual retry hook for resending owner notification email for online orders.
 */
export function useRetryOrderNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orderId,
      type,
    }: {
      orderId: string;
      type: "online_order" | "offline_sale";
    }) => {
      const payload: Record<string, unknown> = { type, force_retry: true };
      if (type === "online_order") {
        payload.order_id = orderId;
      } else {
        payload.sale_id = orderId;
      }

      const { data, error } = await supabase.functions.invoke("send-owner-sale-notification", {
        body: payload,
      });
      if (error) throw error;
      if (data && !data.success && data.error) {
        throw new Error(data.error);
      }
      return data;
    },
    onSuccess: () => {
      toast.success("Owner notification email sent!");
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
    },
    onError: (e: Error) => {
      toast.error(`Failed to send email notification: ${e.message}`);
    },
  });
}

/**
 * Admin hook to permanently delete a cancelled order.
 * Strictly verifies admin role and current 'cancelled' status on the backend.
 * Uses Edge Function, RPC, and direct client cascade fallback for zero-failure execution.
 */
export function useDeleteCancelledOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => {
      // 1. Try Supabase Edge Function first
      try {
        const { data: edgeData, error: edgeError } = await supabase.functions.invoke(
          "delete-cancelled-order",
          {
            body: { order_id: orderId },
          },
        );
        if (!edgeError && edgeData && !edgeData.error) {
          return edgeData;
        }
        if (edgeError && !edgeError.message?.includes("Failed to send a request")) {
          // If the Edge function explicitly returned a business rule error (e.g. not cancelled), throw it
          if (edgeData?.error) throw new Error(edgeData.error);
        }
      } catch (err) {
        const msg = (err as Error).message || "";
        if (msg.includes("Only cancelled orders") || msg.includes("Unauthorized")) {
          throw err;
        }
      }

      // 2. Try Supabase RPC Function
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc("delete_cancelled_order", {
          _order_id: orderId,
        });
        if (!rpcError && rpcData) {
          return rpcData;
        }
        if (
          rpcError &&
          !rpcError.message?.includes("schema cache") &&
          !rpcError.message?.includes("42883")
        ) {
          throw rpcError;
        }
      } catch (rpcErr) {
        const msg = (rpcErr as Error).message || "";
        if (msg.includes("Only cancelled") || msg.includes("Unauthorized")) {
          throw rpcErr;
        }
      }

      // 3. Resilient Direct Client Fallback
      const { data: order, error: fetchErr } = await supabase
        .from("orders")
        .select("id, status")
        .eq("id", orderId)
        .maybeSingle();

      if (fetchErr || !order) {
        throw new Error("Order not found or already removed.");
      }

      if (order.status !== "cancelled") {
        throw new Error(
          `Cannot delete order with status '${order.status}'. Only cancelled orders can be permanently deleted.`,
        );
      }

      // Use secure RPC to bypass RLS and perform cascading deletion
      const { error: rpcErr } = await supabase.rpc("delete_cancelled_order", {
        _order_id: orderId,
      });

      if (rpcErr) {
        throw new Error(rpcErr.message || "Failed to delete cancelled order.");
      }

      return { success: true, message: "Cancelled order deleted successfully." };
    },
    onSuccess: () => {
      toast.success("Cancelled order deleted successfully.");
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
      qc.invalidateQueries({ queryKey: ["my-orders"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["offline-sales"] });
      qc.invalidateQueries({ queryKey: ["offline-sales-badge-count"] });
    },
    onError: (e: Error) => {
      toast.error(e.message || "Unable to delete this order. No changes were made.");
    },
  });
}

/**
 * Shiprocket Integration Hooks
 */
export function useCreateShiprocketShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => {
      const { data, error } = await supabase.functions.invoke("shiprocket-api", {
        body: { action: "create_shipment", orderId },
      });
      if (error) throw error;
      if (data && data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success("Shiprocket shipment created!");
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to create shipment"),
  });
}

export function useGenerateShiprocketAWB() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => {
      const { data, error } = await supabase.functions.invoke("shiprocket-api", {
        body: { action: "generate_awb", orderId },
      });
      if (error) throw error;
      if (data && data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success("AWB Generated successfully!");
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to generate AWB"),
  });
}

export function useRequestShiprocketPickup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => {
      const { data, error } = await supabase.functions.invoke("shiprocket-api", {
        body: { action: "request_pickup", orderId },
      });
      if (error) throw error;
      if (data && data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success("Pickup requested successfully!");
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to request pickup"),
  });
}
