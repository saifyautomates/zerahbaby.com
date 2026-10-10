import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { User } from "@supabase/gotrue-js";

export interface UserActiveSession {
  id: string;
  user_id: string;
  user_email: string;
  user_phone: string;
  user_role: "admin" | "customer";
  device_id: string;
  device_name: string;
  device_type: "mobile" | "tablet" | "desktop";
  browser: string;
  os: string;
  ip_address: string;
  city: string;
  region: string;
  country: string;
  is_revoked: boolean;
  last_active_at: string;
  created_at: string;
}

/**
 * Returns or generates a persistent unique hardware/device identifier for this browser instance.
 */
export function getDeviceId(): string {
  if (typeof window === "undefined") return "server-device-id";
  const KEY = "zerah_persistent_device_id";
  let id = localStorage.getItem(KEY);
  if (!id || id.length < 16) {
    id = "dev_" + crypto.randomUUID().replace(/-/g, "");
    localStorage.setItem(KEY, id);
  }
  return id;
}

/**
 * Parses userAgent to extract human-readable device name, browser, and OS.
 */
export function detectDeviceInfo(): {
  deviceName: string;
  deviceType: "mobile" | "tablet" | "desktop";
  browser: string;
  os: string;
} {
  if (typeof window === "undefined" || !navigator?.userAgent) {
    return {
      deviceName: "Unknown Device",
      deviceType: "desktop",
      browser: "Web Browser",
      os: "Web",
    };
  }

  const ua = navigator.userAgent;
  let deviceType: "mobile" | "tablet" | "desktop" = "desktop";
  let os = "Unknown OS";
  let browser = "Web Browser";
  let deviceName = "Computer";

  // 1. Detect OS & Device Type
  if (/iPad|Tablet/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
    deviceType = "tablet";
    os = "iPadOS";
    deviceName = "Apple iPad";
  } else if (/iPhone/i.test(ua)) {
    deviceType = "mobile";
    os = "iOS";
    deviceName = "Apple iPhone";
  } else if (/Android/i.test(ua)) {
    os = "Android";
    deviceType = /Mobile/i.test(ua) ? "mobile" : "tablet";
    // Try to extract Android model name
    const match = ua.match(/Android[^;]+;\s*([^;)]+)\)/i);
    if (match && match[1]) {
      const model = match[1].trim().replace(/^Build\/.*/, "").trim();
      if (model && !/wv|K/i.test(model)) {
        deviceName = model;
      } else {
        deviceName = "Android Phone";
      }
    } else {
      deviceName = "Android Phone";
    }
  } else if (/Windows/i.test(ua)) {
    os = "Windows";
    deviceName = "Windows PC / Laptop";
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    os = "macOS";
    deviceName = "MacBook / iMac";
  } else if (/Linux/i.test(ua)) {
    os = "Linux";
    deviceName = "Linux Device";
  }

  // 2. Detect Browser
  if (/Chrome/i.test(ua) && !/Edge|Edg|OPR|Opera/i.test(ua)) {
    browser = "Chrome";
  } else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) {
    browser = "Safari";
  } else if (/Edg/i.test(ua)) {
    browser = "Edge";
  } else if (/Firefox/i.test(ua)) {
    browser = "Firefox";
  } else if (/SamsungBrowser/i.test(ua)) {
    browser = "Samsung Internet";
  } else if (/Opera|OPR/i.test(ua)) {
    browser = "Opera";
  }

  return { deviceName, deviceType, browser, os };
}

/**
 * Fetches geolocation (city, region, country, IP) with in-memory caching.
 */
let cachedLocation: { city: string; region: string; country: string; ip: string } | null = null;
let locationPromise: Promise<{ city: string; region: string; country: string; ip: string }> | null = null;

export async function fetchDeviceLocation(): Promise<{
  city: string;
  region: string;
  country: string;
  ip: string;
}> {
  if (cachedLocation) return cachedLocation;
  if (typeof window === "undefined") {
    return { city: "Kota", region: "Rajasthan", country: "India", ip: "127.0.0.1" };
  }

  const stored = sessionStorage.getItem("zerah_geo_location");
  if (stored) {
    try {
      cachedLocation = JSON.parse(stored);
      if (cachedLocation?.ip) return cachedLocation;
    } catch {
      // ignore parse error
    }
  }

  if (locationPromise) return locationPromise;

  locationPromise = (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const res = await fetch("https://ipwho.is/", { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        const loc = {
          city: data.city || "Kota",
          region: data.region || "Rajasthan",
          country: data.country || "India",
          ip: data.ip || "127.0.0.1",
        };
        cachedLocation = loc;
        sessionStorage.setItem("zerah_geo_location", JSON.stringify(loc));
        return loc;
      }
    } catch {
      // ignore network errors
    }
    const fallback = { city: "Kota", region: "Rajasthan", country: "India", ip: "Unknown" };
    cachedLocation = fallback;
    return fallback;
  })();

  return locationPromise;
}

/**
 * Registers this device session with Supabase.
 */
export async function syncDeviceSession(user: User): Promise<void> {
  if (typeof window === "undefined" || !user?.id) return;

  try {
    const deviceId = getDeviceId();
    const { deviceName, deviceType, browser, os } = detectDeviceInfo();
    const location = await fetchDeviceLocation();

    // Direct RPC call to register or update device session
    const { data, error } = await supabase.rpc("register_device_session" as any, {
      _device_id: deviceId,
      _device_name: deviceName,
      _device_type: deviceType,
      _browser: browser,
      _os: os,
      _ip_address: location.ip,
      _city: location.city,
      _region: location.region,
      _country: location.country,
      _auth_session_id: null,
    });

    if (!error && (data as any)?.is_revoked) {
      handleRemoteRevocation();
    }
  } catch (err) {
    // Fail silently so auth is never blocked
    console.warn("[DeviceSession] Session sync failed:", err);
  }
}

/**
 * Handles instant client logout when the admin revokes this device.
 */
let isHandlingRevoke = false;
export async function handleRemoteRevocation(): Promise<void> {
  if (isHandlingRevoke || typeof window === "undefined") return;
  isHandlingRevoke = true;

  try {
    toast.error("Aapka session admin dwara logout kar diya gaya hai. Kripya punah OTP se sign in karein.", {
      duration: 6000,
    });

    // Sign out from Supabase
    await supabase.auth.signOut();

    // Clear local auth tokens
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith("sb-") || key.startsWith("zerah_is_admin_")) {
        localStorage.removeItem(key);
      }
    });

    // Redirect to login page
    setTimeout(() => {
      window.location.href = "/auth";
    }, 400);
  } catch {
    window.location.href = "/auth";
  }
}

/**
 * Heartbeat check: periodically checks if admin has revoked this device session.
 */
export async function verifyDeviceSessionActive(): Promise<boolean> {
  if (typeof window === "undefined") return true;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return true;

  try {
    const deviceId = getDeviceId();
    const { data, error } = await supabase.rpc("check_device_session_status" as any, {
      _device_id: deviceId,
    });

    if (!error && data && (data as any).is_revoked === true) {
      handleRemoteRevocation();
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

/**
 * Global session monitor: binds heartbeat check and real-time revocation listener.
 */
export function initGlobalDeviceSessionMonitor(): () => void {
  if (typeof window === "undefined") return () => {};

  const deviceId = getDeviceId();

  // 1. Periodic heartbeat (every 30 seconds)
  const interval = setInterval(() => {
    verifyDeviceSessionActive();
  }, 30_000);

  // 2. Immediate check when window regains focus or tab is made visible
  const handleVisibility = () => {
    if (document.visibilityState === "visible") {
      verifyDeviceSessionActive();
    }
  };
  document.addEventListener("visibilitychange", handleVisibility);

  // 3. Realtime Supabase Channel for sub-second revocation
  const channel = supabase
    .channel(`device-session-guard-${deviceId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "user_active_sessions",
        filter: `device_id=eq.${deviceId}`,
      },
      (payload) => {
        if (payload.new && (payload.new as any).is_revoked === true) {
          handleRemoteRevocation();
        }
      },
    )
    .subscribe();

  return () => {
    clearInterval(interval);
    document.removeEventListener("visibilitychange", handleVisibility);
    supabase.removeChannel(channel);
  };
}
