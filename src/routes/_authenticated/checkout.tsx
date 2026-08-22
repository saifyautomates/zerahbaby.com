import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { formatPrice } from "@/lib/store";
import { useCart } from "@/lib/cart";
import { useSession } from "@/lib/auth";
import { useProfile, useSaveProfile, usePlaceOrder, type Profile } from "@/lib/orders";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";

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
  const { items, subtotal, total, coupon, clear, applyCoupon, removeCoupon } = useCart();
  const { data: profile } = useProfile(user?.id);
  const saveProfile = useSaveProfile(user?.id);
  const placeOrder = usePlaceOrder();
  const shipping = subtotal >= 999 ? 0 : 79;

  const couponCode = coupon?.code || "";
  const couponDiscount = coupon?.discount || 0;
  const couponApplied = !!coupon;

  // Local state for the input field
  const [couponInput, setCouponInput] = useState(couponCode);
  const [couponLoading, setCouponLoading] = useState(false);
  const finalTotal = total + shipping;

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
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <h1 className="font-display text-3xl font-bold">Nothing to check out</h1>
        <Link
          to="/shop"
          className="mt-6 inline-block rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground"
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
              items: items.map(({ product, qty }) => ({
                product_slug: product.id,
                name: product.name,
                image_url: product.imageUrl,
                price: product.price,
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
              items: items.map(({ product, qty }) => ({
                product_slug: product.id,
                name: product.name,
                image_url: product.imageUrl,
                price: product.price,
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
            script.onerror = reject;
            document.body.appendChild(script);
          });

          // Create Razorpay Order
          const { data: createData, error: createError } = await supabase.functions.invoke(
            "create-razorpay-order",
            { body: { orderId } },
          );

          if (createError || !createData?.rzp_order_id) {
            throw new Error(createError?.message || "Failed to initialize payment");
          }

          // Open Razorpay Checkout
          const options = {
            key: import.meta.env.VITE_RAZORPAY_KEY_ID,
            amount: Math.round(finalTotal * 100),
            currency: "INR",
            name: "Zerah Baby And Kid's",
            description: "Order Payment",
            order_id: createData.rzp_order_id,
            prefill: {
              name: orderPayload.full_name,
              email: orderPayload.email,
              contact: orderPayload.phone,
            },
            handler: async (response: any) => {
              try {
                toast.loading("Verifying payment...", { id: "payment-verify" });
                const { error: verifyError } = await supabase.functions.invoke(
                  "verify-razorpay-payment",
                  {
                    body: {
                      razorpay_order_id: response.razorpay_order_id,
                      razorpay_payment_id: response.razorpay_payment_id,
                      razorpay_signature: response.razorpay_signature,
                    },
                  },
                );

                if (verifyError) throw verifyError;

                trackEvent("order_created", {
                  metadata: {
                    orderId,
                    total: finalTotal,
                    coupon: couponCode || null,
                    payment: "online",
                  },
                });
                clear();
                toast.success("Payment successful! Your order is placed.", {
                  id: "payment-verify",
                });
                navigate({ to: "/orders" });
              } catch (verifyErr: any) {
                toast.error("Payment verification failed. Please contact support.", {
                  id: "payment-verify",
                });
                // Still redirect to orders so they can see the pending order
                navigate({ to: "/orders" });
              }
            },
            modal: {
              ondismiss: async () => {
                setSubmitting(false);
                toast.error("Payment was cancelled. Stock has been restored.");
                // Immediately cancel order to restore stock, ignore errors silently since webhook is fallback
                supabase.rpc("cancel_abandoned_order", { order_id: orderId }).then().catch(console.error);
                navigate({ to: "/orders" });
              },
            },
            theme: {
              color: "#db2777", // tailwind pink-600
            },
          };

          const rzp = new (window as any).Razorpay(options);
          rzp.on("payment.failed", (response: any) => {
            toast.error(response.error.description || "Payment failed");
          });
          rzp.open();
          return; // Do not proceed to standard success yet
        } catch (paymentErr: any) {
          toast.error(paymentErr.message || "Could not start payment");
          navigate({ to: "/orders" });
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
      clear();
      toast.success("Order placed! Your invoice is ready in My orders.");
      navigate({ to: "/orders" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not place the order");
      setSubmitting(false);
    }
  }

  const field =
    "w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary";
  const busy = placeOrder.isPending || saveProfile.isPending || submitting;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="font-display text-3xl font-bold">Checkout</h1>
      <p className="mt-1 text-sm text-muted-foreground">Signed in as {user?.email}</p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_340px]">
        <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-border p-5 sm:p-6">
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
            className="press mt-2 w-full rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? "Placing order…" : `Place order · ${formatPrice(finalTotal)}`}
          </button>
          <p className="text-center text-xs text-muted-foreground">
            An invoice is generated instantly and shared with our team. We call to confirm.
          </p>
        </form>

        <aside className="h-fit rounded-2xl border border-border p-6">
          <h2 className="font-display text-xl font-bold">Your order</h2>
          <ul className="mt-4 space-y-3 text-sm">
            {items.map(({ product, qty }) => (
              <li key={product.id} className="flex justify-between gap-3">
                <span className="text-muted-foreground">
                  {product.name} × {qty}
                </span>
                <span className="font-semibold">{formatPrice(product.price * qty)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd>{formatPrice(subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Delivery</dt>
              <dd>{shipping === 0 ? "Free" : formatPrice(shipping)}</dd>
            </div>
            {couponDiscount > 0 && (
              <div className="flex justify-between text-primary">
                <dt>Coupon discount</dt>
                <dd>−{formatPrice(couponDiscount)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-3 text-base font-bold">
              <dt>Total</dt>
              <dd>{formatPrice(finalTotal)}</dd>
            </div>
          </dl>

          {/* Coupon code */}
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-sm font-semibold">Have a coupon?</p>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                placeholder="Enter code"
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
