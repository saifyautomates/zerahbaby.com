import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useSession } from "@/lib/auth";
import { useProfile } from "@/lib/orders";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

const INDIA_STATES = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
];

export function OnboardingModal() {
  const { user } = useSession();
  const { data: profile, isLoading } = useProfile(user?.id);
  const qc = useQueryClient();

  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
  });
  const [busy, setBusy] = useState(false);
  const [isOpen, setIsOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return !sessionStorage.getItem("onboarding_dismissed");
  });

  const handleDismiss = () => {
    setIsOpen(false);
    try {
      sessionStorage.setItem("onboarding_dismissed", "true");
    } catch {
      // Ignore storage errors
    }
  };

  useEffect(() => {
    if (profile) {
      const defaultName =
        profile.full_name || user?.user_metadata?.full_name || user?.user_metadata?.name || "";
      setForm((prev) => ({
        ...prev,
        full_name: defaultName,
        phone: profile.phone || user?.phone || "",
        address: profile.address || "",
        city: profile.city || "",
        state: profile.state || "",
        pincode: profile.pincode || "",
      }));
    }
  }, [profile, user]);

  if (!user || isLoading || !profile || !isOpen) return null;

  // Show if missing ANY critical profile info
  const isProfileComplete =
    profile.full_name?.trim() &&
    profile.phone?.trim() &&
    profile.address?.trim() &&
    profile.city?.trim() &&
    profile.state?.trim();

  if (isProfileComplete) {
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: form.full_name,
          phone: form.phone,
          address: form.address,
          city: form.city,
          state: form.state,
          pincode: form.pincode,
        })
        .eq("id", user.id);

      if (error) throw error;

      toast.success("Profile saved successfully");
      qc.invalidateQueries({ queryKey: ["profile", user.id] });
      setIsOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 sm:p-6 animate-in fade-in duration-200"
      onClick={handleDismiss}
    >
      <div
        className="relative flex flex-col w-full max-w-md max-h-full rounded-3xl border border-border bg-card shadow-xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Right Close (X) Button */}
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Close modal"
          className="absolute right-4 top-4 z-10 grid size-8 place-items-center rounded-full bg-muted/80 text-muted-foreground transition hover:bg-muted hover:text-foreground active:scale-95"
        >
          <X className="size-4" />
        </button>

        <div className="flex-1 min-h-0 overflow-y-auto p-6 sm:p-8">
          <div className="text-center pr-4">
            <h2 className="font-display text-2xl font-bold">Welcome to Zerah!</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Add your delivery address for faster checkout. (You can also fill this later)
            </p>
          </div>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <label className="block text-sm font-semibold">
              Full Name
              <input
                required
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                placeholder="Your full name"
                className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
              />
            </label>
            <label className="block text-sm font-semibold">
              Phone Number
              <input
                required
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+91 98765 43210"
                className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
              />
            </label>
            <label className="block text-sm font-semibold">
              Address (House / Flat / Street)
              <textarea
                required
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Your delivery address"
                className="mt-1 w-full resize-y rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                rows={2}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold">
                City
                <input
                  required
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  placeholder="e.g. Mumbai"
                  className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                />
              </label>
              <label className="block text-sm font-semibold">
                State
                <select
                  required
                  value={form.state}
                  onChange={(e) => setForm({ ...form, state: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                >
                  <option value="" disabled>
                    Select State
                  </option>
                  {INDIA_STATES.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-sm font-semibold">
              Pincode
              <input
                required
                maxLength={6}
                inputMode="numeric"
                value={form.pincode}
                onChange={(e) => setForm({ ...form, pincode: e.target.value.replace(/\D/g, "") })}
                placeholder="6-digit pincode"
                className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
              />
            </label>

            <div className="pt-2 space-y-2">
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-full bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60 cursor-pointer shadow-premium-sm"
              >
                {busy ? "Saving..." : "Save Delivery Address"}
              </button>
              <button
                type="button"
                onClick={handleDismiss}
                className="w-full py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                Skip for now · I'll fill later
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  );
}
