/**
 * ZÉRAH BABY & KIDS — Canonical Domain Models
 * Single Source of Truth for core business entities across the platform.
 */

/* ------------------------------------------------------------------ */
/* 1. Product & Variant Domain                                        */
/* ------------------------------------------------------------------ */

export interface ProductImage {
  id?: string;
  public_url: string;
  is_primary: boolean;
  sort_order: number;
  color?: string | null;
  alt_text?: string | null;
}

export interface ProductVariant {
  id: string;
  name: string;
  color?: string | null;
  size?: string | null;
  sku: string;
  barcode?: string | null;
  stock: number;
  priceOverride?: number;
  mrpOverride?: number;
  imageUrl?: string | null;
  conflictReconciliationNeeded?: boolean;
}

export interface Product {
  uuid: string;
  id: string; // URL slug & identifier
  name: string;
  brand: string;
  category: string;
  price: number;
  mrp: number;
  rating: number;
  reviews: number;
  ageGroup: string;
  image: string;
  imageUrl: string | null;
  description: string;
  highlights: string[];
  isFeatured: boolean;
  isActive: boolean;
  sortOrder: number;
  stock: number;
  lowStockAt: number;
  sku: string;
  barcode: string;
  images: string[];
  product_images?: ProductImage[];
  buyingPrice?: number;
  deliveryFee?: number;
  recommendationMode?: "manual" | "auto" | "manual_fallback";
  salesChannel: "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY";
  sales_channel: "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY";
  variants: ProductVariant[];
}

export interface Category {
  uuid: string;
  slug: string;
  name: string;
  tagline: string;
  image: string;
  imageUrl: string | null;
  sortOrder: number;
}

/* ------------------------------------------------------------------ */
/* 2. Cart & Pricing Domain                                           */
/* ------------------------------------------------------------------ */

export interface CartLine {
  id: string;
  qty: number;
  variantId?: string;
}

export interface CartItem {
  product: Product;
  qty: number;
  variantId?: string;
  variant?: ProductVariant | null;
  price: number;
  mrp: number;
  stock: number;
  color?: string | null;
  size?: string | null;
  image: string;
  sku?: string;
}

export interface CartCoupon {
  code: string;
  id: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  minimumOrderValue: number;
  maximumDiscount: number;
  discount: number;
}

export interface CouponRule {
  code: string;
  id?: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  minimumOrderValue?: number;
  maximumDiscount?: number;
}

export interface ShippingConfig {
  freeDeliveryEnabled?: boolean;
  freeDeliveryThreshold?: number;
  standardShippingCharge?: number;
  freeDeliveryMessage?: string;
}

export interface CartFinancialsBreakdown {
  subtotal: number;
  baseProductSavings: number;
  couponDiscount: number;
  netSubtotal: number;
  shipping: number;
  isFreeDelivery: boolean;
  amountToFreeDelivery: number;
  freeDeliveryMessage: string | null;
  finalTotal: number;
}

/* ------------------------------------------------------------------ */
/* 3. Checkout & Payment Domain                                       */
/* ------------------------------------------------------------------ */

export interface CheckoutCustomerInfo {
  full_name: string;
  email: string;
  phone: string;
  address: string;
  address_line2?: string;
  city: string;
  state: string;
  pincode: string;
  landmark?: string;
  alt_phone?: string;
}

export interface CheckoutSession {
  id: string;
  user_id?: string | null;
  status: "active" | "finalized" | "abandoned" | "expired";
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  coupon_code?: string | null;
  items: Array<{
    product_id: string;
    variant_id?: string | null;
    quantity: number;
    unit_price: number;
    mrp: number;
    sku?: string;
  }>;
  created_at: string;
  expires_at?: string;
}

export interface PaymentAttempt {
  id: string;
  checkout_session_id: string;
  razorpay_order_id?: string | null;
  razorpay_payment_id?: string | null;
  amount: number;
  currency: string;
  status: "created" | "authorized" | "captured" | "failed" | "verification_failed" | "cancelled";
  created_at: string;
}

/* ------------------------------------------------------------------ */
/* 4. Orders & Fulfillment Domain                                     */
/* ------------------------------------------------------------------ */

export type OrderStatus =
  | "placed"
  | "pending"
  | "confirmed"
  | "processing"
  | "packed"
  | "shipped"
  | "out_for_delivery"
  | "open_box_inspection"
  | "open_box_accepted"
  | "open_box_rejected"
  | "delivered"
  | "return_in_transit"
  | "return_received"
  | "refund_processing"
  | "cancelled"
  | "returned";

export type PaymentStatus = "pending" | "paid" | "failed" | "refunded" | "partially_refunded";

export interface OrderItem {
  id: string;
  order_id?: string;
  product_id?: string;
  product_slug: string;
  variant_id?: string | null;
  name: string;
  product_name_snapshot?: string | null;
  image_url: string | null;
  image_url_snapshot?: string | null;
  sku_snapshot?: string | null;
  barcode_snapshot?: string | null;
  color?: string | null;
  color_snapshot?: string | null;
  size?: string | null;
  size_snapshot?: string | null;
  pack?: string | null;
  pack_snapshot?: string | null;
  price: number;
  price_at_time?: number;
  mrp?: number | null;
  qty: number;
  quantity?: number;
  subtotal?: number;
  buying_price?: number;
}

export interface Order {
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
  order_number?: string | null;
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
  razorpay_payment_id?: string | null;
  razorpay_refund_id?: string | null;
  razorpay_refund_status?: string | null;
  refund_amount?: number | null;
  refund_notes?: string | null;
  refund_completed_at?: string | null;
  customer_notification_status?: string | null;
  customer_notified_at?: string | null;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* 5. Returns, Refunds & Store Credit                                 */
/* ------------------------------------------------------------------ */

export type ReturnStatus =
  | "requested"
  | "approved"
  | "pickup_scheduled"
  | "in_transit"
  | "received"
  | "qc_passed"
  | "qc_failed"
  | "refund_initiated"
  | "refund_completed"
  | "rejected"
  | "cancelled";

export interface OnlineReturnRecord {
  id: string;
  return_number: string;
  order_id: string;
  user_id: string;
  order_item_id: string;
  product_id: string;
  variant_id?: string | null;
  product_name: string;
  product_image?: string | null;
  sku?: string | null;
  quantity: number;
  unit_price: number;
  refund_amount: number;
  refund_method: "original_payment" | "store_credit";
  status: ReturnStatus;
  reason: string;
  customer_comments?: string | null;
  admin_notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface POSReturnRecord {
  id: string;
  return_number: string;
  sale_id: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  cashier_name?: string | null;
  total_refund: number;
  reason?: string | null;
  notes?: string | null;
  created_at: string;
  items: Array<{
    id: string;
    product_id: string;
    variant_id?: string | null;
    product_name: string;
    sku?: string | null;
    quantity: number;
    refund_amount: number;
    restock: boolean;
  }>;
}

export interface StoreCreditVoucher {
  id: string;
  code: string;
  customer_id?: string | null;
  customer_phone?: string | null;
  initial_amount: number;
  balance_amount: number;
  is_active: boolean;
  expires_at?: string | null;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/* 6. Customer & Admin Roles                                          */
/* ------------------------------------------------------------------ */

export type AppRole = "admin" | "owner" | "manager" | "staff" | "customer";

export interface CustomerProfile {
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
}
