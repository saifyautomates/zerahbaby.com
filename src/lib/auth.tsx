import { useEffect, useState, useMemo } from "react";
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
            if (typeof window !== "undefined") {
              Object.keys(localStorage).forEach((key) => {
                if (key.startsWith("zerah_is_admin_")) {
                  localStorage.removeItem(key);
                }
              });
            }
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

  const testAdminUser = useMemo(() => {
    if (
      import.meta.env.DEV &&
      typeof window !== "undefined" &&
      localStorage.getItem("zerah_test_admin") === "true"
    ) {
      return {
        id: "00000000-0000-0000-0000-000000000001",
        email: "sameer@zerahkids.com",
        role: "authenticated",
        aud: "authenticated",
        app_metadata: {},
        user_metadata: { full_name: "Sameer" },
        created_at: new Date().toISOString(),
      } as unknown as User;
    }
    return null;
  }, []);

  return {
    session,
    user: (testAdminUser || (session?.user ?? null)) as User | null,
    loading: testAdminUser ? false : loading,
  };
}

export function useIsAdmin(userId: string | undefined) {
  const cachedAdmin = useMemo(() => {
    if (typeof window === "undefined" || !userId) return undefined;
    if (
      import.meta.env.DEV &&
      localStorage.getItem("zerah_test_admin") === "true"
    ) {
      return true;
    }
    const val = localStorage.getItem(`zerah_is_admin_${userId}`);
    if (val === "true") return true;
    if (val === "false") return false;
    return undefined;
  }, [userId]);

  return useQuery({
    queryKey: ["is-admin", userId],
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    initialData: cachedAdmin,
    queryFn: async () => {
      if (!userId) return false;

      let isAdminRes = false;

      // 1. Try atomic check_is_admin RPC first
      try {
        const { data: rpcAdmin, error: rpcErr } = await (
          supabase.rpc as unknown as (
            fn: string,
          ) => Promise<{ data: boolean | null; error: unknown }>
        )("check_is_admin");
        if (!rpcErr && typeof rpcAdmin === "boolean") {
          isAdminRes = rpcAdmin;
        } else {
          // 2. Fallback: sync from allowlist + query user_roles table
          try {
            await supabase.rpc("sync_admin_from_allowlist");
          } catch {
            // Ignore sync errors
          }

          const { data, error } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", userId)
            .eq("role", "admin")
            .maybeSingle();

          isAdminRes = !error && Boolean(data);
        }
      } catch (err) {
        console.warn("[Auth] Error checking admin role:", err);
        isAdminRes = false;
      }

      if (typeof window !== "undefined" && userId) {
        localStorage.setItem(`zerah_is_admin_${userId}`, String(isAdminRes));
      }

      return isAdminRes;
    },
  });
}
