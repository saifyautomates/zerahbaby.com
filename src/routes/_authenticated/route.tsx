//
import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    // During SSR, localStorage is not available on server; do not throw false redirect to /auth
    if (typeof window === "undefined") {
      return {};
    }
    // Test mode bypass for local E2E in-browser audits
    if (
      import.meta.env.DEV &&
      localStorage.getItem("zerah_test_admin") === "true"
    ) {
      return {
        user: {
          id: "00000000-0000-0000-0000-000000000001",
          email: "sameer@zerahkids.com",
          role: "authenticated",
          aud: "authenticated",
          app_metadata: {},
          user_metadata: { full_name: "Sameer" },
          created_at: new Date().toISOString(),
        } as any,
      };
    }
    let session = (await supabase.auth.getSession()).data.session;
    if (!session?.user) {
      const refreshed = await supabase.auth.refreshSession();
      session = refreshed.data.session;
    }
    if (!session?.user) {
      const searchStr =
        location.searchStr ||
        (typeof location.search === "string"
          ? location.search
          : typeof window !== "undefined"
            ? window.location.search
            : "");
      const targetUrl =
        location.pathname +
        (searchStr ? (searchStr.startsWith("?") ? searchStr : `?${searchStr}`) : "");
      throw redirect({
        to: "/auth",
        search: targetUrl && targetUrl !== "/" ? { redirect: targetUrl } : undefined,
      });
    }
    return { user: session.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user, loading } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      const redirectUrl =
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search
          : undefined;
      navigate({
        to: "/auth",
        search: redirectUrl && redirectUrl !== "/" ? { redirect: redirectUrl } : undefined,
        replace: true,
      });
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-10 space-y-6 animate-pulse">
        <div className="flex items-center justify-between border-b border-border/60 pb-6">
          <div className="space-y-2">
            <div className="h-7 w-40 rounded-xl bg-muted/60" />
            <div className="h-4 w-60 rounded-lg bg-muted/40" />
          </div>
          <div className="size-12 rounded-full bg-muted/60" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="h-36 rounded-3xl bg-muted/40 border border-border/40" />
          <div className="h-36 rounded-3xl bg-muted/40 border border-border/40" />
          <div className="h-36 rounded-3xl bg-muted/40 border border-border/40" />
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <Outlet />;
}
