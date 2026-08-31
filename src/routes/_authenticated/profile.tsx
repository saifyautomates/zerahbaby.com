import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { User, MapPin, Plus, Trash2, Star, Pencil, Camera, Loader2, ImagePlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useSession } from "@/lib/auth";
import { useProfile, useSaveProfile } from "@/lib/orders";
import { uploadMedia } from "@/lib/uploads";

type UserAddress = Database["public"]["Tables"]["user_addresses"]["Row"];

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "My Profile — Zerah Baby And Kid's" },
      { name: "description", content: "Manage your profile, addresses, and preferences." },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: z.object({
    tab: z.string().optional().catch(""),
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const { user } = useSession();
  const { data: profile, isLoading } = useProfile(user?.id);
  const saveProfile = useSaveProfile(user?.id);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
  });

  useEffect(() => {
    if (profile) {
      setForm({
        full_name: profile.full_name || "",
        phone: profile.phone || "",
        address: profile.address || "",
        city: profile.city || "",
        state: profile.state || "",
        pincode: profile.pincode || "",
      });
    }
  }, [profile]);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const url = await uploadMedia(file, "avatars");
      await saveProfile.mutateAsync({ avatar_url: url });
      toast.success("Profile picture updated!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to upload photo");
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveAvatar = async () => {
    try {
      await saveProfile.mutateAsync({ avatar_url: null });
      toast.success("Profile picture removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove photo");
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    saveProfile.mutate(form, {
      onSuccess: () => toast.success("Profile updated"),
      onError: (err: Error) => toast.error(err.message),
    });
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  const initials = form.full_name
    ? form.full_name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : user?.email?.[0]?.toUpperCase() || "U";

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <h1 className="font-display text-3xl font-bold">My Profile</h1>
          <p className="mt-1 text-sm text-muted-foreground">Signed in as {user?.email}</p>
        </div>

        {/* Profile Picture / DP Upload Section */}
        <div className="flex items-center gap-4">
          <div className="relative group">
            <div className="size-20 sm:size-24 rounded-full border-2 border-primary/20 bg-muted overflow-hidden shadow-premium-sm flex items-center justify-center">
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={form.full_name || "Profile avatar"}
                  className="size-full object-cover"
                />
              ) : (
                <div className="size-full bg-gradient-to-tr from-primary/20 via-primary/10 to-amber-100 flex items-center justify-center font-display text-2xl font-bold text-primary">
                  {initials}
                </div>
              )}
            </div>

            {/* Upload Button Overlay */}
            <button
              type="button"
              disabled={uploadingAvatar}
              onClick={() => fileInputRef.current?.click()}
              aria-label="Upload profile picture"
              className="absolute inset-0 rounded-full bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 cursor-pointer disabled:opacity-100"
            >
              {uploadingAvatar ? (
                <Loader2 className="size-6 animate-spin" />
              ) : (
                <>
                  <Camera className="size-5" />
                  <span className="text-[10px] font-bold">Change</span>
                </>
              )}
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={handleAvatarChange}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={uploadingAvatar}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary hover:text-primary-foreground transition-all cursor-pointer"
              >
                <ImagePlus className="size-3.5" />
                {profile?.avatar_url ? "Change Photo" : "Upload Photo"}
              </button>
              {profile?.avatar_url && (
                <button
                  type="button"
                  onClick={handleRemoveAvatar}
                  className="rounded-full px-2.5 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                >
                  Remove
                </button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Optional · JPG, PNG, WebP up to 10MB
            </p>
          </div>
        </div>
      </div>

      <div className="mt-8">
        {!tab || tab === "info" ? (
          <div className="grid gap-8 md:grid-cols-2">
            {/* Profile Info */}
            <section>
              <div className="flex items-center gap-2 text-lg font-bold">
                <User className="size-5 text-primary" />
                Personal Info (Optional)
              </div>
              <form onSubmit={handleSave} className="mt-4 space-y-3">
                <label className="block text-sm font-semibold">
                  Full Name
                  <input
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                    placeholder="e.g. Priya Sharma"
                    className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Phone Number
                  <input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="+91 98765 43210"
                    className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Address (Street / Building)
                  <input
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    placeholder="Flat / House no, Street area"
                    className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="text-sm font-semibold">
                    City
                    <input
                      value={form.city}
                      onChange={(e) => setForm({ ...form, city: e.target.value })}
                      placeholder="City"
                      className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                    />
                  </label>
                  <label className="text-sm font-semibold">
                    State
                    <input
                      value={form.state}
                      onChange={(e) => setForm({ ...form, state: e.target.value })}
                      placeholder="State"
                      className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                    />
                  </label>
                  <label className="text-sm font-semibold">
                    Pincode
                    <input
                      value={form.pincode}
                      onChange={(e) => setForm({ ...form, pincode: e.target.value })}
                      placeholder="Pincode"
                      className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                    />
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={saveProfile.isPending}
                  className="rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50 cursor-pointer shadow-premium-sm"
                >
                  {saveProfile.isPending ? "Saving…" : "Save profile"}
                </button>
              </form>
            </section>
          </div>
        ) : tab === "addresses" ? (
          <section>
            <div className="flex items-center gap-2 text-lg font-bold mb-6">
              <MapPin className="size-5 text-primary" />
              Saved Addresses
            </div>
            <AddressList userId={user?.id} />
          </section>
        ) : null}
      </div>

      {/* Quick Links */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link
          to="/wishlist"
          className="flex items-center gap-3 rounded-2xl border border-border p-4 transition hover:border-primary/30 hover:bg-muted/50"
        >
          <div className="grid size-10 place-items-center rounded-full bg-primary/10">
            <Star className="size-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">My Wishlist</p>
            <p className="text-xs text-muted-foreground">Saved products</p>
          </div>
        </Link>
        <Link
          to="/shop"
          className="flex items-center gap-3 rounded-2xl border border-border p-4 transition hover:border-primary/30 hover:bg-muted/50"
        >
          <div className="grid size-10 place-items-center rounded-full bg-primary/10">
            <Star className="size-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">Continue Shopping</p>
            <p className="text-xs text-muted-foreground">Browse all products</p>
          </div>
        </Link>
      </div>
    </div>
  );
}

/* ---- Address List Component ---- */

function AddressList({ userId }: { userId: string | undefined }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: addresses, isLoading } = useQuery({
    queryKey: ["user-addresses", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_addresses")
        .select("*")
        .eq("user_id", userId!)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const deleteAddress = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("user_addresses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Address deleted");
      qc.invalidateQueries({ queryKey: ["user-addresses", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setDefault = useMutation({
    mutationFn: async (id: string) => {
      // First unset all defaults
      await supabase.from("user_addresses").update({ is_default: false }).eq("user_id", userId!);
      // Set this one as default
      const { error } = await supabase
        .from("user_addresses")
        .update({ is_default: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Default address updated");
      qc.invalidateQueries({ queryKey: ["user-addresses", userId] });
    },
  });

  const editAddress = (addr: UserAddress) => {
    setEditingId(addr.id);
    setShowForm(true);
  };

  return (
    <div className="mt-4 space-y-3">
      {isLoading && <p className="text-sm text-muted-foreground">Loading addresses…</p>}

      {(addresses ?? []).map((addr) => (
        <div key={addr.id} className="rounded-xl border border-border p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">{addr.full_name}</p>
              <p className="text-xs text-muted-foreground">{addr.phone}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {[addr.address_line_1, addr.address_line_2, addr.landmark]
                  .filter(Boolean)
                  .join(", ")}
              </p>
              <p className="text-xs text-muted-foreground">
                {[addr.city, addr.state, addr.postal_code].filter(Boolean).join(", ")}
              </p>
            </div>
            <div className="flex gap-1">
              {!addr.is_default && (
                <button
                  onClick={() => setDefault.mutate(addr.id)}
                  className="rounded-lg px-2 py-1 text-[10px] font-semibold text-primary hover:bg-primary/10"
                >
                  Set default
                </button>
              )}
              {addr.is_default && (
                <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">
                  Default
                </span>
              )}
              <button
                onClick={() => deleteAddress.mutate(addr.id)}
                className="rounded-lg p-1 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      ))}

      {!isLoading && (addresses ?? []).length === 0 && (
        <p className="text-xs text-muted-foreground">No saved addresses yet.</p>
      )}

      {!showForm ? (
        <button
          onClick={() => {
            setEditingId(null);
            setShowForm(true);
          }}
          className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
        >
          <Plus className="size-4" /> Add address
        </button>
      ) : (
        <AddressForm
          userId={userId!}
          editingId={editingId}
          addresses={addresses ?? []}
          onDone={() => {
            setShowForm(false);
            setEditingId(null);
            qc.invalidateQueries({ queryKey: ["user-addresses", userId] });
          }}
          onCancel={() => {
            setShowForm(false);
            setEditingId(null);
          }}
        />
      )}
    </div>
  );
}

/* ---- Address Form ---- */

function AddressForm({
  userId,
  editingId,
  addresses,
  onDone,
  onCancel,
}: {
  userId: string;
  editingId: string | null;
  addresses: UserAddress[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const existing = editingId ? addresses.find((a) => a.id === editingId) : null;

  const [form, setForm] = useState({
    full_name: existing?.full_name || "",
    phone: existing?.phone || "",
    address_line_1: existing?.address_line_1 || "",
    address_line_2: existing?.address_line_2 || "",
    landmark: existing?.landmark || "",
    city: existing?.city || "",
    state: existing?.state || "",
    postal_code: existing?.postal_code || "",
    is_default: existing?.is_default || addresses.length === 0,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (form.is_default) {
        await supabase.from("user_addresses").update({ is_default: false }).eq("user_id", userId);
      }

      if (editingId) {
        const { error } = await supabase
          .from("user_addresses")
          .update({ ...form, user_id: userId })
          .eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("user_addresses")
          .insert({ ...form, user_id: userId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingId ? "Address updated" : "Address added");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      className="space-y-2 rounded-xl border border-primary/30 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          required
          value={form.full_name}
          onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          placeholder="Full name"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <input
          required
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          placeholder="Phone"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </div>
      <input
        required
        value={form.address_line_1}
        onChange={(e) => setForm({ ...form, address_line_1: e.target.value })}
        placeholder="Address line 1"
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
      />
      <input
        value={form.address_line_2}
        onChange={(e) => setForm({ ...form, address_line_2: e.target.value })}
        placeholder="Address line 2 (optional)"
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
      />
      <div className="grid gap-2 sm:grid-cols-4">
        <input
          value={form.landmark}
          onChange={(e) => setForm({ ...form, landmark: e.target.value })}
          placeholder="Landmark"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <input
          required
          value={form.city}
          onChange={(e) => setForm({ ...form, city: e.target.value })}
          placeholder="City"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <input
          required
          value={form.state}
          onChange={(e) => setForm({ ...form, state: e.target.value })}
          placeholder="State"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <input
          required
          value={form.postal_code}
          onChange={(e) => setForm({ ...form, postal_code: e.target.value })}
          placeholder="Pincode"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </div>
      <label className="flex items-center gap-2 text-xs font-semibold">
        <input
          type="checkbox"
          checked={form.is_default}
          onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
          className="accent-[var(--primary)]"
        />
        Set as default address
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={save.isPending}
          className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : editingId ? "Update" : "Add address"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-border px-4 py-2 text-xs font-semibold transition hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
