import { useEffect, useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session, User, AuthChangeEvent } from "@supabase/gotrue-js";
import { supabase } from "@/integrations/supabase/client";

let globalSession: Session | null = null;
let globalInitialized = false;
let globalInitPromise: Promise<Session | null> | null = null;
const authSubscribers = new Set<(session: Session | null, initialized: boolean) => void>();

function notifyAuthSubscribers(s: Session | null, init: boolean) {
  globalSession = s;
  globalInitialized = init;
  authSubscribers.forEach((cb) => {
    try {
      cb(s, init);
    } catch {
      // ignore subscriber errors
    }
  });
}

// Initialise auth singleton immediately in browser
if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((_event: AuthChangeEvent, newSession: Session | null) => {
    notifyAuthSubscribers(newSession, true);
  });

  globalInitPromise = supabase.auth
    .getSession()
    .then(({ data }: { data: { session: Session | null } }) => {
      const s = data.session ?? null;
      notifyAuthSubscribers(s, true);
      return s;
    })
    .catch(() => {
      notifyAuthSubscribers(null, true);
      return null;
    });
}

/**
 * Ensures that Supabase session hydration is completed before route guards make a decision.
 * Never redirects while auth is still loading.
 */
export async function ensureAuthSession(): Promise<Session | null> {
  if (typeof window === "undefined") return null;

  // Test mode bypass for local E2E in-browser audits
  if (import.meta.env.DEV && localStorage.getItem("zerah_test_admin") === "true") {
    return {
      user: {
        id: "00000000-0000-0000-0000-000000000001",
        email: "sameer@zerahkids.com",
        role: "authenticated",
        aud: "authenticated",
        app_metadata: {},
        user_metadata: { full_name: "Sameer" },
        created_at: new Date().toISOString(),
      },
    } as unknown as Session;
  }

  if (globalInitialized) {
    return globalSession;
  }

  if (globalInitPromise) {
    try {
      const s = await globalInitPromise;
      if (s?.user) return s;
    } catch {
      // fallback to subscription
    }
  }

  return new Promise<Session | null>((resolve) => {
    if (globalInitialized) {
      resolve(globalSession);
      return;
    }

    const handler = (s: Session | null, init: boolean) => {
      if (init) {
        authSubscribers.delete(handler);
        resolve(s);
      }
    };
    authSubscribers.add(handler);

    // Timeout safety fallback after 1.2s to prevent hanging
    setTimeout(() => {
      authSubscribers.delete(handler);
      resolve(globalSession);
    }, 1200);
  });
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(() => globalSession);
  const [loading, setLoading] = useState<boolean>(() => !globalInitialized);
  const queryClient = useQueryClient();

  useEffect(() => {
    const handler = (newSession: Session | null, init: boolean) => {
      setSession(newSession);
      if (init) setLoading(false);
    };

    authSubscribers.add(handler);

    // If already initialized on mount, sync immediately
    if (globalInitialized) {
      setSession(globalSession);
      setLoading(false);
    } else {
      ensureAuthSession().then((s) => {
        setSession(s);
        setLoading(false);
      });
    }

    const { data: sub } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, newSession: Session | null) => {
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

    return () => {
      authSubscribers.delete(handler);
      sub.subscription.unsubscribe();
    };
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
    if (import.meta.env.DEV && localStorage.getItem("zerah_test_admin") === "true") {
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
