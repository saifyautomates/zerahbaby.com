import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Megaphone,
  Sparkles,
  Save,
  Eye,
  Check,
  RotateCcw,
  Palette,
  ExternalLink,
  Power,
} from "lucide-react";

interface AnnouncementConfig {
  text: string;
  enabled: boolean;
  bgColor: string;
  textColor: string;
  link: string;
}

const PRESETS = [
  {
    label: "Free Delivery Offer",
    text: "✨ FREE delivery on all orders above ₹999 · Easy 7-day hassle-free returns ✨",
    bgColor: "#8B2020",
    textColor: "#FFFFFF",
  },
  {
    label: "Festive Mega Sale",
    text: "🎉 FESTIVE SALE: Flat 20% OFF on all Baby & Kids wear! Use code: FESTIVE20 🎉",
    bgColor: "#7C2D12",
    textColor: "#FEF08A",
  },
  {
    label: "New Arrivals Alert",
    text: "🍼 NEW ARRIVALS: Organic Cotton Baby Essentials & Strollers now in stock! 🛍️",
    bgColor: "#064E3B",
    textColor: "#ECFDF5",
  },
  {
    label: "Midnight Special",
    text: "🌙 MIDNIGHT EXCLUSIVE: Buy 2 Get 1 FREE on all Toys & Educational Games! 🧸",
    bgColor: "#1E1B4B",
    textColor: "#E0E7FF",
  },
];

const COLOR_PRESETS = [
  { name: "Brand Burgundy", bg: "#8B2020", text: "#FFFFFF" },
  { name: "Deep Navy", bg: "#0F172A", text: "#FFFFFF" },
  { name: "Forest Emerald", bg: "#064E3B", text: "#ECFDF5" },
  { name: "Warm Amber", bg: "#92400E", text: "#FEF3C7" },
  { name: "Royal Purple", bg: "#581C87", text: "#FAF5FF" },
  { name: "Rose Pink", bg: "#9D174D", text: "#FDF2F8" },
  { name: "Dark Slate", bg: "#18181B", text: "#F4F4F5" },
];

export function AnnouncementsManager() {
  const qc = useQueryClient();

  const { data: settings = {}, isLoading } = useQuery({
    queryKey: ["site_settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("site_settings").select("key, value");
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
    },
  });

  const [form, setForm] = useState<AnnouncementConfig>({
    text: "",
    enabled: true,
    bgColor: "#8B2020",
    textColor: "#FFFFFF",
    link: "",
  });

  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    if (!isLoading && settings && !hasLoaded) {
      setForm({
        text: settings["announcement"] ?? "Free delivery on orders above ₹999 · Easy 7-day returns",
        enabled: settings["announcement_enabled"] !== "false",
        bgColor: settings["announcement_bg"] || "#8B2020",
        textColor: settings["announcement_text_color"] || "#FFFFFF",
        link: settings["announcement_link"] || "",
      });
      setHasLoaded(true);
    }
  }, [settings, isLoading, hasLoaded]);

  const saveMutation = useMutation({
    mutationFn: async (config: AnnouncementConfig) => {
      const updates = [
        { key: "announcement", value: config.text },
        { key: "announcement_enabled", value: config.enabled ? "true" : "false" },
        { key: "announcement_bg", value: config.bgColor },
        { key: "announcement_text_color", value: config.textColor },
        { key: "announcement_link", value: config.link },
      ];

      const { error } = await supabase.from("site_settings").upsert(updates, { onConflict: "key" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Announcement banner settings updated successfully!");
      qc.invalidateQueries({ queryKey: ["site_settings"] });
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to update announcement");
    },
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(form);
  };

  const handleQuickPreset = (preset: (typeof PRESETS)[0]) => {
    setForm((prev) => ({
      ...prev,
      text: preset.text,
      bgColor: preset.bgColor,
      textColor: preset.textColor,
      enabled: true,
    }));
    toast.info(`Loaded "${preset.label}" template`);
  };

  const handleClear = () => {
    setForm((prev) => ({
      ...prev,
      text: "",
      enabled: false,
    }));
    toast.warning("Announcement cleared. Click Save to apply.");
  };

  if (isLoading && !hasLoaded) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-16">
      {/* Header Banner */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2.5 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            <Megaphone className="size-7 text-primary" />
            Announcement Header Banner
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Control the top announcement bar visible to every visitor across the website.
          </p>
        </div>

        {/* Global Status Pill */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition-all shadow-xs cursor-pointer ${
              form.enabled && form.text.trim()
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                : "bg-muted text-muted-foreground border border-border"
            }`}
          >
            <Power className="size-3.5" />
            {form.enabled && form.text.trim() ? "Active on Website" : "Hidden (Disabled)"}
          </button>
        </div>
      </div>

      {/* Live Preview Card */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <Eye className="size-4 text-primary" /> Live Website Preview
          </span>
          <span className="text-[11px] text-muted-foreground">
            {form.enabled && form.text.trim()
              ? "Showing in real-time"
              : "Currently collapsed (0px height)"}
          </span>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          {form.enabled && form.text.trim() ? (
            <div
              className="px-4 py-2.5 text-center transition-all"
              style={{ backgroundColor: form.bgColor, color: form.textColor }}
            >
              <div className="flex items-center justify-center gap-2 font-display text-xs sm:text-sm font-semibold tracking-wide">
                <Sparkles className="size-3.5 shrink-0 opacity-80" />
                <span>{form.text}</span>
                <Sparkles className="size-3.5 shrink-0 opacity-80" />
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-sm text-muted-foreground bg-muted/20 border-dashed">
              <p className="font-semibold text-foreground">Header is currently turned OFF</p>
              <p className="mt-1 text-xs text-muted-foreground">
                No space or bar is shown on the live website. Enable it below to show.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Main Settings Form */}
      <form onSubmit={handleSave} className="space-y-6 rounded-3xl border border-border bg-card p-6 shadow-sm">
        {/* Toggle Enable/Disable */}
        <div className="flex items-center justify-between border-b border-border/60 pb-5">
          <div className="space-y-0.5">
            <label htmlFor="banner-enabled-switch" className="text-sm font-bold text-foreground">
              Enable Announcement Banner
            </label>
            <p className="text-xs text-muted-foreground">
              When switched off, the bar completely disappears without taking any space.
            </p>
          </div>

          <button
            id="banner-enabled-switch"
            type="button"
            role="switch"
            aria-checked={form.enabled}
            onClick={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}
            className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
              form.enabled ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`pointer-events-none inline-block size-6 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                form.enabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {/* Text Input */}
        <div className="space-y-2">
          <label htmlFor="announcement-text" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Announcement Message / Text
          </label>
          <textarea
            id="announcement-text"
            rows={2}
            value={form.text}
            onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
            placeholder="e.g. Free shipping on orders above ₹1499! Use code: ZERAH20"
            className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm font-medium outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/60"
          />
          <p className="text-[11px] text-muted-foreground">
            Pro tip: You can use emojis (🎉, ✨, 🍼, 🧸) to make announcements stand out.
          </p>
        </div>

        {/* Optional Link */}
        <div className="space-y-2">
          <label htmlFor="announcement-link" className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <ExternalLink className="size-3.5" /> Optional Target URL / Page Link
          </label>
          <input
            id="announcement-link"
            type="text"
            value={form.link}
            onChange={(e) => setForm((f) => ({ ...f, link: e.target.value }))}
            placeholder="e.g. /shop or /product/123 or https://..."
            className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-medium outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {/* Colors Section */}
        <div className="space-y-4 border-t border-border/60 pt-5">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <Palette className="size-3.5 text-primary" /> Styling &amp; Colors
            </label>
          </div>

          {/* Color Presets */}
          <div className="flex flex-wrap gap-2">
            {COLOR_PRESETS.map((preset) => {
              const isSelected = form.bgColor === preset.bg && form.textColor === preset.text;
              return (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      bgColor: preset.bg,
                      textColor: preset.text,
                    }))
                  }
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition cursor-pointer ${
                    isSelected
                      ? "border-primary ring-2 ring-primary/20 shadow-xs"
                      : "border-border hover:border-border/80 bg-muted/40"
                  }`}
                >
                  <span
                    className="size-4 rounded-full border border-black/10 shadow-2xs shrink-0"
                    style={{ backgroundColor: preset.bg }}
                  />
                  <span>{preset.name}</span>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="bg-color-picker" className="text-xs font-semibold text-muted-foreground">
                Custom Background Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="bg-color-picker"
                  type="color"
                  value={form.bgColor}
                  onChange={(e) => setForm((f) => ({ ...f, bgColor: e.target.value }))}
                  className="size-10 cursor-pointer rounded-xl border border-border bg-transparent p-1"
                />
                <input
                  type="text"
                  value={form.bgColor}
                  onChange={(e) => setForm((f) => ({ ...f, bgColor: e.target.value }))}
                  className="w-28 rounded-xl border border-border bg-background px-3 py-2 text-xs font-mono uppercase outline-none focus:border-primary"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="text-color-picker" className="text-xs font-semibold text-muted-foreground">
                Custom Text Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="text-color-picker"
                  type="color"
                  value={form.textColor}
                  onChange={(e) => setForm((f) => ({ ...f, textColor: e.target.value }))}
                  className="size-10 cursor-pointer rounded-xl border border-border bg-transparent p-1"
                />
                <input
                  type="text"
                  value={form.textColor}
                  onChange={(e) => setForm((f) => ({ ...f, textColor: e.target.value }))}
                  className="w-28 rounded-xl border border-border bg-background px-3 py-2 text-xs font-mono uppercase outline-none focus:border-primary"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Ready-to-use Presets */}
        <div className="space-y-3 border-t border-border/60 pt-5">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Quick Ready-made Templates
          </span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => handleQuickPreset(preset)}
                className="flex flex-col items-start rounded-2xl border border-border bg-muted/20 p-3.5 text-left transition hover:bg-muted/50 hover:border-primary/40 cursor-pointer"
              >
                <span className="text-xs font-bold text-foreground">{preset.label}</span>
                <span className="mt-1 text-[11px] text-muted-foreground line-clamp-1">
                  {preset.text}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-6">
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-xs font-bold text-muted-foreground transition hover:bg-muted hover:text-foreground cursor-pointer"
          >
            <RotateCcw className="size-3.5" /> Clear / Turn Off
          </button>

          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="inline-flex items-center gap-2 rounded-2xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground shadow-md transition hover:opacity-90 active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {saveMutation.isPending ? (
              <>
                <div className="size-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                Saving...
              </>
            ) : (
              <>
                <Save className="size-4" />
                Save &amp; Publish Header
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
