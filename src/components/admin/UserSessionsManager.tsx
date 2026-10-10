import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  type UserActiveSession,
  getDeviceId,
} from "@/lib/device-session";
import { toast } from "sonner";
import {
  Smartphone,
  Laptop,
  Tablet,
  MapPin,
  Clock,
  Shield,
  Trash2,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertCircle,
  Users,
  LogOut,
  Globe,
  Wifi,
} from "lucide-react";

interface UserSessionsManagerProps {
  defaultRole?: "admin" | "customer";
  targetUserId?: string;
  targetUserEmail?: string;
  hideRoleToggle?: boolean;
}

export function UserSessionsManager({
  defaultRole = "admin",
  targetUserId,
  targetUserEmail,
  hideRoleToggle = false,
}: UserSessionsManagerProps) {
  const qc = useQueryClient();
  const currentDeviceId = getDeviceId();
  const [selectedRole, setSelectedRole] = useState<"admin" | "customer">(defaultRole);
  const [searchTerm, setSearchTerm] = useState("");
  const [sessionToRevoke, setSessionToRevoke] = useState<UserActiveSession | null>(null);

  // Fetch active sessions from database via RPC
  const { data: sessions = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ["user-device-sessions", selectedRole, targetUserId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_user_device_sessions" as any, {
        _target_role: hideRoleToggle && targetUserId ? null : selectedRole,
        _target_user_id: targetUserId || null,
      });
      if (error) throw error;
      return (data || []) as UserActiveSession[];
    },
    refetchInterval: 15_000, // Live poll every 15s
  });

  // Revoke single device session mutation
  const revokeSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const { data, error } = await supabase.rpc("revoke_device_session" as any, {
        _session_id: sessionId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Device ko safaltapoorvak logout kar diya gaya hai. Ab unhe login ke liye OTP verify karna hoga.");
      qc.invalidateQueries({ queryKey: ["user-device-sessions"] });
      setSessionToRevoke(null);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to log out device");
    },
  });

  // Revoke all devices for a user mutation
  const revokeAllMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { data, error } = await supabase.rpc("revoke_all_user_device_sessions" as any, {
        _target_user_id: userId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Sabhi devices se logout kar diya gaya hai!");
      qc.invalidateQueries({ queryKey: ["user-device-sessions"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to log out all devices");
    },
  });

  // Filtered sessions
  const filteredSessions = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return sessions.filter((s) => {
      if (targetUserEmail && s.user_email?.toLowerCase() !== targetUserEmail.toLowerCase()) {
        return false;
      }
      if (!q) return true;
      return (
        s.user_email?.toLowerCase().includes(q) ||
        s.user_phone?.toLowerCase().includes(q) ||
        s.device_name?.toLowerCase().includes(q) ||
        s.city?.toLowerCase().includes(q) ||
        s.region?.toLowerCase().includes(q) ||
        s.ip_address?.toLowerCase().includes(q) ||
        s.browser?.toLowerCase().includes(q) ||
        s.os?.toLowerCase().includes(q)
      );
    });
  }, [sessions, searchTerm, targetUserEmail]);

  // Group sessions by user email for clean UI
  const groupedByUser = useMemo(() => {
    const map = new Map<string, { email: string; phone: string; userId: string; role: string; sessions: UserActiveSession[] }>();
    for (const s of filteredSessions) {
      const key = s.user_email || s.user_id;
      if (!map.has(key)) {
        map.set(key, {
          email: s.user_email || "User without email",
          phone: s.user_phone || "",
          userId: s.user_id,
          role: s.user_role,
          sessions: [],
        });
      }
      map.get(key)!.sessions.push(s);
    }
    return Array.from(map.values());
  }, [filteredSessions]);

  const getDeviceIcon = (type: string) => {
    if (type === "mobile") return <Smartphone className="size-4.5 text-primary" />;
    if (type === "tablet") return <Tablet className="size-4.5 text-indigo-500" />;
    return <Laptop className="size-4.5 text-blue-500" />;
  };

  const formatTimeAgo = (dateStr: string) => {
    try {
      const diffSec = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
      if (diffSec < 60) return "Active right now";
      if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
      if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
      return `${Math.floor(diffSec / 86400)}d ago`;
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Header & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-card p-4 rounded-2xl border border-border shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
            <Shield className="size-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <span>Active Logged-in Devices &amp; Locations</span>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                {sessions.filter((s) => !s.is_revoked).length} active
              </span>
            </h3>
            <p className="text-xs text-muted-foreground">
              Monitor which phones, laptops, and cities admins and customers are logged in from, and revoke any session.
            </p>
          </div>
        </div>

        {/* Action controls */}
        <div className="flex items-center gap-2">
          {!hideRoleToggle && (
            <div className="flex items-center p-1 bg-muted/60 rounded-xl border border-border text-xs font-semibold">
              <button
                type="button"
                onClick={() => setSelectedRole("admin")}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  selectedRole === "admin"
                    ? "bg-card text-foreground font-bold shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Admins
              </button>
              <button
                type="button"
                onClick={() => setSelectedRole("customer")}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  selectedRole === "customer"
                    ? "bg-card text-foreground font-bold shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Customers
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-2 rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
            title="Refresh active sessions"
          >
            <RefreshCw className={`size-4 ${isFetching ? "animate-spin text-primary" : ""}`} />
          </button>
        </div>
      </div>

      {/* Search Filter */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Filter by email, phone, device name (e.g. iPhone), city (e.g. Kota), or IP…"
          className="w-full h-10 rounded-xl border border-border bg-card pl-10 pr-4 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 shadow-2xs"
        />
      </div>

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="p-8 text-center text-muted-foreground animate-pulse text-xs font-medium bg-card rounded-2xl border border-border">
          Loading logged-in device sessions…
        </div>
      )}

      {/* Empty State */}
      {!isLoading && groupedByUser.length === 0 && (
        <div className="p-8 text-center text-muted-foreground bg-card rounded-2xl border border-border space-y-2">
          <Smartphone className="size-8 mx-auto opacity-30" />
          <p className="text-xs font-semibold text-foreground">No active sessions found</p>
          <p className="text-[11px] text-muted-foreground">
            {searchTerm ? "No devices match your search filter." : "No logged-in devices currently recorded."}
          </p>
        </div>
      )}

      {/* List Grouped by User */}
      {!isLoading && groupedByUser.length > 0 && (
        <div className="space-y-4">
          {groupedByUser.map((group) => {
            const activeSessions = group.sessions.filter((s) => !s.is_revoked);
            if (activeSessions.length === 0) return null;

            return (
              <div
                key={group.userId}
                className="bg-card rounded-2xl border border-border shadow-2xs overflow-hidden"
              >
                {/* User Header */}
                <div className="flex flex-wrap items-center justify-between p-3.5 sm:p-4 bg-muted/30 border-b border-border/70 gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="size-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center font-bold text-xs text-primary">
                      {group.email.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs sm:text-sm font-bold text-foreground">
                          {group.email}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.2 rounded-full border ${
                            group.role === "admin"
                              ? "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30"
                              : "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30"
                          }`}
                        >
                          {group.role === "admin" ? "Administrator" : "Customer"}
                        </span>
                      </div>
                      {group.phone && (
                        <p className="text-[11px] text-muted-foreground font-medium">
                          Phone: {group.phone}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Actions for this user */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {activeSessions.length} device{activeSessions.length > 1 ? "s" : ""}
                    </span>
                    {activeSessions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Are you sure you want to log out all ${activeSessions.length} devices for ${group.email}? They will have to log in with OTP again.`
                            )
                          ) {
                            revokeAllMutation.mutate(group.userId);
                          }
                        }}
                        disabled={revokeAllMutation.isPending}
                        className="px-3 py-1.5 rounded-xl border border-rose-300 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-xs font-bold transition cursor-pointer flex items-center gap-1.5"
                      >
                        <LogOut className="size-3" />
                        <span>Log Out All Devices</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Device Sessions List */}
                <div className="divide-y divide-border/60">
                  {activeSessions.map((session) => {
                    const isCurrentDevice = session.device_id === currentDeviceId;
                    const isRecent =
                      Math.floor((Date.now() - new Date(session.last_active_at).getTime()) / 1000) < 180;

                    return (
                      <div
                        key={session.id}
                        className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-muted/10 transition"
                      >
                        {/* Device Info */}
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="mt-0.5 size-9 rounded-xl bg-muted/60 border border-border flex items-center justify-center shrink-0">
                            {getDeviceIcon(session.device_type)}
                          </div>
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs sm:text-sm font-bold text-foreground">
                                {session.device_name || "Device"}
                              </span>
                              {isCurrentDevice && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.2 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                                  <CheckCircle2 className="size-3" /> This Device
                                </span>
                              )}
                              {isRecent && !isCurrentDevice && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.2 rounded-full bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30 text-[10px] font-bold">
                                  <span className="size-1.5 rounded-full bg-blue-500 animate-ping" />
                                  Active Now
                                </span>
                              )}
                            </div>

                            {/* Location & IP Details */}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <MapPin className="size-3 text-rose-500" />
                                <strong className="text-foreground font-semibold">
                                  {[session.city, session.region, session.country].filter(Boolean).join(", ") || "Unknown Location"}
                                </strong>
                              </span>

                              {session.ip_address && (
                                <span className="flex items-center gap-1 font-mono text-[11px]">
                                  <Wifi className="size-3 opacity-60" />
                                  {session.ip_address}
                                </span>
                              )}

                              {(session.browser || session.os) && (
                                <span className="flex items-center gap-1">
                                  <Globe className="size-3 opacity-60" />
                                  {[session.browser, session.os].filter(Boolean).join(" • ")}
                                </span>
                              )}
                            </div>

                            {/* Last Active Timestamp */}
                            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                              <Clock className="size-3 opacity-60" />
                              <span>Last active: {formatTimeAgo(session.last_active_at)}</span>
                            </p>
                          </div>
                        </div>

                        {/* Action: Log Out This Device */}
                        <div className="flex items-center justify-end shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Log out "${session.device_name}" (${session.city || "Location"})? This device will be signed out immediately and will require OTP to log in again.`
                                )
                              ) {
                                revokeSessionMutation.mutate(session.id);
                              }
                            }}
                            disabled={revokeSessionMutation.isPending}
                            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground text-xs font-bold transition-all cursor-pointer shadow-2xs active:scale-95"
                            title="Remotely terminate this device session"
                          >
                            <Trash2 className="size-3.5" />
                            <span>Log Out Device</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
