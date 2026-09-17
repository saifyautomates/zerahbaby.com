import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Truck,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  RefreshCw,
  Warehouse,
  ShieldCheck,
  Lock,
  Eye,
  EyeOff,
  Zap,
  Code2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  useTestShiprocketConnection,
  useGetShiprocketPickupLocations,
  useTestRazorpayConnection,
} from "@/lib/orders";

export function ShiprocketRazorpayIntegrationsCard() {
  const testShiprocket = useTestShiprocketConnection();
  const testRazorpay = useTestRazorpayConnection();
  const { data: pickupData, refetch: refetchPickups, isLoading: loadingPickups } =
    useGetShiprocketPickupLocations();

  // Shiprocket form state
  const [srEmail, setSrEmail] = useState("");
  const [srPassword, setSrPassword] = useState("");
  const [srPickupLoc, setSrPickupLoc] = useState("");
  const [srWebhookSecret, setSrWebhookSecret] = useState("");
  const [showSrPassword, setShowSrPassword] = useState(false);
  const [savingSr, setSavingSr] = useState(false);

  // Razorpay form state
  const [rzpKeyId, setRzpKeyId] = useState("");
  const [rzpKeySecret, setRzpKeySecret] = useState("");
  const [rzpWebhookSecret, setRzpWebhookSecret] = useState("");
  const [showRzpSecret, setShowRzpSecret] = useState(false);
  const [savingRzp, setSavingRzp] = useState(false);

  // Diagnostic states
  const [srTestResult, setSrTestResult] = useState<{
    success: boolean;
    message: string;
    pickup_location?: string;
    company?: string;
  } | null>(null);

  const [rzpTestResult, setRzpTestResult] = useState<{
    success: boolean;
    message: string;
    key_id?: string;
    mode?: string;
  } | null>(null);

  const [copiedWebhook, setCopiedWebhook] = useState<string | null>(null);

  // Webhook Endpoints
  const supabaseUrl =
    (typeof window !== "undefined" && (window as any).SUPABASE_URL) ||
    import.meta.env.VITE_SUPABASE_URL ||
    "https://jprnxdjocuawzndeyewt.supabase.co";

  const shiprocketWebhookUrl = `${supabaseUrl}/functions/v1/shiprocket-webhook`;
  const razorpayWebhookUrl = `${supabaseUrl}/functions/v1/razorpay-webhook`;

  // Load existing credentials from site_settings
  useEffect(() => {
    async function loadSettings() {
      try {
        const { data: settings } = await supabase
          .from("site_settings")
          .select("key, value")
          .in("key", [
            "shiprocket_email",
            "shiprocket_password",
            "shiprocket_pickup_location",
            "shiprocket_webhook_secret",
            "razorpay_key_id",
            "razorpay_key_secret",
            "razorpay_webhook_secret",
          ]);

        if (settings) {
          settings.forEach((s) => {
            const val = typeof s.value === "string" ? s.value : "";
            if (s.key === "shiprocket_email") setSrEmail(val);
            if (s.key === "shiprocket_password") setSrPassword(val);
            if (s.key === "shiprocket_pickup_location") setSrPickupLoc(val);
            if (s.key === "shiprocket_webhook_secret") setSrWebhookSecret(val);
            if (s.key === "razorpay_key_id") setRzpKeyId(val);
            if (s.key === "razorpay_key_secret") setRzpKeySecret(val);
            if (s.key === "razorpay_webhook_secret") setRzpWebhookSecret(val);
          });
        }
      } catch (err) {
        console.warn("Failed to load integration settings:", err);
      }
    }
    loadSettings();
  }, []);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedWebhook(id);
    toast.success("URL copied to clipboard!");
    setTimeout(() => setCopiedWebhook(null), 2500);
  };

  const handleTestShiprocket = async () => {
    setSrTestResult(null);
    try {
      const res = await testShiprocket.mutateAsync();
      setSrTestResult(res);
      toast.success(res.message || "Shiprocket connected successfully!");
      refetchPickups();
    } catch (err: unknown) {
      const msg = (err as Error).message || "Shiprocket connection failed";
      setSrTestResult({ success: false, message: msg });
      toast.error(`Shiprocket error: ${msg}`);
    }
  };

  const handleTestRazorpay = async () => {
    setRzpTestResult(null);
    try {
      const res = await testRazorpay.mutateAsync();
      setRzpTestResult(res);
      toast.success(res.message || "Razorpay connected successfully!");
    } catch (err: unknown) {
      const msg = (err as Error).message || "Razorpay connection failed";
      setRzpTestResult({ success: false, message: msg });
      toast.error(`Razorpay error: ${msg}`);
    }
  };

  const handleSaveShiprocket = async () => {
    setSavingSr(true);
    try {
      const updates = [
        { key: "shiprocket_email", value: srEmail.trim() },
        { key: "shiprocket_password", value: srPassword.trim() },
        { key: "shiprocket_pickup_location", value: srPickupLoc.trim() },
        { key: "shiprocket_webhook_secret", value: srWebhookSecret.trim() },
      ];

      for (const item of updates) {
        if (item.value) {
          await supabase.from("site_settings").upsert(item, { onConflict: "key" });
        }
      }

      toast.success("Shiprocket credentials & pickup warehouse saved successfully!");
      handleTestShiprocket();
    } catch (err: unknown) {
      toast.error(`Failed to save Shiprocket settings: ${(err as Error).message}`);
    } finally {
      setSavingSr(false);
    }
  };

  const handleSaveRazorpay = async () => {
    setSavingRzp(true);
    try {
      const updates = [
        { key: "razorpay_key_id", value: rzpKeyId.trim() },
        { key: "razorpay_key_secret", value: rzpKeySecret.trim() },
        { key: "razorpay_webhook_secret", value: rzpWebhookSecret.trim() },
      ];

      for (const item of updates) {
        if (item.value) {
          await supabase.from("site_settings").upsert(item, { onConflict: "key" });
        }
      }

      toast.success("Razorpay credentials saved successfully!");
      handleTestRazorpay();
    } catch (err: unknown) {
      toast.error(`Failed to save Razorpay settings: ${(err as Error).message}`);
    } finally {
      setSavingRzp(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* ─── SECTION 1: SHIPROCKET LOGISTICS HUB ──────────────────────── */}
      <div className="rounded-3xl border border-border bg-card p-6 shadow-sm space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0 border border-indigo-500/20">
              <Truck className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display text-lg font-bold text-foreground">
                  Shiprocket Logistics Engine
                </h3>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  AUTOMATIC DISPATCH
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Orders (Prepaid &amp; COD) automatically sync hote hain. Courier selection, AWB, labels
                aur real-time tracking direct website ke Admin Panel se operate hota hai.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleTestShiprocket}
            disabled={testShiprocket.isPending}
            className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-2 text-xs font-bold transition shadow-xs disabled:opacity-50 cursor-pointer shrink-0"
          >
            <RefreshCw
              className={`size-3.5 ${testShiprocket.isPending ? "animate-spin" : ""}`}
            />
            <span>{testShiprocket.isPending ? "Testing Connection…" : "Test Shiprocket Connection"}</span>
          </button>
        </div>

        {/* Live Test Status Feedback */}
        {srTestResult && (
          <div
            className={`rounded-2xl border p-4 text-xs flex items-start gap-3 transition-all ${
              srTestResult.success
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300"
                : "bg-destructive/10 border-destructive/30 text-destructive"
            }`}
          >
            {srTestResult.success ? (
              <CheckCircle2 className="size-5 shrink-0 text-emerald-600 mt-0.5" />
            ) : (
              <AlertCircle className="size-5 shrink-0 text-destructive mt-0.5" />
            )}
            <div className="space-y-1">
              <p className="font-bold">{srTestResult.message}</p>
              {srTestResult.pickup_location && (
                <p className="text-[11px] opacity-90">
                  Active Warehouse Pickup Location:{" "}
                  <strong>{srTestResult.pickup_location}</strong>
                </p>
              )}
              {srTestResult.company && (
                <p className="text-[11px] opacity-90">
                  Shiprocket Merchant: <strong>{srTestResult.company}</strong>
                </p>
              )}
            </div>
          </div>
        )}

        {/* Available Pickup Locations from Shiprocket */}
        <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-2">
              <Warehouse className="size-4 text-indigo-600" />
              <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                Primary Warehouse Pickup Location
              </span>
            </div>
            {pickupData?.active_pickup_location && (
              <span className="text-xs font-semibold text-muted-foreground">
                Active in Store:{" "}
                <strong className="text-foreground">{pickupData.active_pickup_location}</strong>
              </span>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground">
            Courier pickups are scheduled from this registered Shiprocket address.
          </p>

          {loadingPickups ? (
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <RefreshCw className="size-3 animate-spin" />
              Loading pickup addresses from Shiprocket…
            </div>
          ) : pickupData?.pickup_locations && pickupData.pickup_locations.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2 pt-1">
              {pickupData.pickup_locations.map((loc: any, idx: number) => {
                const name = loc.pickup_location || loc.pickup_code || loc.name || `Location ${idx + 1}`;
                const isSelected =
                  srPickupLoc === name ||
                  (!srPickupLoc && pickupData.active_pickup_location === name);
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSrPickupLoc(name)}
                    className={`text-left rounded-xl border p-3 transition cursor-pointer ${
                      isSelected
                        ? "border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-900 dark:text-indigo-200"
                        : "border-border bg-card hover:bg-muted/40 text-foreground"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs">{name}</span>
                      {isSelected && <Check className="size-4 text-indigo-600" />}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1 truncate">
                      {loc.address || ""}, {loc.city || ""}, {loc.pin_code || loc.pincode || ""}
                    </p>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              Click &apos;Test Shiprocket Connection&apos; to load registered warehouses. Default
              fallback: <strong>Kota Central Warehouse (324001)</strong>.
            </div>
          )}
        </div>

        {/* Shiprocket Credentials Inputs */}
        <div className="space-y-4 pt-2 border-t border-border/60">
          <h4 className="font-bold text-sm text-foreground">Shiprocket Account Credentials</h4>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground">
                Shiprocket Account Email
              </label>
              <input
                type="email"
                value={srEmail}
                onChange={(e) => setSrEmail(e.target.value)}
                placeholder="e.g. logistics@zerahkids.com"
                className="w-full rounded-xl border border-border bg-background px-3.5 py-2 text-sm outline-none transition focus:border-indigo-600 shadow-2xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground">
                Shiprocket Account Password
              </label>
              <div className="relative">
                <input
                  type={showSrPassword ? "text" : "password"}
                  value={srPassword}
                  onChange={(e) => setSrPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2 pr-10 text-sm outline-none transition focus:border-indigo-600 shadow-2xs"
                />
                <button
                  type="button"
                  onClick={() => setShowSrPassword(!showSrPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  {showSrPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground">
                Pickup Location Name
              </label>
              <input
                type="text"
                value={srPickupLoc}
                onChange={(e) => setSrPickupLoc(e.target.value)}
                placeholder="e.g. Primary or Kota Warehouse"
                className="w-full rounded-xl border border-border bg-background px-3.5 py-2 text-sm outline-none transition focus:border-indigo-600 shadow-2xs"
              />
            </div>
          </div>

          {/* Collapsible Developer/Webhook Section (Hidden from default view) */}
          <details className="group rounded-2xl border border-border/60 bg-muted/15 p-3.5 transition">
            <summary className="flex items-center justify-between text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer select-none">
              <span className="flex items-center gap-2">
                <Code2 className="size-3.5 text-muted-foreground" />
                <span>Developer Settings (Webhook &amp; Secrets)</span>
              </span>
              <span className="text-[10px] text-muted-foreground transition-transform group-open:rotate-180">
                ▼
              </span>
            </summary>
            <div className="pt-3 space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Shiprocket Webhook URL
                  </span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(shiprocketWebhookUrl, "sr-webhook")}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-700 transition cursor-pointer"
                  >
                    {copiedWebhook === "sr-webhook" ? (
                      <>
                        <Check className="size-3.5" /> Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="size-3.5" /> Copy URL
                      </>
                    )}
                  </button>
                </div>
                <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-mono text-muted-foreground select-all overflow-x-auto">
                  <span>{shiprocketWebhookUrl}</span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">
                  Webhook Secret (Optional)
                </label>
                <input
                  type="text"
                  value={srWebhookSecret}
                  onChange={(e) => setSrWebhookSecret(e.target.value)}
                  placeholder="Secret key configured in Shiprocket webhook"
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2 text-sm outline-none transition focus:border-indigo-600 shadow-2xs font-mono"
                />
              </div>
            </div>
          </details>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={handleSaveShiprocket}
              disabled={savingSr}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 text-xs font-bold shadow-xs transition disabled:opacity-50 cursor-pointer"
            >
              {savingSr ? (
                <>
                  <RefreshCw className="size-3 animate-spin" /> Saving…
                </>
              ) : (
                <>
                  <Check className="size-3.5" /> Save Logistics Credentials
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ─── SECTION 2: RAZORPAY PAYMENT GATEWAY HUB ──────────────────── */}
      <div className="rounded-3xl border border-border bg-card p-6 shadow-sm space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/20">
              <CreditCard className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display text-lg font-bold text-foreground">
                  Razorpay Payment Gateway &amp; Auto-Refund Engine
                </h3>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                  <ShieldCheck className="size-3.5" />
                  SECURE GATEWAY ACTIVE
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                UPI, Credit/Debit Cards, NetBanking, aur Wallets. Instant payment verification, automated inventory reservation, aur 1-click gateway auto-refunds.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleTestRazorpay}
            disabled={testRazorpay.isPending}
            className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 text-xs font-bold transition shadow-xs disabled:opacity-50 cursor-pointer shrink-0"
          >
            <RefreshCw className={`size-3.5 ${testRazorpay.isPending ? "animate-spin" : ""}`} />
            <span>{testRazorpay.isPending ? "Testing Connection…" : "Test Razorpay Connection"}</span>
          </button>
        </div>

        {/* Live Test Status Feedback */}
        {rzpTestResult && (
          <div
            className={`rounded-2xl border p-4 text-xs flex items-start gap-3 transition-all ${
              rzpTestResult.success
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300"
                : "bg-destructive/10 border-destructive/30 text-destructive"
            }`}
          >
            {rzpTestResult.success ? (
              <CheckCircle2 className="size-5 shrink-0 text-emerald-600 mt-0.5" />
            ) : (
              <AlertCircle className="size-5 shrink-0 text-destructive mt-0.5" />
            )}
            <div className="space-y-1">
              <p className="font-bold">{rzpTestResult.message}</p>
              {rzpTestResult.key_id && (
                <p className="text-[11px] font-mono opacity-90">
                  Key ID: <strong>{rzpTestResult.key_id}</strong>
                </p>
              )}
            </div>
          </div>
        )}

        {/* Razorpay Features Summary */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-border/70 bg-muted/20 p-3.5 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
              <Zap className="size-3.5 text-amber-500" />
              Instant Auto-Refunds
            </div>
            <p className="text-[11px] text-muted-foreground">
              Jab admin ya customer order cancel karta hai, Razorpay se refund turant initiate ho jata hai.
            </p>
          </div>

          <div className="rounded-2xl border border-border/70 bg-muted/20 p-3.5 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
              <Truck className="size-3.5 text-indigo-500" />
              Automatic Shipping Sync
            </div>
            <p className="text-[11px] text-muted-foreground">
              Jaise hi online payment receive hoti hai, order automatic Shiprocket shipping queue me chala jata hai.
            </p>
          </div>

          <div className="rounded-2xl border border-border/70 bg-muted/20 p-3.5 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
              <Lock className="size-3.5 text-emerald-500" />
              Fail-Safe Order Creation
            </div>
            <p className="text-[11px] text-muted-foreground">
              Network disconnect ya browser close hone par bhi payment safely verify hokar order create ho jata hai.
            </p>
          </div>
        </div>

        {/* Razorpay Credentials Inputs */}
        <div className="space-y-4 pt-2 border-t border-border/60">
          <h4 className="font-bold text-sm text-foreground">Razorpay API Credentials</h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground">
                Razorpay Key ID
              </label>
              <input
                type="text"
                value={rzpKeyId}
                onChange={(e) => setRzpKeyId(e.target.value)}
                placeholder="rzp_live_xxxxxxxxxxxxxx"
                className="w-full rounded-xl border border-border bg-background px-3.5 py-2 font-mono text-sm outline-none transition focus:border-emerald-600 shadow-2xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground">
                Razorpay Key Secret
              </label>
              <div className="relative">
                <input
                  type={showRzpSecret ? "text" : "password"}
                  value={rzpKeySecret}
                  onChange={(e) => setRzpKeySecret(e.target.value)}
                  placeholder="••••••••••••••••••••••••"
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2 pr-10 font-mono text-sm outline-none transition focus:border-emerald-600 shadow-2xs"
                />
                <button
                  type="button"
                  onClick={() => setShowRzpSecret(!showRzpSecret)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  {showRzpSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* Collapsible Developer/Webhook Section (Hidden from default view) */}
          <details className="group rounded-2xl border border-border/60 bg-muted/15 p-3.5 transition">
            <summary className="flex items-center justify-between text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer select-none">
              <span className="flex items-center gap-2">
                <Code2 className="size-3.5 text-muted-foreground" />
                <span>Developer Settings (Webhook &amp; Secrets)</span>
              </span>
              <span className="text-[10px] text-muted-foreground transition-transform group-open:rotate-180">
                ▼
              </span>
            </summary>
            <div className="pt-3 space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Razorpay Webhook URL
                  </span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(razorpayWebhookUrl, "rzp-webhook")}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 hover:text-emerald-700 transition cursor-pointer"
                  >
                    {copiedWebhook === "rzp-webhook" ? (
                      <>
                        <Check className="size-3.5" /> Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="size-3.5" /> Copy URL
                      </>
                    )}
                  </button>
                </div>
                <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-mono text-muted-foreground select-all overflow-x-auto">
                  <span>{razorpayWebhookUrl}</span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">
                  Webhook Secret (Configured in Razorpay Webhook Settings)
                </label>
                <input
                  type="password"
                  value={rzpWebhookSecret}
                  onChange={(e) => setRzpWebhookSecret(e.target.value)}
                  placeholder="••••••••••••••••"
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2 font-mono text-sm outline-none transition focus:border-emerald-600 shadow-2xs"
                />
              </div>
            </div>
          </details>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={handleSaveRazorpay}
              disabled={savingRzp}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-xs font-bold shadow-xs transition disabled:opacity-50 cursor-pointer"
            >
              {savingRzp ? (
                <>
                  <RefreshCw className="size-3 animate-spin" /> Saving…
                </>
              ) : (
                <>
                  <Check className="size-3.5" /> Save Payment Gateway Credentials
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
