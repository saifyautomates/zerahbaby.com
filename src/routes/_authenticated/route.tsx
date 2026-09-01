//
import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    let session = (await supabase.auth.getSession()).data.session;
    if (!session?.user) {
      const refreshed = await supabase.auth.refreshSession();
      session = refreshed.data.session;
    }
    if (!session?.user) {
      throw redirect({ to: "/auth" });
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
      navigate({ to: "/auth", replace: true });
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
