import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { formatPrice } from "@/lib/store";
import { useCart } from "@/lib/cart";
import { useSession } from "@/lib/auth";
import { useProfile, useSaveProfile, usePlaceOrder } from "@/lib/orders";

export const Route = createFileRoute("/_authenticated/checkout")({
  head: () => ({
    meta: [
      { title: "Checkout — Zerah Baby And Kids" },
      { name: "description", content: "Confirm your delivery details and place your Zerah Baby And Kids order." },
      { property: "og:title", content: "Checkout — Zerah Baby And Kids" },
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
  const { items, subtotal, clear } = useCart();
  const { data: profile } = useProfile(user?.id);
  const saveProfile = useSaveProfile(user?.id);
  const placeOrder = usePlaceOrder();
  const shipping = subtotal >= 999 ? 0 : 79;

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
    payment_method: "cod",
    notes: "",
  });

  useEffect(() => {
    if (!profile) return;
    setForm((f) => ({
      ...f,
      full_name: f.full_name || profile.full_name,
      phone: f.phone || profile.phone,
      address: f.address || profile.address,
      city: f.city || (profile as { city?: string }).city || "",
      state: f.state || (profile as { state?: string }).state || "",
      pincode: f.pincode || (profile as { pincode?: string }).pincode || "",
    }));
  }, [profile]);

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <h1 className="font-display text-3xl font-bold">Nothing to check out</h1>
        <Link to="/shop" className="mt-6 inline-block rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground">
          Start shopping
        </Link>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!/^\d{6}$/.test(form.pincode.trim())) {
      toast.error("Enter a valid 6-digit pincode");
      return;
    }
    if (!/^[\d\s+-]{10,15}$/.test(form.phone.trim())) {
      toast.error("Enter a valid phone number");
      return;
    }
    try {
      await saveProfile.mutateAsync({
        full_name: form.full_name.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        pincode: form.pincode.trim(),
      });
      await placeOrder.mutateAsync({
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
        items: items.map(({ product, qty }) => ({
          product_slug: product.id,
          name: product.name,
          image_url: product.imageUrl,
          price: product.price,
          qty,
        })),
      });
      clear();
      toast.success("Order placed! Your invoice is ready in My orders.");
      navigate({ to: "/orders" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not place the order");
    }
  }

  const field = "w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary";
  const busy = placeOrder.isPending || saveProfile.isPending;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="font-display text-3xl font-bold">Checkout</h1>
      <p className="mt-1 text-sm text-muted-foreground">Signed in as {user?.email}</p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_340px]">
        <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-border p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold">
              Full name*
              <input required maxLength={100} className={`mt-1 ${field}`} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </label>
            <label className="text-sm font-semibold">
              Mobile number*
              <input required inputMode="tel" maxLength={15} className={`mt-1 ${field}`} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </label>
            <label className="text-sm font-semibold">
              Alternate number
              <input inputMode="tel" maxLength={15} className={`mt-1 ${field}`} value={form.alt_phone} onChange={(e) => setForm({ ...form, alt_phone: e.target.value })} />
            </label>
            <label className="text-sm font-semibold">
              Pincode*
              <input required inputMode="numeric" maxLength={6} className={`mt-1 ${field}`} value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value.replace(/\D/g, "") })} />
            </label>
            <label className="text-sm font-semibold sm:col-span-2">
              House / flat, building, street*
              <textarea required rows={2} maxLength={300} className={`mt-1 ${field}`} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </label>
            <label className="text-sm font-semibold">
              Area / colony
              <input maxLength={120} className={`mt-1 ${field}`} value={form.address_line2} onChange={(e) => setForm({ ...form, address_line2: e.target.value })} />
            </label>
            <label className="text-sm font-semibold">
              Landmark
              <input maxLength={120} className={`mt-1 ${field}`} value={form.landmark} onChange={(e) => setForm({ ...form, landmark: e.target.value })} />
            </label>
            <label className="text-sm font-semibold">
              City / town*
              <input required maxLength={80} className={`mt-1 ${field}`} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </label>
            <label className="text-sm font-semibold">
              State*
              <input required maxLength={80} className={`mt-1 ${field}`} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
            </label>
            <label className="text-sm font-semibold sm:col-span-2">
              Payment method
              <select className={`mt-1 ${field}`} value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
                <option value="cod">Cash on delivery</option>
                <option value="upi">UPI on delivery</option>
                <option value="card">Card on delivery</option>
              </select>
            </label>
            <label className="text-sm font-semibold sm:col-span-2">
              Delivery notes (optional)
              <textarea rows={2} maxLength={300} className={`mt-1 ${field}`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </label>
          </div>
          <button
            disabled={busy}
            className="mt-2 w-full rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? "Placing order…" : `Place order · ${formatPrice(subtotal + shipping)}`}
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
            <div className="flex justify-between border-t border-border pt-3 text-base font-bold">
              <dt>Total</dt>
              <dd>{formatPrice(subtotal + shipping)}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </div>
  );
}
