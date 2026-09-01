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
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <Outlet />;
}
