import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type OrderItem = {
  id: string;
  product_slug: string;
  name: string;
  image_url: string | null;
  price: number;
  qty: number;
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
};

export const orderStatuses = [
  "placed",
  "pending",
  "confirmed",
  "processing",
  "packed",
  "shipped",
  "out_for_delivery",
  "delivered",
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

export type Profile = {
  id: string;
  full_name: string | null;
  phone: string | null;
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
      full_name: string;
      phone: string;
      address: string;
      city?: string;
      state?: string;
      pincode?: string;
    }) => {
      const { error } = await supabase.from("profiles").update(values).eq("id", userId!);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profile", userId] }),
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
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*, order_items(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Order[];
    },
  });
}

export function useCustomers(enabled: boolean) {
  return useQuery({
    queryKey: ["admin-customers"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });
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
      items: {
        product_slug: string;
        name: string;
        image_url: string | null;
        price: number;
        qty: number;
      }[];
    }) => {
      // Build items payload for the RPC (only slug + qty needed; server fetches prices)
      const rpcItems = input.items.map((item) => ({
        product_slug: item.product_slug,
        qty: item.qty,
      }));

      // The generated client types can briefly lag a newly migrated RPC.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("place_order", {
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
      });

      if (error) throw error;
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("cancel_customer_order", {
        order_id: orderId,
        reason: reason || undefined,
      });
      if (error) throw error;
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
    mutationFn: async (orderId: string) => {
      const { data, error } = await supabase.functions.invoke("send-owner-sale-notification", {
        body: { type: "online_order", order_id: orderId, force_retry: true },
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
 */
export function useDeleteCancelledOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("delete_cancelled_order", {
        _order_id: orderId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Cancelled order deleted successfully.");
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
      qc.invalidateQueries({ queryKey: ["my-orders"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e: Error) => {
      toast.error(e.message || "Unable to delete this order. No changes were made.");
    },
  });
}
