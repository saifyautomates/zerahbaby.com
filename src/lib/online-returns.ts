import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type OnlineReturnStatus =
  | "REQUESTED"
  | "APPROVED"
  | "PICKUP_SCHEDULED"
  | "PICKUP_ATTEMPTED"
  | "IN_TRANSIT"
  | "RECEIVED"
  | "QC_PENDING"
  | "QC_APPROVED"
  | "QC_REJECTED"
  | "CANCELLED"
  | "COMPLETED";

export type OnlineRefundStatus =
  "NOT_APPLICABLE" | "PENDING" | "PROCESSING" | "PROCESSED" | "FAILED" | "MANUAL_REVIEW";

export type OnlineReturnItem = {
  id: string;
  return_id: string;
  order_item_id: string;
  product_id?: string | null;
  variant_id?: string | null;
  product_slug: string;
  product_name_snapshot: string;
  sku_snapshot: string;
  image_snapshot?: string | null;
  color_snapshot?: string | null;
  size_snapshot?: string | null;
  quantity_requested: number;
  quantity_approved: number;
  quantity_received: number;
  historical_unit_price: number;
  historical_paid_amount: number;
  allocated_discount: number;
  item_refund_amount: number;
  qc_status: "PENDING" | "APPROVED" | "REJECTED";
  qc_note?: string | null;
  inventory_restored: boolean;
  created_at: string;
  updated_at: string;
};

export type OnlineReturnEvent = {
  id: string;
  return_id: string;
  event_type: string;
  old_status?: string | null;
  new_status?: string | null;
  note: string;
  actor_id?: string | null;
  actor_role: string;
  metadata?: Record<string, unknown>;
  created_at: string;
};

export type OnlineReturn = {
  id: string;
  return_number: string;
  order_id: string;
  user_id: string;
  return_status: OnlineReturnStatus;
  refund_status: OnlineRefundStatus;
  reason_category: string;
  reason_label: string;
  customer_note?: string;
  admin_note?: string;
  qc_summary?: string;
  return_shipping_fee: number;
  eligible_refund_amount: number;
  final_refund_amount: number;
  currency: string;
  refund_calculation_snapshot: Record<string, unknown>;
  razorpay_refund_id?: string | null;
  razorpay_refund_status?: string | null;
  shiprocket_return_order_id?: number | null;
  shiprocket_return_shipment_id?: number | null;
  shiprocket_return_awb?: string | null;
  shiprocket_return_courier?: string | null;
  shiprocket_return_status?: string | null;
  pickup_scheduled_at?: string | null;
  received_at?: string | null;
  qc_completed_at?: string | null;
  refund_initiated_at?: string | null;
  refund_completed_at?: string | null;
  idempotency_key?: string | null;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  updated_by?: string | null;
  online_return_items?: OnlineReturnItem[];
  online_return_events?: OnlineReturnEvent[];
  orders?: {
    id: string;
    order_number?: string;
    invoice_no?: string;
    full_name: string;
    email: string;
    phone: string;
    payment_method: string;
    payment_status?: string;
    total: number;
    subtotal: number;
    discount: number;
    shipping: number;
    address: string;
    city: string;
    state: string;
    pincode: string;
    status: string;
    created_at: string;
  };
};

export type OpenBoxEvent = {
  id: string;
  order_id: string;
  decision: "ACCEPTED" | "REJECTED";
  rejection_reason?: string | null;
  rejection_notes?: string | null;
  actor_id?: string | null;
  linked_return_id?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
};

export type CalculatedRefundItem = {
  order_item_id: string;
  product_id?: string;
  variant_id?: string;
  product_name: string;
  sku: string;
  color?: string | null;
  size?: string | null;
  image_url?: string | null;
  original_unit_price: number;
  qty_requested: number;
  max_returnable_qty: number;
  allocated_discount: number;
  item_refund_amount: number;
};

export type CalculatedRefundResult = {
  success: boolean;
  order_id: string;
  is_eligible: boolean;
  ineligible_reason?: string;
  eligible_refund_amount: number;
  return_shipping_fee: number;
  final_refund_amount: number;
  currency: string;
  items: CalculatedRefundItem[];
  error?: string;
};

/* ------------------------------------------------------------------ */
/*  Return Reasons & Rules                                            */
/* ------------------------------------------------------------------ */

export type ReturnReasonOption = {
  category: string;
  label: string;
  sellerFault: boolean;
  description: string;
};

export const ONLINE_RETURN_REASONS: ReturnReasonOption[] = [
  {
    category: "SIZE_TOO_SMALL",
    label: "Size is too small / tight",
    sellerFault: false,
    description: "Item doesn't fit comfortably (Logistics fee applies)",
  },
  {
    category: "SIZE_TOO_LARGE",
    label: "Size is too large / loose",
    sellerFault: false,
    description: "Item is bigger than expected (Logistics fee applies)",
  },
  {
    category: "DEFECTIVE",
    label: "Defective / stitching / fabric damage",
    sellerFault: true,
    description: "Item has a manufacturing defect or torn seams (Free return)",
  },
  {
    category: "WRONG_ITEM",
    label: "Received wrong item or wrong size",
    sellerFault: true,
    description: "Delivered product did not match ordered item (Free return)",
  },
  {
    category: "DAMAGED_IN_TRANSIT",
    label: "Damaged in transit / packaging torn",
    sellerFault: true,
    description: "Package or product arrived damaged (Free return)",
  },
  {
    category: "COLOR_FIT_EXPECTATION",
    label: "Color or look not as expected",
    sellerFault: false,
    description: "Different appearance than photos (Logistics fee applies)",
  },
  {
    category: "QUALITY_ISSUE",
    label: "Fabric / material not satisfactory",
    sellerFault: false,
    description: "Material feel or wash quality issue (Logistics fee applies)",
  },
  {
    category: "OPEN_BOX_REJECTED",
    label: "Open Box Delivery rejected at doorstep",
    sellerFault: true,
    description: "Inspected at delivery and rejected before acceptance (Free return)",
  },
  {
    category: "OTHER",
    label: "Other reason / Changed mind",
    sellerFault: false,
    description: "General return (Logistics fee applies)",
  },
];

export const RETURN_STATUS_BADGES: Record<
  OnlineReturnStatus,
  { label: string; bg: string; text: string; border: string }
> = {
  REQUESTED: {
    label: "Return Requested",
    bg: "bg-amber-50",
    text: "text-amber-800",
    border: "border-amber-200",
  },
  APPROVED: {
    label: "Return Approved",
    bg: "bg-blue-50",
    text: "text-blue-800",
    border: "border-blue-200",
  },
  PICKUP_SCHEDULED: {
    label: "Pickup Scheduled",
    bg: "bg-indigo-50",
    text: "text-indigo-800",
    border: "border-indigo-200",
  },
  PICKUP_ATTEMPTED: {
    label: "Pickup Attempted",
    bg: "bg-purple-50",
    text: "text-purple-800",
    border: "border-purple-200",
  },
  IN_TRANSIT: {
    label: "In Transit to Store",
    bg: "bg-sky-50",
    text: "text-sky-800",
    border: "border-sky-200",
  },
  RECEIVED: {
    label: "Received at Facility",
    bg: "bg-teal-50",
    text: "text-teal-800",
    border: "border-teal-200",
  },
  QC_PENDING: {
    label: "QC Inspection Pending",
    bg: "bg-orange-50",
    text: "text-orange-800",
    border: "border-orange-200",
  },
  QC_APPROVED: {
    label: "QC Passed",
    bg: "bg-emerald-50",
    text: "text-emerald-800",
    border: "border-emerald-200",
  },
  QC_REJECTED: {
    label: "QC Rejected",
    bg: "bg-rose-50",
    text: "text-rose-800",
    border: "border-rose-200",
  },
  CANCELLED: {
    label: "Cancelled",
    bg: "bg-zinc-100",
    text: "text-zinc-700",
    border: "border-zinc-200",
  },
  COMPLETED: {
    label: "Return Completed",
    bg: "bg-green-100",
    text: "text-green-800",
    border: "border-green-300",
  },
};

export const REFUND_STATUS_BADGES: Record<
  OnlineRefundStatus,
  { label: string; bg: string; text: string; border: string }
> = {
  NOT_APPLICABLE: {
    label: "No Refund",
    bg: "bg-zinc-100",
    text: "text-zinc-600",
    border: "border-zinc-200",
  },
  PENDING: {
    label: "Refund Pending",
    bg: "bg-amber-50",
    text: "text-amber-800",
    border: "border-amber-200",
  },
  PROCESSING: {
    label: "Processing Refund",
    bg: "bg-blue-50",
    text: "text-blue-800",
    border: "border-blue-200",
  },
  PROCESSED: {
    label: "Refund Processed",
    bg: "bg-emerald-100",
    text: "text-emerald-800",
    border: "border-emerald-300",
  },
  FAILED: {
    label: "Refund Failed",
    bg: "bg-rose-100",
    text: "text-rose-800",
    border: "border-rose-200",
  },
  MANUAL_REVIEW: {
    label: "Manual Bank Transfer Needed",
    bg: "bg-purple-50",
    text: "text-purple-800",
    border: "border-purple-200",
  },
};

/* ------------------------------------------------------------------ */
/*  Queries                                                            */
/* ------------------------------------------------------------------ */

export function useMyReturns(userId?: string) {
  return useQuery({
    queryKey: ["my-returns", userId],
    enabled: Boolean(userId),
    staleTime: 1000 * 15,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("online_returns")
        .select(
          `
          *,
          online_return_items (*),
          online_return_events (*),
          orders (
            id, order_number, invoice_no, full_name, phone, payment_method, payment_status, total, created_at, status
          )
        `,
        )
        .eq("user_id", userId!)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as unknown as OnlineReturn[];
    },
  });
}

export function useOrderReturns(orderId?: string) {
  return useQuery({
    queryKey: ["order-returns", orderId],
    enabled: Boolean(orderId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("online_returns")
        .select(
          `
          *,
          online_return_items (*),
          online_return_events (*)
        `,
        )
        .eq("order_id", orderId!)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as unknown as OnlineReturn[];
    },
  });
}

export function useAllOnlineReturns(enabled: boolean) {
  return useQuery({
    queryKey: ["admin-online-returns"],
    enabled,
    staleTime: 1000 * 10,
    refetchInterval: 20000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("online_returns")
        .select(
          `
          *,
          online_return_items (*),
          online_return_events (*),
          orders (
            id, order_number, invoice_no, full_name, email, phone, payment_method, payment_status, total, subtotal, discount, shipping, address, city, state, pincode, status, created_at
          )
        `,
        )
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) {
        console.error("[online-returns] useAllOnlineReturns error:", error);
        throw error;
      }
      return (data ?? []) as unknown as OnlineReturn[];
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Refund Calculation Preview Hook                                    */
/* ------------------------------------------------------------------ */

export function useCalculateOnlineReturnRefund() {
  return useMutation({
    mutationFn: async (payload: {
      orderId: string;
      items: { order_item_id: string; qty: number }[];
      reasonCategory: string;
    }): Promise<CalculatedRefundResult> => {
      const { data, error } = await supabase.rpc("calculate_online_return_refund", {
        _order_id: payload.orderId,
        _items: payload.items,
        _reason_category: payload.reasonCategory,
      });

      if (error) throw error;
      return data as unknown as CalculatedRefundResult;
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Customer Request Online Return Hook                               */
/* ------------------------------------------------------------------ */

export function useRequestOnlineReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      orderId: string;
      items: { order_item_id: string; qty: number }[];
      reasonCategory: string;
      reasonLabel: string;
      customerNote?: string;
      idempotencyKey?: string;
    }) => {
      const { data, error } = await supabase.rpc("request_online_return", {
        _order_id: payload.orderId,
        _items: payload.items,
        _reason_category: payload.reasonCategory,
        _reason_label: payload.reasonLabel,
        _customer_note: payload.customerNote || "",
        _idempotency_key: payload.idempotencyKey || `ret_${payload.orderId}_${Date.now()}`,
      });

      if (error) throw error;

      // Trigger store owner email notification (non-blocking)
      if (data && (data as { return_id?: string }).return_id) {
        supabase.functions
          .invoke("send-owner-sale-notification", {
            body: {
              type: "online_return",
              return_id: (data as { return_id: string }).return_id,
            },
          })
          .catch((err) => console.warn("[online-returns] Owner notification warning:", err));
      }

      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-orders"] });
      qc.invalidateQueries({ queryKey: ["my-returns"] });
      qc.invalidateQueries({ queryKey: ["order-returns"] });
      qc.invalidateQueries({ queryKey: ["admin-online-returns"] });
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Admin Status & QC Mutations                                       */
/* ------------------------------------------------------------------ */

export function useAdminUpdateReturnStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      returnId: string;
      newStatus: OnlineReturnStatus;
      adminNote?: string;
      metadata?: Record<string, unknown>;
    }) => {
      const { data, error } = await supabase.rpc("admin_update_online_return_status", {
        _return_id: payload.returnId,
        _new_status: payload.newStatus,
        _admin_note: payload.adminNote || "",
        _metadata: (payload.metadata || {}) as any,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Return status updated successfully");
      qc.invalidateQueries({ queryKey: ["admin-online-returns"] });
      qc.invalidateQueries({ queryKey: ["my-returns"] });
      qc.invalidateQueries({ queryKey: ["order-returns"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to update return status");
    },
  });
}

export function useAdminProcessReturnQC() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      returnId: string;
      itemsQc: {
        order_item_id: string;
        passed: boolean;
        qty_accepted: number;
        qc_note?: string;
      }[];
      qcSummary?: string;
      restockApproved?: boolean;
    }) => {
      const { data, error } = await supabase.rpc("admin_process_return_qc", {
        _return_id: payload.returnId,
        _items_qc: payload.itemsQc,
        _qc_summary: payload.qcSummary || "",
        _restock_approved: payload.restockApproved ?? true,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Quality inspection recorded & inventory updated");
      qc.invalidateQueries({ queryKey: ["admin-online-returns"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["admin-inventory-table"] });
      qc.invalidateQueries({ queryKey: ["my-returns"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "QC processing failed");
    },
  });
}

export function useAdminProcessOnlineRefund() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { returnId: string; overrideAmount?: number; notes?: string }) => {
      const { data, error } = await supabase.functions.invoke("process-online-refund", {
        body: {
          return_id: payload.returnId,
          override_amount: payload.overrideAmount,
          notes: payload.notes,
        },
      });

      if (error) throw error;
      if (data && data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success("Refund successfully executed and recorded");
      qc.invalidateQueries({ queryKey: ["admin-online-returns"] });
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
      qc.invalidateQueries({ queryKey: ["my-returns"] });
      qc.invalidateQueries({ queryKey: ["my-orders"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Refund execution failed");
    },
  });
}

export function useProcessOpenBoxDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      orderId: string;
      decision: "ACCEPTED" | "REJECTED";
      rejectionReason?: string;
      rejectionNotes?: string;
      idempotencyKey?: string;
    }) => {
      const { data, error } = await supabase.rpc("process_open_box_delivery", {
        _order_id: payload.orderId,
        _decision: payload.decision,
        _rejection_reason: payload.rejectionReason || "",
        _rejection_notes: payload.rejectionNotes || "",
        _idempotency_key: payload.idempotencyKey || `ob_${payload.orderId}_${Date.now()}`,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      if (variables.decision === "ACCEPTED") {
        toast.success("Open Box Delivery confirmed and accepted!");
      } else {
        toast.warning("Open Box Delivery rejected. Return initiated automatically.");
      }
      qc.invalidateQueries({ queryKey: ["my-orders"] });
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
      qc.invalidateQueries({ queryKey: ["admin-online-returns"] });
      qc.invalidateQueries({ queryKey: ["my-returns"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to process Open Box Delivery");
    },
  });
}

export function useCreateShiprocketReturnPickup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (returnId: string) => {
      const { data, error } = await supabase.functions.invoke("shiprocket-api", {
        body: {
          action: "create_return_shipment",
          returnId,
        },
      });

      if (error) throw error;
      if (data && data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success("Reverse pickup shipment scheduled in Shiprocket");
      qc.invalidateQueries({ queryKey: ["admin-online-returns"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Reverse pickup creation failed");
    },
  });
}
