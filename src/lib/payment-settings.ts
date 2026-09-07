import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PaymentSettings {
  cod_enabled: boolean;
  cod_fee: number;
  cod_min_order_value: number | null;
  cod_max_order_value: number | null;
  updated_at?: string;
  updated_by?: string | null;
}

export const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  cod_enabled: false,
  cod_fee: 0,
  cod_min_order_value: null,
  cod_max_order_value: null,
};

/**
 * Authoritative fetch of payment settings via canonical RPC
 */
export async function getPaymentSettings(): Promise<PaymentSettings> {
  const { data, error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: PaymentSettings | null; error: { message: string } | null }>
  )("get_payment_settings");

  if (error) {
    console.error("[payment-settings] Error loading settings:", error);
    return DEFAULT_PAYMENT_SETTINGS;
  }

  if (!data) return DEFAULT_PAYMENT_SETTINGS;

  return {
    cod_enabled: Boolean(data.cod_enabled),
    cod_fee: Number(data.cod_fee || 0),
    cod_min_order_value: data.cod_min_order_value ? Number(data.cod_min_order_value) : null,
    cod_max_order_value: data.cod_max_order_value ? Number(data.cod_max_order_value) : null,
    updated_at: data.updated_at,
  };
}

/**
 * React Query hook to consume payment settings dynamically
 */
export function usePaymentSettings() {
  return useQuery({
    queryKey: ["payment-settings"],
    queryFn: getPaymentSettings,
    staleTime: 1000 * 30, // 30 seconds fresh cache
    refetchOnWindowFocus: true,
  });
}

/**
 * React Query mutation for admins to update payment settings
 */
export function useUpdatePaymentSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      cod_enabled: boolean;
      cod_fee?: number;
      cod_min_order_value?: number | null;
      cod_max_order_value?: number | null;
    }) => {
      const { data, error } = await (
        supabase.rpc as unknown as (
          fn: string,
          args?: Record<string, unknown>,
        ) => Promise<{
          data: { success: boolean; message?: string } | null;
          error: { message: string } | null;
        }>
      )("update_payment_settings", {
        _cod_enabled: params.cod_enabled,
        _cod_fee: params.cod_fee ?? 0,
        _cod_min_order_value: params.cod_min_order_value ?? null,
        _cod_max_order_value: params.cod_max_order_value ?? null,
      });

      if (error) {
        throw new Error(error.message || "Failed to update payment settings");
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payment-settings"] });
      queryClient.invalidateQueries({ queryKey: ["site_settings"] });
      queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
    },
  });
}
