import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { formatPrice, imageFor } from "@/lib/store";
import { useCart } from "@/lib/cart";
import { useSession } from "@/lib/auth";
import { useProfile, useSaveProfile, usePlaceOrder, type Profile } from "@/lib/orders";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { ResponsiveMedia } from "@/components/ui/ResponsiveMedia";
import { Sparkles, TicketPercent, Truck } from "lucide-react";

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
});

function CheckoutPage() {
  const navigate = useNavigate();
  const { user } = useSession();
  const { items, subtotal, savings, total, coupon, clear, applyCoupon, removeCoupon, shipping } =
    useCart();
  const { data: profile } = useProfile(user?.id);
  const saveProfile = useSaveProfile(user?.id);
  const placeOrder = usePlaceOrder();

  const couponCode = coupon?.code || "";
  const couponDiscount = coupon?.discount || 0;
  const couponApplied = !!coupon;

  // Local state for the input field
  const [couponInput, setCouponInput] = useState(couponCode);
  const [couponLoading, setCouponLoading] = useState(false);
  const finalTotal = total;

  useEffect(() => {
    trackEvent("checkout_started");
  }, []);

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

      const orderPayload =
        addressMode === "saved" && profile
          ? {
              userId: user.id,
              email: user.email ?? "",
              full_name: profile.full_name ?? "",
              phone: profile.phone ?? "",
              alt_phone: "",
              address: profile.address ?? "",
              address_line2: "",
              landmark: "",
              city: profile.city || "",
              state: profile.state || "",
              pincode: profile.pincode || "",
              payment_method: form.payment_method,
              notes: form.notes.trim(),
              subtotal,
              shipping,
              discount: couponDiscount,
              coupon_code: couponApplied ? couponCode : undefined,
              items: items.map(({ product, qty, variantId, price, image }) => ({
                variant_id: variantId || (product.variants?.length ? product.variants[0].id : ""),
                product_slug: product.id,
                name: product.name,
                image_url: image || product.imageUrl || product.image,
                price: price,
                qty,
              })),
            }
          : {
              userId: user.id,
              email: user.email ?? "",
              full_name: form.full_name.trim(),
              phone: form.phone.trim(),
              alt_phone: form.alt_phone.trim(),
              address: form.address.trim(),
              address_line2: form.address_line2.trim(),
              landmark: form.landmark.trim(),
              city: form.city.trim(),
              state: form.state.trim(),
              pincode: form.pincode.trim(),
              payment_method: form.payment_method,
              notes: form.notes.trim(),
              subtotal,
              shipping,
              discount: couponDiscount,
              coupon_code: couponApplied ? couponCode : undefined,
              items: items.map(({ product, qty, variantId, price, image }) => ({
                variant_id: variantId || (product.variants?.length ? product.variants[0].id : ""),
                product_slug: product.id,
                name: product.name,
                image_url: image || product.imageUrl || product.image,
                price: price,
                qty,
              })),
            };

      const orderId = await placeOrder.mutateAsync(orderPayload);

      if (form.payment_method === "online") {
        setSubmitting(true);
        try {
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

          // Try creating Razorpay Order via Edge Function
          let rzpOrderId: string | undefined = undefined;
          let rzpKeyId: string = import.meta.env.VITE_RAZORPAY_KEY_ID || "rzp_live_TSOPbz5nCb4pLb";
          let rzpAmount: number = Math.round(finalTotal * 100);

          try {
            const { data: createData } = await supabase.functions.invoke("create-razorpay-order", {
              body: { orderId },
            });
            if (createData?.rzp_order_id) {
              rzpOrderId = createData.rzp_order_id;
            }
            if (createData?.key_id) {
              rzpKeyId = createData.key_id;
            }
            if (createData?.amount) {
              rzpAmount = createData.amount;
            }
          } catch (createErr) {
            console.warn(
              "[Checkout] create-razorpay-order backend fallback to client key:",
              createErr,
            );
          }

          // Open Razorpay Standard Checkout Modal
          const options: Record<string, unknown> = {
            key: rzpKeyId,
            amount: rzpAmount,
            currency: "INR",
            name: "Zerah Baby And Kid's",
            description: `Order Payment (${formatPrice(finalTotal)})`,
            ...(rzpOrderId ? { order_id: rzpOrderId } : {}),
            prefill: {
              name: orderPayload.full_name,
              email: orderPayload.email,
              contact: orderPayload.phone,
            },
            notes: {
              order_id: orderId,
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
                    orderId,
                    total: finalTotal,
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
                try {
                  await (
                    supabase as unknown as {
                      rpc: (name: string, args: { order_id: string }) => Promise<void>;
                    }
                  ).rpc("cancel_abandoned_order", { order_id: orderId });
                } catch (cancelErr) {
                  console.warn("[Checkout] Failed to cancel abandoned order:", cancelErr);
                }
                toast.error(
                  "Payment window closed. Your order has been cancelled. Please place a new order if you wish to try again.",
                );
              },
            },
            theme: {
              color: "#883a3a", // Brand Primary Crimson Maroon
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
          rzp.on("payment.failed", (response: { error: { description: string } }) => {
            toast.error(response.error?.description || "Payment failed at gateway");
          });
          rzp.open();
          return; // Do not proceed to standard COD success
        } catch (paymentErr: unknown) {
          setSubmitting(false);
          const rawMessage = (paymentErr as Error).message || "Could not start payment";
          console.error("[Checkout] Online payment initialization error:", rawMessage);

          // Restore stock and mark order cancelled so inventory is not drained
          try {
            await (
              supabase as unknown as {
                rpc: (name: string, args: { order_id: string }) => Promise<void>;
              }
            ).rpc("cancel_abandoned_order", { order_id: orderId });
          } catch (cancelErr) {
            console.warn("[Checkout] Failed to cancel order after init failure:", cancelErr);
          }

          toast.error(
            rawMessage.includes("credentials") ||
              rawMessage.includes("Authentication") ||
              rawMessage.includes("status 401")
              ? "Payment gateway is currently unavailable. Please try Cash on Delivery or contact support."
              : `Payment initialization error: ${rawMessage}.`,
          );
          return;
        }
      }

      trackEvent("order_created", {
        metadata: {
          orderId,
          total: finalTotal,
          coupon: couponCode || null,
          payment: form.payment_method,
        },
      });

      // Trigger transactional SMS for finalized COD order (non-blocking)
      supabase.functions
        .invoke("msg91-transactional", {
          body: {
            order_id: orderId,
            event_type: "online_sale",
            phone: form.phone.trim(),
            name: form.full_name.trim(),
            total: finalTotal,
            payment_method: "COD",
            notify_owner: true,
          },
        })
        .catch((smsErr) => {
          console.warn("[Checkout] COD SMS dispatch non-blocking error:", smsErr);
        });

      await clear();
      toast.success("Order placed! Your invoice is ready in My orders.");
      navigate({ to: "/orders" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not place the order");
      setSubmitting(false);
    }
  }

  const field =
    "w-full rounded-xl border border-border bg-background px-4 py-2.5 text-base sm:text-sm outline-none transition-all duration-300 focus:border-primary focus:bg-background focus:ring-4 focus:ring-primary/10 hover:border-border/80";
  const busy = placeOrder.isPending || saveProfile.isPending || submitting;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 pb-32 sm:pb-10">
      <h1 className="font-display text-3xl font-bold">Checkout</h1>
      <p className="mt-1 text-sm text-muted-foreground">Signed in as {user?.email}</p>

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
            <h2 className="text-lg font-bold">Payment & Notes</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold sm:col-span-2">
                Payment method
                <div className={`mt-1 bg-muted text-muted-foreground ${field} cursor-not-allowed`}>
                  Pay Online (UPI/Cards/NetBanking)
                </div>
              </label>
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
            disabled={busy}
            className="focus-ring press mt-4 w-full rounded-full bg-primary py-4 text-sm font-bold text-primary-foreground shadow-premium-md transition-all duration-300 hover:bg-primary/90 hover:-translate-y-0.5 hover:shadow-premium-hover disabled:opacity-60 disabled:transform-none disabled:shadow-none"
          >
            {busy ? "Placing order…" : `Place order · ${formatPrice(finalTotal)}`}
          </button>
          <p className="text-center text-xs text-muted-foreground">
            An invoice is generated instantly and shared with our team. We call to confirm.
          </p>
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
            <div className="flex justify-between items-center text-foreground">
              <span className="text-muted-foreground font-medium">Subtotal</span>
              <span className="font-semibold tabular-nums text-right">{formatPrice(subtotal)}</span>
            </div>
            {savings > 0 && (
              <div className="flex justify-between items-center text-emerald-600 dark:text-emerald-400">
                <span className="font-medium flex items-center gap-1.5">
                  <Sparkles className="size-3.5" />
                  Product Savings
                </span>
                <span className="font-semibold tabular-nums text-right">
                  - {formatPrice(savings)}
                </span>
              </div>
            )}
            {couponDiscount > 0 && (
              <div className="flex justify-between items-center text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 p-2.5 rounded-xl border border-emerald-500/20">
                <span className="font-medium flex items-center gap-2 text-xs">
                  <TicketPercent className="size-4 text-emerald-600" />
                  Coupon ({couponCode})
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
              <span className={`font-bold tabular-nums text-right ${shipping === 0 ? "text-emerald-600 font-black uppercase" : ""}`}>
                {shipping === 0 ? "FREE" : `+ ${formatPrice(shipping)}`}
              </span>
            </div>
            <div className="border-t border-dashed border-border/80 my-3" />
            <div className="flex items-center justify-between pt-1">
              <div className="space-y-0.5">
                <span className="text-base font-bold text-foreground block">Total to pay</span>
                <span className="text-[11px] text-muted-foreground block">Inclusive of all taxes</span>
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
