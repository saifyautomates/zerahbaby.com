import { createFileRoute, redirect } from "@tanstack/react-router";
import { ensureAdminSession } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/admin/$")({
  beforeLoad: async ({ params, search, location }) => {
    // SSR guard
    if (typeof window === "undefined") {
      return {};
    }

    const { user, isAdmin } = await ensureAdminSession();

    if (!user) {
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
        search:
          targetUrl && targetUrl !== "/" && !targetUrl.startsWith("/auth")
            ? { redirect: targetUrl }
            : undefined,
      });
    }

    if (!isAdmin) {
      throw redirect({
        to: "/",
        search: { unauthorized: "admin_required" },
      });
    }

    const splat = params._splat || "";
    const parts = splat.split("/").filter(Boolean);
    const sub = parts[0]?.toLowerCase();

    if (parts.length === 0 || !sub) {
      if (location.pathname === "/admin") {
        return;
      }
      const searchParams = (search || {}) as Record<string, unknown>;
      throw redirect({
        to: "/admin",
        search: searchParams,
        replace: true,
      });
    }
    let targetTab = "dashboard";
    let subTab: string | undefined = undefined;

    if (sub === "orders") {
      targetTab = "orders";
    } else if (sub === "returns") {
      targetTab = "returns";
    } else if (sub === "products" || sub === "inventory") {
      targetTab = "products";
    } else if (sub === "billing" || sub === "pos") {
      targetTab = "billing";
      if (parts[1]?.toLowerCase() === "returns") {
        subTab = "returns";
      }
    } else if (sub === "media") {
      targetTab = "media";
    } else if (sub === "analytics") {
      targetTab = "dashboard";
    } else if (sub === "categories") {
      targetTab = "categories";
    } else if (sub === "customers") {
      targetTab = "customers";
    } else if (sub === "coupons") {
      targetTab = "coupons";
    } else if (sub === "reviews") {
      targetTab = "reviews";
    } else if (sub === "hero") {
      targetTab = "hero";
    } else if (sub === "sms") {
      targetTab = "sms";
    } else if (sub === "queries") {
      targetTab = "queries";
    } else if (sub === "settings") {
      targetTab = "settings";
    } else if (sub === "admins") {
      targetTab = "admins";
    } else if (sub === "marketing") {
      targetTab = "marketing";
    } else if (sub === "pages") {
      targetTab = "pages";
    }

    if (subTab && typeof window !== "undefined") {
      localStorage.setItem("zerah_admin_active_subtab", subTab);
    }

    const searchParams = (search || {}) as Record<string, unknown>;

    throw redirect({
      to: "/admin",
      search: {
        ...searchParams,
        tab: targetTab,
      },
      replace: true,
    });
  },
  component: () => null,
});
