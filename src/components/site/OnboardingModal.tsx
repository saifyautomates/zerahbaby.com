import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Sparkles, MapPin, User, Phone, CheckCircle2 } from "lucide-react";
import { useSession } from "@/lib/auth";
import { useProfile } from "@/lib/orders";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { BrandName } from "@/components/site/BrandName";

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
  const [isOpen, setIsOpen] = useState(false);

  // Track the current user ID to detect fresh sign-in transitions
  const lastUserIdRef = useRef<string | null>(null);

  // Check if all critical profile fields are already populated
  const isProfileComplete = Boolean(
    profile?.full_name?.trim() &&
    profile?.phone?.trim() &&
    profile?.address?.trim() &&
    profile?.city?.trim() &&
    profile?.state?.trim() &&
    profile?.pincode?.trim(),
  );

  // Listen to manual triggers (e.g. from /auth upon fresh login)
  useEffect(() => {
    function handleOpenEvent() {
      setIsOpen(true);
    }
    window.addEventListener("zerah:open-onboarding", handleOpenEvent);
    return () => window.removeEventListener("zerah:open-onboarding", handleOpenEvent);
  }, []);

  // When an authenticated user is detected or switches
  useEffect(() => {
    if (user?.id) {
      if (user.id !== lastUserIdRef.current) {
        lastUserIdRef.current = user.id;
        const dismissed = sessionStorage.getItem(`onboarding_dismissed_${user.id}`);
        if (!dismissed) {
          setIsOpen(true);
        }
      }
    } else {
      lastUserIdRef.current = null;
      setIsOpen(false);
    }
  }, [user?.id]);

  // When profile data arrives or changes
  useEffect(() => {
    if (profile && user) {
      const defaultName =
        profile.full_name?.trim() ||
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        "";
      const defaultPhone = profile.phone?.trim() || user.phone || user.user_metadata?.phone || "";

      setForm({
        full_name: defaultName,
        phone: defaultPhone,
        address: profile.address || "",
        city: profile.city || "",
        state: profile.state || "",
        pincode: profile.pincode || "",
      });

      // If user details are incomplete and user hasn't explicitly dismissed this session
      const complete = Boolean(
        defaultName.trim() &&
        defaultPhone.trim() &&
        profile.address?.trim() &&
        profile.city?.trim() &&
        profile.state?.trim() &&
        profile.pincode?.trim(),
      );

      if (!complete) {
        const dismissed = sessionStorage.getItem(`onboarding_dismissed_${user.id}`);
        if (!dismissed) {
          setIsOpen(true);
        }
      }
    }
  }, [profile, user]);

  const handleDismiss = () => {
    setIsOpen(false);
    if (user?.id) {
      try {
        sessionStorage.setItem(`onboarding_dismissed_${user.id}`, "true");
        sessionStorage.setItem("onboarding_dismissed", "true");
      } catch {
        // Ignore storage errors
      }
    }
  };

  // Never show customer onboarding modal while inside the admin dashboard or POS terminal
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/admin")) {
    return null;
  }

  // Do not show if not open or if profile is already complete
  if (!isOpen) return null;
  if (user && isProfileComplete) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;

    if (!form.full_name.trim()) {
      toast.error("Please enter your full name");
      return;
    }
    if (!form.phone.trim()) {
      toast.error("Please enter your phone number");
      return;
    }
    if (!form.address.trim()) {
      toast.error("Please enter your delivery address");
      return;
    }
    if (!form.city.trim()) {
      toast.error("Please enter your city");
      return;
    }
    if (!form.state.trim()) {
      toast.error("Please select your state");
      return;
    }
    if (!/^\d{6}$/.test(form.pincode.trim())) {
      toast.error("Please enter a valid 6-digit pincode");
      return;
    }

    setBusy(true);
    try {
      // Upsert profile record to ensure creation even if row was not yet created
      const { error } = await supabase.from("profiles").upsert(
        {
          id: user.id,
          full_name: form.full_name.trim(),
          phone: form.phone.trim(),
          address: form.address.trim(),
          city: form.city.trim(),
          state: form.state.trim(),
          pincode: form.pincode.trim(),
          email: profile?.email || user.email || "",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );

      if (error) throw error;

      toast.success("Profile details saved successfully!");
      qc.invalidateQueries({ queryKey: ["profile", user.id] });
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["admin-customers"] });
      setIsOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong saving your details");
    } finally {
      setBusy(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 sm:p-6 animate-in fade-in duration-200"
      onClick={handleDismiss}
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-modal-title"
    >
      <div
        className="relative flex flex-col w-full max-w-lg max-h-[92vh] rounded-3xl border border-border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
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
          {/* Header */}
          <div className="text-center pr-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold mb-2">
              <Sparkles className="size-3.5" />
              <span>Complete Your Profile</span>
            </div>
            <h2
              id="onboarding-modal-title"
              className="font-display text-2xl font-bold text-foreground"
            >
              Welcome to <BrandName size="lg" className="inline-block" />!
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Please provide your delivery details so we can deliver your orders quickly and
              smoothly.
            </p>
          </div>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            {/* Full Name */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Full Name *
              </label>
              <div className="relative flex items-center rounded-xl border border-border bg-background focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20 transition-all">
                <div className="pl-3.5 text-muted-foreground">
                  <User className="size-4" />
                </div>
                <input
                  required
                  id="onboarding-full-name"
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  placeholder="Enter your full name"
                  className="w-full bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground/60"
                />
              </div>
            </div>

            {/* Phone Number */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Mobile Number *
              </label>
              <div className="relative flex items-center rounded-xl border border-border bg-background focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20 transition-all">
                <div className="pl-3.5 text-muted-foreground">
                  <Phone className="size-4" />
                </div>
                <input
                  required
                  type="tel"
                  id="onboarding-phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+91 98765 43210"
                  className="w-full bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground/60"
                />
              </div>
            </div>

            {/* Address */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Street Address (House / Flat / Area) *
              </label>
              <div className="relative flex items-start rounded-xl border border-border bg-background focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20 transition-all">
                <div className="pl-3.5 pt-3 text-muted-foreground">
                  <MapPin className="size-4" />
                </div>
                <textarea
                  required
                  id="onboarding-address"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="Flat / House no, Building name, Street area"
                  className="w-full resize-y bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground/60"
                  rows={2}
                />
              </div>
            </div>

            {/* City & State Grid */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  City *
                </label>
                <input
                  required
                  id="onboarding-city"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  placeholder="e.g. Mumbai"
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 placeholder:text-muted-foreground/60 transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  State *
                </label>
                <select
                  required
                  id="onboarding-state"
                  value={form.state}
                  onChange={(e) => setForm({ ...form, state: e.target.value })}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
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
              </div>
            </div>

            {/* Pincode */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Pincode (6 digits) *
              </label>
              <input
                required
                maxLength={6}
                inputMode="numeric"
                id="onboarding-pincode"
                value={form.pincode}
                onChange={(e) => setForm({ ...form, pincode: e.target.value.replace(/\D/g, "") })}
                placeholder="6-digit pincode"
                className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 placeholder:text-muted-foreground/60 transition-all"
              />
            </div>

            {/* Actions */}
            <div className="pt-3 space-y-2">
              <button
                type="submit"
                id="onboarding-submit-btn"
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60 cursor-pointer shadow-md active:scale-[0.99]"
              >
                {busy ? (
                  <span>Saving Details...</span>
                ) : (
                  <>
                    <CheckCircle2 className="size-4" />
                    <span>Save Details & Continue</span>
                  </>
                )}
              </button>
              <button
                type="button"
                id="onboarding-skip-btn"
                onClick={handleDismiss}
                className="w-full py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer text-center"
              >
                Skip for now · I'll complete this later
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  );
}
