import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  CreditCard,
  Banknote,
  Check,
  Clock,
  ShieldCheck,
  AlertCircle,
  HelpCircle,
} from "lucide-react";
import { usePaymentSettings, useUpdatePaymentSettings } from "@/lib/payment-settings";

export function PaymentMethodsSettingsCard() {
  const { data: settings, isLoading, error } = usePaymentSettings();
  const updateSettings = useUpdatePaymentSettings();

  const [codEnabled, setCodEnabled] = useState(false);
  const [codFee, setCodFee] = useState<string>("0");
  const [minOrderVal, setMinOrderVal] = useState<string>("");
  const [maxOrderVal, setMaxOrderVal] = useState<string>("");
  const [hasChanged, setHasChanged] = useState(false);

  useEffect(() => {
    if (settings) {
      setCodEnabled(Boolean(settings.cod_enabled));
      setCodFee(String(settings.cod_fee ?? 0));
      setMinOrderVal(
        settings.cod_min_order_value !== null && settings.cod_min_order_value !== undefined
          ? String(settings.cod_min_order_value)
          : "",
      );
      setMaxOrderVal(
        settings.cod_max_order_value !== null && settings.cod_max_order_value !== undefined
          ? String(settings.cod_max_order_value)
          : "",
      );
      setHasChanged(false);
    }
  }, [settings]);

  const onSave = async () => {
    try {
      const parsedFee = Number(codFee) || 0;
      const parsedMin = minOrderVal.trim() !== "" ? Number(minOrderVal) : null;
      const parsedMax = maxOrderVal.trim() !== "" ? Number(maxOrderVal) : null;

      if (parsedMin !== null && parsedMax !== null && parsedMin > parsedMax) {
        toast.error("Minimum COD order value cannot be greater than Maximum COD order value");
        return;
      }

      await updateSettings.mutateAsync({
        cod_enabled: codEnabled,
        cod_fee: parsedFee,
        cod_min_order_value: parsedMin,
        cod_max_order_value: parsedMax,
      });

      setHasChanged(false);
      toast.success(
        codEnabled
          ? "Payment methods updated: Cash on Delivery is now ENABLED!"
          : "Payment methods updated: Cash on Delivery is now DISABLED.",
      );
    } catch (err) {
      toast.error((err as Error).message || "Failed to update payment settings");
    }
  };

  const formattedDate = settings?.updated_at
    ? new Date(settings.updated_at).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="rounded-3xl border border-border bg-card p-6 shadow-sm space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-lg font-bold text-foreground">Payment Methods</h3>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
              Global Checkout
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure authoritative payment gateways and toggle Cash on Delivery availability across
            the live storefront.
          </p>
        </div>

        {formattedDate && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted/40 px-3 py-1.5 rounded-full border border-border/50">
            <Clock className="size-3.5 text-muted-foreground" />
            <span>Updated: {formattedDate}</span>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex h-36 items-center justify-center">
          <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-xs text-destructive flex items-center gap-3">
          <AlertCircle className="size-5 shrink-0" />
          <span>Failed to load payment settings: {(error as Error).message}</span>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Method 1: Online Payment (Razorpay) */}
          <div className="rounded-2xl border border-border/70 bg-muted/15 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="size-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-500/20">
                <CreditCard className="size-5" />
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm text-foreground">Online Payment (Razorpay)</h4>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                    <ShieldCheck className="size-3" />
                    ENABLED
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Accepts UPI (GPay, PhonePe, Paytm), Credit / Debit Cards, NetBanking, and Wallets.
                  Protected by cryptographic HMAC verification.
                </p>
              </div>
            </div>
          </div>

          {/* Method 2: Cash on Delivery (COD) */}
          <div
            className={`rounded-2xl border transition-all p-4 sm:p-5 space-y-5 ${
              codEnabled
                ? "border-primary/40 bg-primary/[0.02] shadow-2xs"
                : "border-border/70 bg-muted/10"
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div
                  className={`size-10 rounded-xl flex items-center justify-center shrink-0 border transition-colors ${
                    codEnabled
                      ? "bg-primary/10 text-primary border-primary/20"
                      : "bg-muted text-muted-foreground border-border"
                  }`}
                >
                  <Banknote className="size-5" />
                </div>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-sm text-foreground">Cash on Delivery (COD)</h4>
                    <span
                      className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${
                        codEnabled
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                          : "bg-muted text-muted-foreground border-border"
                      }`}
                    >
                      {codEnabled ? "ACTIVE" : "DISABLED"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    When enabled, customers can select Cash on Delivery at checkout. Orders are
                    created as Unpaid and stock is reserved atomically.
                  </p>
                </div>
              </div>

              {/* Master COD Toggle Switch */}
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {codEnabled ? "ON" : "OFF"}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={codEnabled}
                  onClick={() => {
                    setCodEnabled(!codEnabled);
                    setHasChanged(true);
                  }}
                  className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
                    codEnabled ? "bg-primary" : "bg-muted-foreground/30"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block size-6 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                      codEnabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Sub-controls when COD is enabled */}
            {codEnabled && (
              <div className="pt-4 border-t border-border/60 grid gap-4 sm:grid-cols-3 animate-in fade-in slide-in-from-top-2 duration-300">
                <label className="block space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                      COD Fee (₹)
                    </span>
                    <span
                      className="text-[10px] text-muted-foreground"
                      title="Optional flat fee added to cart"
                    >
                      (Optional)
                    </span>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-xs text-muted-foreground font-bold">
                      ₹
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={codFee}
                      onChange={(e) => {
                        setCodFee(e.target.value);
                        setHasChanged(true);
                      }}
                      placeholder="0"
                      className="w-full pl-7 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary shadow-2xs"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Handling fee applied per COD order.
                  </p>
                </label>

                <label className="block space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                      Min Order Value (₹)
                    </span>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-xs text-muted-foreground font-bold">
                      ₹
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={minOrderVal}
                      onChange={(e) => {
                        setMinOrderVal(e.target.value);
                        setHasChanged(true);
                      }}
                      placeholder="e.g. 299"
                      className="w-full pl-7 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary shadow-2xs"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    COD hidden if cart subtotal is lower.
                  </p>
                </label>

                <label className="block space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                      Max Order Value (₹)
                    </span>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-xs text-muted-foreground font-bold">
                      ₹
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={maxOrderVal}
                      onChange={(e) => {
                        setMaxOrderVal(e.target.value);
                        setHasChanged(true);
                      }}
                      placeholder="e.g. 5000"
                      className="w-full pl-7 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary shadow-2xs"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    COD hidden if cart subtotal exceeds this.
                  </p>
                </label>
              </div>
            )}
          </div>

          {/* Action Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <HelpCircle className="size-3.5 text-muted-foreground/70" />
              <span>Changes take effect immediately on customer checkouts.</span>
            </div>

            <button
              type="button"
              onClick={onSave}
              disabled={updateSettings.isPending || !hasChanged}
              className="inline-flex items-center gap-2 rounded-2xl bg-primary px-6 py-2.5 text-sm font-bold text-primary-foreground shadow-md transition hover:opacity-90 active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              {updateSettings.isPending ? (
                <>
                  <div className="size-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="size-4" /> Save Payment Settings
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
