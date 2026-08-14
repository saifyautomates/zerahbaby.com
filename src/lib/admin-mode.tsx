import { useCallback, useEffect, useState } from "react";
import { useIsAdmin, useSession } from "@/lib/auth";

const KEY = "zerah-admin-mode";
const EVENT = "zerah-admin-mode-change";

function read() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(KEY) === "on";
}

/**
 * Admin mode: only real admins can enable it, and site-wide editing access is
 * only granted once the toggle is on.
 */
export function useAdminMode() {
  const { user, loading } = useSession();
  const { data: isAdmin, isLoading: roleLoading } = useIsAdmin(user?.id);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const sync = () => setEnabled(read());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setMode = useCallback((next: boolean) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(KEY, next ? "on" : "off");
    window.dispatchEvent(new Event(EVENT));
  }, []);

  const admin = Boolean(isAdmin);

  return {
    isAdmin: admin,
    loading: loading || (Boolean(user) && roleLoading),
    adminMode: admin && enabled,
    setAdminMode: setMode,
    toggleAdminMode: () => setMode(!enabled),
  };
}
