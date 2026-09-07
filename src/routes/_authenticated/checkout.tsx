import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { toast } from "sonner";
import { formatPrice, imageFor } from "@/lib/store";
import { useCart } from "@/lib/cart";
import { useSession } from "@/lib/auth";
import { useProfile, useSaveProfile, usePlaceOrder, type Profile } from "@/lib/orders";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { ResponsiveMedia } from "@/components/ui/ResponsiveMedia";
import { Sparkles, TicketPercent, Truck, AlertCircle, Banknote, CreditCard } from "lucide-react";
import { CartPageSkeleton } from "@/components/ui/Skeletons";
import { usePaymentSettings } from "@/lib/payment-settings";
import { createCheckoutSession, cancelCheckoutSession, placeCodOrder } from "@/lib/checkout-session";

export const Route = createFileRoute("/_authenticated/checkout")({
  head: () => ({
    meta: [
      { title: "Checkout — Zerah Baby And Kid's" },
      {
        name: "description",
        content: "Confirm your delivery details and place your Zerah Baby And Kid's order.",
      },
      { property: "og:title", content: "Checkout — Zerah Baby And Kid's" },
      { property: "og:description", content: "Confirm delivery details and place your order." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CheckoutPage,
});

function CheckoutPage() {
  const navigate = useNavigate();
  const { user } = useSession();
  const {
    items,
    subtotal,
    savings,
    total,
    coupon,
    clear,
    applyCoupon,
    removeCoupon,
    shipping,
    isLoading: cartLoading,
  } = useCart();
  const { data: profile } = useProfile(user?.id);
  const saveProfile = useSaveProfile(user?.id);
  const placeOrder = usePlaceOrder();

  const couponCode = coupon?.code || "";
  const couponDiscount = coupon?.discount || 0;
  const couponApplied = !!coupon;

  // Local state for the input field
  const [couponInput, setCouponInput] = useState(couponCode);
  const [couponLoading, setCouponLoading] = useState(false);

  // Payment settings & cancellation state
  const { data: paymentSettings } = usePaymentSettings();
  const [paymentCancelled, setPaymentCancelled] = useState(false);

  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    alt_phone: "",
    address: "",
    address_line2: "",
    landmark: "",
    city: "",
    state: "",
    pincode: "",
    payment_method: "online",
    notes: "",
  });

  const codEnabled = Boolean(paymentSettings?.cod_enabled);
  const codFee = form.payment_method === "cod" ? Number(paymentSettings?.cod_fee || 0) : 0;

  const isCodEligible = useMemo(() => {
    if (!codEnabled) return false;
    if (paymentSettings?.cod_min_order_value && subtotal < paymentSettings.cod_min_order_value) {
      return false;
    }
    if (paymentSettings?.cod_max_order_value && subtotal > paymentSettings.cod_max_order_value) {
      return false;
    }
    return true;
  }, [codEnabled, paymentSettings, subtotal]);

  // If COD is not eligible or disabled, reset payment_method to 'online'
  useEffect(() => {
    if (!isCodEligible && form.payment_method === "cod") {
      setForm((f) => ({ ...f, payment_method: "online" }));
    }
  }, [isCodEligible, form.payment_method]);

  const finalTotal = total + codFee;

  useEffect(() => {
    trackEvent("checkout_started");
  }, []);

  const hasSavedAddress = Boolean(
    profile &&
    profile.full_name &&
    profile.phone &&
    profile.address &&
    profile.city &&
    profile.state &&
    profile.pincode,
  );

  const [addressMode, setAddressMode] = useState<"saved" | "new">("new");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!profile) return;

    if (
      profile.full_name &&
      profile.phone &&
      profile.address &&
      profile.city &&
      profile.state &&
      profile.pincode
    ) {
      setAddressMode("saved");
    }

    setForm((f) => ({
      ...f,
      full_name: f.full_name || profile.full_name || "",
      phone: f.phone || profile.phone || "",
      address: f.address || profile.address || "",
      city: f.city || profile.city || "",
      state: f.state || profile.state || "",
      pincode: f.pincode || profile.pincode || "",
    }));
  }, [profile]);

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center animate-in fade-in zoom-in-95 duration-500">
        <h1 className="font-display text-3xl font-bold">Nothing to check out</h1>
        <Link
          to="/shop"
          className="focus-ring press mt-8 inline-block rounded-full bg-primary px-8 py-3.5 text-sm font-bold text-primary-foreground shadow-premium-md transition-all hover:bg-primary/90 hover:-translate-y-0.5 hover:shadow-premium-hover"
        >
          Start shopping
        </Link>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || submitting) return;
    setSubmitting(true);
    setPaymentCancelled(false);

    if (addressMode === "new") {
      if (!/^\d{6}$/.test(form.pincode.trim())) {
        toast.error("Enter a valid 6-digit pincode");
        setSubmitting(false);
        return;
      }
      if (!/^[\d\s+-]{10,15}$/.test(form.phone.trim())) {
        toast.error("Enter a valid phone number");
        setSubmitting(false);
        return;
      }
    }

    try {
      if (addressMode === "new") {
        await saveProfile.mutateAsync({
          full_name: form.full_name.trim(),
          phone: form.phone.trim(),
          address: form.address.trim(),
          city: form.city.trim(),
          state: form.state.trim(),
          pincode: form.pincode.trim(),
        });
      }

      const generatedIdempotencyKey =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `idem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      const customerInfo =
        addressMode === "saved" && profile
          ? {
              full_name: profile.full_name ?? "",
              email: user.email ?? "",
              phone: profile.phone ?? "",
              alt_phone: "",
              address: profile.address ?? "",
              address_line2: "",
              landmark: "",
              city: profile.city || "",
              state: profile.state || "",
              pincode: profile.pincode || "",
            }
          : {
              full_name: form.full_name.trim(),
              email: user.email ?? "",
              phone: form.phone.trim(),
              alt_phone: form.alt_phone.trim(),
              address: form.address.trim(),
              address_line2: form.address_line2.trim(),
              landmark: form.landmark.trim(),
              city: form.city.trim(),
              state: form.state.trim(),
              pincode: form.pincode.trim(),
            };

      const sessionItems = items.map(({ product, qty, variantId }) => ({
        variant_id: variantId || (product.variants?.length ? product.variants[0].id : ""),
        qty,
      }));

      // 1. Create temporary checkout session (authoritative validation & total calculation on server)
      const sessionResult = await createCheckoutSession({
        items: sessionItems,
        coupon_code: couponApplied ? couponCode : undefined,
        ...customerInfo,
        notes: form.notes.trim(),
        idempotency_key: generatedIdempotencyKey,
        payment_method: form.payment_method as "online" | "cod",
      });

      const currentSessionId = sessionResult.session_id;

      // ─── COD FLOW ──────────────────────────────────────────────────
      if (form.payment_method === "cod") {
        const codResult = await placeCodOrder(currentSessionId);

        trackEvent("order_created", {
          metadata: {
            orderId: codResult.order_id,
            orderNumber: codResult.order_number,
            total: codResult.total,
            coupon: couponCode || null,
            payment: "cod",
          },
        });

        // Trigger transactional SMS for finalized COD order (non-blocking)
        const customerContactPhone = (customerInfo.phone || "").trim();
        const customerContactName = (customerInfo.full_name || "Customer").trim();

        supabase.functions
          .invoke("msg91-transactional", {
            body: {
              order_id: codResult.order_id,
              event_type: "online_sale",
              phone: customerContactPhone || undefined,
              name: customerContactName,
              total: codResult.total,
              payment_method: "COD",
              notify_owner: true,
            },
          })
          .catch((smsErr) => {
            console.warn("[Checkout] COD SMS dispatch non-blocking error:", smsErr);
          });

        // Dispatch order notification & customer invoice email (non-blocking)
        supabase.functions
          .invoke("send-owner-sale-notification", {
            body: {
              type: "online_order",
              order_id: codResult.order_id,
            },
          })
          .catch((emailErr) => {
            console.warn("[Checkout] COD email notification non-blocking error:", emailErr);
          });

        // Automatically trigger Shiprocket Shipment Creation (non-blocking)
        supabase.functions
          .invoke("shiprocket-api", {
            body: {
              action: "create_shipment",
              orderId: codResult.order_id,
            },
          })
          .catch((srErr) => {
            console.warn("[Checkout] Shiprocket auto sync non-blocking error:", srErr);
          });

        await clear();
        toast.success("Order placed successfully via Cash on Delivery!");
        navigate({ to: "/orders" });
        return;
      }

      // ─── ONLINE PAYMENT FLOW (RAZORPAY) ────────────────────────────
      // Load Razorpay Script
      await new Promise((resolve, reject) => {
        if (document.getElementById("razorpay-script")) return resolve(true);
        const script = document.createElement("script");
        script.id = "razorpay-script";
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.onload = resolve;
        script.onerror = () =>
          reject(new Error("Failed to load Razorpay SDK. Please check your connection."));
        document.body.appendChild(script);
      });

      // Strict server-side Razorpay Order creation via Edge Function using sessionId
      const { data: createData, error: createError } = await supabase.functions.invoke(
        "create-razorpay-order",
        {
          body: { sessionId: currentSessionId },
        },
      );

      if (createError) {
        throw new Error(createError.message || "Failed to initialize payment gateway order");
      }
      if (createData?.error) {
        throw new Error(createData.error);
      }
      if (!createData?.rzp_order_id) {
        throw new Error(
          "Payment gateway did not return a valid order identifier. Please retry.",
        );
      }

      const rzpOrderId: string = createData.rzp_order_id;
      const rzpKeyId: string =
        createData.key_id || import.meta.env.VITE_RAZORPAY_KEY_ID || "rzp_live_TSOPbz5nCb4pLb";
      const rzpAmount: number = createData.amount || Math.round(sessionResult.total * 100);

      // Open Razorpay Standard Checkout Modal with authoritative server order ID
      const options: Record<string, unknown> = {
        key: rzpKeyId,
        amount: rzpAmount,
        currency: "INR",
        name: "Zerah Baby And Kid's",
        description: `Order Payment (${formatPrice(sessionResult.total)})`,
        order_id: rzpOrderId,
        prefill: {
          name: customerInfo.full_name,
          email: customerInfo.email,
          contact: customerInfo.phone,
        },
        notes: {
          session_id: currentSessionId,
          store: "Zerah Baby And Kid's Kota",
        },
        handler: async (response: {
          razorpay_order_id?: string;
          razorpay_payment_id: string;
          razorpay_signature?: string;
        }) => {
          try {
            toast.loading("Verifying payment with bank...", { id: "payment-verify" });
            const orderRef = response.razorpay_order_id || rzpOrderId;
            if (!response.razorpay_signature || !orderRef) {
              throw new Error(
                "Payment signature or order reference missing from gateway response",
              );
            }

            const { data: verifyData, error: verifyError } = await supabase.functions.invoke(
              "verify-razorpay-payment",
              {
                body: {
                  session_id: currentSessionId,
                  razorpay_order_id: orderRef,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                },
              },
            );

            if (verifyError || !verifyData?.success) {
              throw new Error(
                verifyError?.message ||
                  verifyData?.error ||
                  "Cryptographic signature verification failed",
              );
            }

            trackEvent("order_created", {
              metadata: {
                orderId: verifyData.order_id,
                total: sessionResult.total,
                coupon: couponCode || null,
                payment: "online",
                razorpay_payment_id: response.razorpay_payment_id,
              },
            });

            await clear();
            toast.success("Payment verified! Your order is placed.", {
              id: "payment-verify",
            });
            navigate({ to: "/orders" });
          } catch (verifyErr: unknown) {
            console.error("[Checkout] Payment verification failure:", verifyErr);
            toast.error(
              verifyErr instanceof Error
                ? verifyErr.message
                : "Payment verification failed. Please contact support.",
              { id: "payment-verify", duration: 6000 },
            );
            navigate({ to: "/orders" });
          }
        },
        modal: {
          ondismiss: async () => {
            setSubmitting(false);
            setPaymentCancelled(true);
            await cancelCheckoutSession(currentSessionId, "Customer closed payment modal");
            toast.error("Payment cancelled. Your order has not been placed.");
          },
        },
        theme: {
          color: "#883a3a",
        },
      };

      type RazorpayInstance = {
        on: (event: string, cb: (res: { error: { description: string } }) => void) => void;
        open: () => void;
      };
      const rzp = new (
        window as unknown as {
          Razorpay: new (opts: Record<string, unknown>) => RazorpayInstance;
        }
      ).Razorpay(options);

      rzp.on("payment.failed", async (response: { error: { description: string } }) => {
        setSubmitting(false);
        setPaymentCancelled(true);
        await cancelCheckoutSession(
          currentSessionId,
          response.error?.description || "Gateway payment failure",
        );
        toast.error(
          response.error?.description ||
            "Payment failed at gateway. Your order has not been placed.",
        );
      });

      rzp.open();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not initialize payment");
      setSubmitting(false);
    }
  }

  const field =
    "w-full rounded-xl border border-border bg-background px-4 py-2.5 text-base sm:text-sm outline-none transition-all duration-300 focus:border-primary focus:bg-background focus:ring-4 focus:ring-primary/10 hover:border-border/80";
  const busy = placeOrder.isPending || saveProfile.isPending || submitting;

  if (cartLoading) {
    return <CartPageSkeleton />;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 pb-32 sm:pb-10">
      <h1 className="font-display text-3xl font-bold">Checkout</h1>
      <p className="mt-1 text-sm text-muted-foreground">Signed in as {user?.email}</p>

      {paymentCancelled && (
        <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-center sm:text-left flex flex-col sm:flex-row items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center gap-3.5">
            <div className="size-10 rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0">
              <AlertCircle className="size-5" />
            </div>
            <div>
              <h4 className="font-bold text-foreground text-sm">
                Payment cancelled. Your order has not been placed.
              </h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Your cart items and delivery details have been preserved. You can retry payment anytime.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => {
                setPaymentCancelled(false);
                const submitBtn = document.getElementById("place-order-submit-btn");
                submitBtn?.click();
              }}
              className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-xs hover:bg-primary/90 transition shadow-sm cursor-pointer"
            >
              Retry Payment
            </button>
            <Link
              to="/shop"
              className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-border bg-card text-foreground font-semibold text-xs hover:bg-muted transition text-center shadow-xs"
            >
              Back to Cart
            </Link>
          </div>
        </div>
      )}

      <div
        className={`mt-8 grid gap-8 lg:grid-cols-[1fr_360px] transition-opacity ${busy ? "opacity-50 pointer-events-none" : ""}`}
      >
        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-3xl border border-border/60 bg-card shadow-premium-sm p-5 sm:p-8"
        >
          <div className="flex items-center justify-between border-b border-border pb-4">
            <h2 className="text-lg font-bold">Delivery Address</h2>
            {hasSavedAddress && (
              <button
                type="button"
                onClick={() => setAddressMode(addressMode === "saved" ? "new" : "saved")}
                className="text-sm font-semibold text-primary transition hover:underline"
              >
                {addressMode === "saved" ? "Enter a new address" : "Use saved address"}
              </button>
            )}
          </div>

          {addressMode === "saved" && profile ? (
            <div className="rounded-xl border border-border bg-muted/30 p-5">
              <p className="font-semibold">{profile.full_name}</p>
              <p className="mt-2 text-sm text-muted-foreground">{profile.address}</p>
              <p className="text-sm text-muted-foreground">
                {profile.city}, {profile.state} {profile.pincode}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">Mobile: {profile.phone}</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold">
                Full name*
                <input
                  required
                  maxLength={100}
                  className={`mt-1 ${field}`}
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                />
              </label>
              <label className="text-sm font-semibold">
                Mobile number*
                <input
                  required
                  inputMode="tel"
                  maxLength={15}
                  className={`mt-1 ${field}`}
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </label>
              <label className="text-sm font-semibold">
                Alternate number
                <input
                  inputMode="tel"
                  maxLength={15}
                  className={`mt-1 ${field}`}
                  value={form.alt_phone}
                  onChange={(e) => setForm({ ...form, alt_phone: e.target.value })}
                />
              </label>
              <label className="text-sm font-semibold">
                Pincode*
                <input
                  required
                  inputMode="numeric"
                  maxLength={6}
                  className={`mt-1 ${field}`}
                  value={form.pincode}
                  onChange={(e) => setForm({ ...form, pincode: e.target.value.replace(/\D/g, "") })}
                />
              </label>
              <label className="text-sm font-semibold sm:col-span-2">
                House / flat, building, street*
                <textarea
                  required
                  rows={2}
                  maxLength={300}
                  className={`mt-1 ${field}`}
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </label>
              <label className="text-sm font-semibold">
                Area / colony
                <input
                  maxLength={120}
                  className={`mt-1 ${field}`}
                  value={form.address_line2}
                  onChange={(e) => setForm({ ...form, address_line2: e.target.value })}
                />
              </label>
              <label className="text-sm font-semibold">
                Landmark
                <input
                  maxLength={120}
                  className={`mt-1 ${field}`}
                  value={form.landmark}
                  onChange={(e) => setForm({ ...form, landmark: e.target.value })}
                />
              </label>
              <label className="text-sm font-semibold">
                City / town*
                <input
                  required
                  maxLength={80}
                  className={`mt-1 ${field}`}
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </label>
              <label className="text-sm font-semibold">
                State*
                <input
                  required
                  maxLength={80}
                  className={`mt-1 ${field}`}
                  value={form.state}
                  onChange={(e) => setForm({ ...form, state: e.target.value })}
                />
              </label>
            </div>
          )}

          <div className="mt-8 border-t border-border pt-6">
            <h2 className="text-lg font-bold">Payment &amp; Notes</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2 space-y-3">
                <span className="text-sm font-semibold block">Payment Method</span>

                {isCodEligible ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label
                      className={`flex items-start gap-3.5 p-4 rounded-2xl border cursor-pointer transition ${
                        form.payment_method === "online"
                          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                          : "border-border bg-card hover:bg-muted/30"
                      }`}
                    >
                      <input
                        type="radio"
                        name="payment_method"
                        value="online"
                        checked={form.payment_method === "online"}
                        onChange={() => setForm({ ...form, payment_method: "online" })}
                        className="mt-0.5 size-4 accent-primary cursor-pointer"
                      />
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <CreditCard className="size-4 text-primary" />
                          <span className="font-bold text-sm text-foreground">Online Payment</span>
                          <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                            Instant
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Pay securely with UPI, Credit / Debit Cards, or NetBanking.
                        </p>
                      </div>
                    </label>

                    <label
                      className={`flex items-start gap-3.5 p-4 rounded-2xl border cursor-pointer transition ${
                        form.payment_method === "cod"
                          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                          : "border-border bg-card hover:bg-muted/30"
                      }`}
                    >
                      <input
                        type="radio"
                        name="payment_method"
                        value="cod"
                        checked={form.payment_method === "cod"}
                        onChange={() => setForm({ ...form, payment_method: "cod" })}
                        className="mt-0.5 size-4 accent-primary cursor-pointer"
                      />
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Banknote className="size-4 text-primary" />
                          <span className="font-bold text-sm text-foreground">Cash on Delivery</span>
                          {codFee > 0 && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                              +₹{codFee} fee
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Pay with cash or UPI upon delivery at your doorstep.
                        </p>
                      </div>
                    </label>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 p-3.5 rounded-2xl border border-border bg-muted/20">
                    <CreditCard className="size-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-foreground">Online Payment (UPI / Cards / NetBanking)</p>
                      <p className="text-xs text-muted-foreground">
                        {codEnabled
                          ? `Cash on Delivery requires an order between ₹${paymentSettings?.cod_min_order_value || 0} and ₹${paymentSettings?.cod_max_order_value || "∞"}.`
                          : "Cash on Delivery is currently unavailable."}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <label className="text-sm font-semibold sm:col-span-2">
                Delivery notes (optional)
                <textarea
                  rows={2}
                  maxLength={300}
                  className={`mt-1 ${field}`}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </label>
            </div>
          </div>
          <button
            id="place-order-submit-btn"
            disabled={busy}
            className="focus-ring press mt-4 w-full rounded-full bg-primary py-4 text-sm font-bold text-primary-foreground shadow-premium-md transition-all duration-300 hover:bg-primary/90 hover:-translate-y-0.5 hover:shadow-premium-hover disabled:opacity-60 disabled:transform-none disabled:shadow-none cursor-pointer"
          >
            {busy
              ? "Placing order…"
              : `${form.payment_method === "cod" ? "Confirm COD Order" : "Pay & Place Order"} · ${formatPrice(finalTotal)}`}
          </button>
        </form>
        <aside className="h-fit rounded-3xl border border-border/60 bg-card p-6 shadow-premium-sm lg:sticky lg:top-24">
          <h2 className="font-display text-xl font-bold">Your order</h2>
          <ul className="mt-4 space-y-4 text-sm">
            {items.map(({ product, qty, variantId, variant, price, color, size, image }) => (
              <li
                key={`${product.id}-${variantId || "default"}`}
                className="flex gap-4 items-center"
              >
                <div className="size-16 shrink-0 rounded-xl overflow-hidden bg-muted border border-border/50">
                  <img
                    src={image || product.image}
                    alt={product.name}
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = imageFor(
                        product.category,
                        null,
                        product,
                      );
                    }}
                    className="w-full h-full object-cover object-center"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{product.name}</p>
                  {(color || size || (variant && variant.name !== "Default")) && (
                    <p className="text-[11px] text-primary font-medium truncate">
                      {[
                        color && `Color: ${color}`,
                        size && `Size: ${size}`,
                        !color && !size && variant?.name !== "Default" && variant?.name,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  <p className="text-muted-foreground text-xs">Qty: {qty}</p>
                </div>
                <span className="font-semibold shrink-0">{formatPrice(price * qty)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 space-y-3.5 border-t border-border pt-4 text-sm">
            {savings > 0 && (
              <div className="flex justify-between items-center text-muted-foreground">
                <span className="font-medium">Total MRP</span>
                <span className="font-semibold tabular-nums text-right line-through">
                  {formatPrice(subtotal + savings)}
                </span>
              </div>
            )}
            {savings > 0 && (
              <div className="flex justify-between items-center text-emerald-600 dark:text-emerald-400">
                <span className="font-medium flex items-center gap-1.5">
                  <Sparkles className="size-3.5" />
                  MRP Discount
                </span>
                <span className="font-bold tabular-nums text-right">- {formatPrice(savings)}</span>
              </div>
            )}
            <div className="flex justify-between items-center text-foreground font-semibold pt-1 border-t border-border/40">
              <span className="text-foreground font-semibold">Subtotal</span>
              <span className="font-bold tabular-nums text-right">{formatPrice(subtotal)}</span>
            </div>
            {couponDiscount > 0 && (
              <div className="flex justify-between items-center text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 p-2.5 rounded-xl border border-emerald-500/20">
                <span className="font-medium flex items-center gap-2 text-xs">
                  <TicketPercent className="size-4 text-emerald-600" />
                  Promo Coupon ({couponCode})
                </span>
                <span className="font-bold text-xs tabular-nums text-right">
                  - {formatPrice(couponDiscount)}
                </span>
              </div>
            )}
            <div className="flex justify-between items-center text-foreground">
              <span className="text-muted-foreground font-medium flex items-center gap-1.5">
                <Truck className="size-4 text-primary" />
                Delivery Fee
              </span>
              <span
                className={`font-bold tabular-nums text-right ${shipping === 0 ? "text-emerald-600 font-black uppercase" : ""}`}
              >
                {shipping === 0 ? "FREE" : `+ ${formatPrice(shipping)}`}
              </span>
            </div>
            {codFee > 0 && (
              <div className="flex justify-between items-center text-foreground">
                <span className="text-muted-foreground font-medium flex items-center gap-1.5">
                  <Banknote className="size-4 text-primary" />
                  COD Handling Fee
                </span>
                <span className="font-bold tabular-nums text-right text-primary">
                  + {formatPrice(codFee)}
                </span>
              </div>
            )}
            <div className="border-t border-dashed border-border/80 my-3" />
            <div className="flex items-center justify-between pt-1">
              <div className="space-y-0.5">
                <span className="text-base font-bold text-foreground block">Total to pay</span>
                <span className="text-[11px] text-muted-foreground block">
                  Inclusive of all taxes
                </span>
              </div>
              <div className="text-right">
                <span className="text-2xl font-black font-display tracking-tight text-foreground tabular-nums block">
                  {formatPrice(finalTotal)}
                </span>
                {(savings > 0 || couponDiscount > 0) && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 mt-1">
                    <Sparkles className="size-3" />
                    You save {formatPrice(savings + couponDiscount)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Coupon code */}
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-sm font-semibold">Have a coupon?</p>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                placeholder="Enter code"
                aria-label="Coupon code"
                disabled={couponApplied}
                className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
              />
              {couponApplied ? (
                <button
                  type="button"
                  onClick={() => {
                    removeCoupon();
                    setCouponInput("");
                    toast.success("Coupon removed");
                  }}
                  className="rounded-xl border border-destructive px-3 py-2 text-sm font-semibold text-destructive transition hover:bg-destructive/10"
                >
                  Remove
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!couponInput.trim() || couponLoading}
                  onClick={async () => {
                    if (!user) return;
                    setCouponLoading(true);
                    try {
                      await applyCoupon(couponInput.trim());
                      toast.success(`Coupon applied!`);
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Invalid coupon");
                    } finally {
                      setCouponLoading(false);
                    }
                  }}
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
                >
                  {couponLoading ? "…" : "Apply"}
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
