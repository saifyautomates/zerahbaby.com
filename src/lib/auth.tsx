import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session, User, AuthChangeEvent } from "@supabase/gotrue-js";
import { supabase } from "@/integrations/supabase/client";

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, newSession: Session | null) => {
        setSession(newSession);
        setLoading(false);

        // Invalidate auth and role queries across the app on auth changes
        if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
          queryClient.invalidateQueries({ queryKey: ["is-admin"] });
          queryClient.invalidateQueries({ queryKey: ["profile"] });
          if (event === "SIGNED_OUT") {
            queryClient.clear();
          }
        }
      },
    );

    supabase.auth.getSession().then(({ data }: { data: { session?: Session } }) => {
      setSession(data.session ?? null);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  return { session, user: (session?.user ?? null) as User | null, loading };
}

export function useIsAdmin(userId: string | undefined) {
  return useQuery({
    queryKey: ["is-admin", userId],
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: async () => {
      if (!userId) return false;

      // 1. Try atomic check_is_admin RPC first
      try {
        const { data: rpcAdmin, error: rpcErr } = await (
          supabase.rpc as unknown as (
            fn: string,
          ) => Promise<{ data: boolean | null; error: unknown }>
        )("check_is_admin");
        if (!rpcErr && typeof rpcAdmin === "boolean") {
          return rpcAdmin;
        }
      } catch {
        // Fallback below if RPC is not yet deployed or fails
      }

      // 2. Fallback: sync from allowlist + query user_roles table
      try {
        await supabase.rpc("sync_admin_from_allowlist");
      } catch {
        // Ignore sync errors and continue to check user_roles
      }

      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();

      if (error) {
        console.warn("[Auth] Error checking admin role:", error);
        return false;
      }

      return Boolean(data);
    },
  });
}
