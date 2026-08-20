// @ts-nocheck
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  invoice_no: string | null;
  subtotal: number;
  shipping: number;
  discount: number;
  coupon_code: string | null;
  total: number;
  status: string;
  notes: string;
  created_at: string;
  order_items: OrderItem[];
};

export const orderStatuses = ["placed", "confirmed", "packed", "shipped", "delivered", "cancelled"];

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
      const discount = input.discount ?? 0;
      const total = input.subtotal + input.shipping - discount;

      const { data, error } = await supabase
        .from("orders")
        .insert({
          user_id: input.userId,
          email: input.email,
          full_name: input.full_name,
          phone: input.phone,
          address: input.address,
          address_line2: input.address_line2,
          city: input.city,
          state: input.state,
          pincode: input.pincode,
          landmark: input.landmark,
          alt_phone: input.alt_phone,
          payment_method: input.payment_method,
          notes: input.notes,
          subtotal: input.subtotal,
          shipping: input.shipping,
          discount,
          coupon_code: input.coupon_code ?? null,
          total,
          status: "placed",
        })
        .select("id, invoice_no")
        .single();
      if (error) throw error;

      const { error: itemsError } = await supabase
        .from("order_items")
        .insert(input.items.map((item) => ({ ...item, order_id: data.id })));
      if (itemsError) throw itemsError;

      // Update inventory (deduct stock)
      for (const item of input.items) {
        const { data: product } = await supabase
          .from("products")
          .select("id, stock")
          .eq("slug", item.product_slug)
          .maybeSingle();

        if (product) {
          const newStock = Math.max(0, (product.stock || 0) - item.qty);
          await supabase.from("products").update({ stock: newStock }).eq("id", product.id);
        }
      }

      return data.id as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-orders"] });
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
    },
  });
}
