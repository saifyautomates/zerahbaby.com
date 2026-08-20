import { useState, useEffect } from "react";
import { useSession } from "@/lib/auth";
import { useProfile } from "@/lib/orders";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export function OnboardingModal() {
  const { user } = useSession();
  const { data: profile, isLoading } = useProfile(user?.id);
  const qc = useQueryClient();

  const [form, setForm] = useState({ full_name: "", phone: "", address: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (profile) {
      const defaultName = profile.full_name || user?.user_metadata?.full_name || user?.user_metadata?.name || "";
      setForm((prev) => ({
        ...prev,
        full_name: defaultName,
        phone: profile.phone || user?.phone || "",
        address: profile.address || "",
      }));
    }
  }, [profile, user]);

  if (!user || isLoading || !profile) return null;

  // Only show if full_name is missing (which implies first-time login)
  if (profile.full_name && profile.full_name.trim() !== "") {
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
        })
        .eq("id", user.id);
      
      if (error) throw error;
      
      toast.success("Profile saved successfully");
      qc.invalidateQueries({ queryKey: ["profile", user.id] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 shadow-lg">
        <h2 className="text-center font-display text-2xl font-bold">Welcome to Zerah!</h2>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Please provide a few details so you don't have to enter them later.
        </p>

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
            Address (Optional)
            <textarea
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Your delivery address"
              className="mt-1 w-full resize-y rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
              rows={2}
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? "Saving..." : "Save details"}
          </button>
        </form>
      </div>
    </div>
  );
}
