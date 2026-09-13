import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Eye,
  Grid,
  Sliders,
  Sparkles,
  Search,
  Check,
  Package,
  Layers,
  Flame,
  Clock,
  Percent,
  Palette,
  Calendar,
  Image as ImageIcon,
  ChevronRight,
  RotateCcw,
  Sparkle,
  SlidersHorizontal,
} from "lucide-react";
import {
  type HomepageSection,
  type HomepageSectionType,
  type HomepageSectionSource,
  type SectionUpsertInput,
  useSaveSection,
  resolveSectionProducts,
} from "@/lib/homepage-sections";
import {
  THEME_PRESETS,
  CAMPAIGN_PRESETS,
  resolveSectionTheme,
  getPatternSvgDataUrl,
  isValidSafeColor,
  type ThemePresetId,
  type CardStyle,
  type PatternOverlay,
  type SpacingVariant,
  type ThemeConfig,
} from "@/lib/homepage-themes";
import { useCategories, useProducts, formatPrice, type Product } from "@/lib/store";
import { ProductCard } from "@/components/site/ProductCard";
import { ProductCarousel } from "@/components/site/ProductCarousel";
import { toast } from "sonner";

interface SectionEditorModalProps {
  section?: HomepageSection | null;
  onClose: () => void;
  onSuccess?: () => void;
}

type TabKey = "general" | "theme" | "products" | "display" | "schedule" | "preview";

export function SectionEditorModal({ section, onClose, onSuccess }: SectionEditorModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const origOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = origOverflow;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const isEditing = Boolean(section);
  const saveSection = useSaveSection();
  const { data: allProducts = [] } = useProducts(false);
  const { data: categories = [] } = useCategories();

  const [activeTab, setActiveTab] = useState<TabKey>("general");

  // Basic Info
  const [title, setTitle] = useState(section?.title || "");
  const [subtitle, setSubtitle] = useState(section?.subtitle || "");
  const [badgeText, setBadgeText] = useState(section?.badge_text || "");
  const [sectionType, setSectionType] = useState<HomepageSectionType>(
    section?.section_type || "PRODUCT_GRID",
  );
  const [spacing, setSpacing] = useState<SpacingVariant>(section?.spacing || "normal");
  const [isVisible, setIsVisible] = useState(section?.is_visible !== false);
  const [status, setStatus] = useState<"published" | "draft">(
    (section?.status as "published" | "draft") || "published",
  );

  // Theme & Appearance
  const [themePreset, setThemePreset] = useState<ThemePresetId>(section?.theme_preset || "DEFAULT");
  const [cardStyle, setCardStyle] = useState<CardStyle>(
    section?.theme_config?.card_style || "default",
  );
  const [patternOverlay, setPatternOverlay] = useState<PatternOverlay>(
    section?.theme_config?.pattern_overlay || "none",
  );
  const [customBgColor, setCustomBgColor] = useState(section?.theme_config?.bg_color || "");
  const [customHeadingColor, setCustomHeadingColor] = useState(
    section?.theme_config?.heading_color || "",
  );
  const [customTextColor, setCustomTextColor] = useState(section?.theme_config?.text_color || "");
  const [customAccentColor, setCustomAccentColor] = useState(
    section?.theme_config?.accent_color || "",
  );
  const [customCtaBg, setCustomCtaBg] = useState(section?.theme_config?.cta_bg || "");
  const [bgImageUrl, setBgImageUrl] = useState(section?.theme_config?.background_image_url || "");
  const [bgImageOpacity, setBgImageOpacity] = useState(
    section?.theme_config?.background_image_opacity ?? 0.15,
  );

  // Content / Source
  const [sourceType, setSourceType] = useState<HomepageSectionSource>(
    section?.source_type || "MANUAL",
  );
  const [categorySlug, setCategorySlug] = useState(section?.category_slug || "");

  // Display Settings
  const [maxProducts, setMaxProducts] = useState(section?.display_settings?.max_products ?? 8);
  const [showSubtitle, setShowSubtitle] = useState(
    section?.display_settings?.show_subtitle !== false,
  );
  const [showCta, setShowCta] = useState(section?.display_settings?.show_cta !== false);
  const [ctaLabel, setCtaLabel] = useState(section?.display_settings?.cta_label || "View all");
  const [ctaLink, setCtaLink] = useState(section?.display_settings?.cta_link || "/shop");

  // Scheduling
  const [enableSchedule, setEnableSchedule] = useState(
    Boolean(section?.starts_at || section?.ends_at),
  );
  const [startsAt, setStartsAt] = useState(
    section?.starts_at ? new Date(section.starts_at).toISOString().slice(0, 16) : "",
  );
  const [endsAt, setEndsAt] = useState(
    section?.ends_at ? new Date(section.ends_at).toISOString().slice(0, 16) : "",
  );

  // Selected products for MANUAL mode
  const initialProductIds = useMemo(() => {
    if (!section?.items) return [];
    return section.items.map((it) => it.product_id);
  }, [section]);

  const [selectedProductIds, setSelectedProductIds] = useState<string[]>(initialProductIds);
  const [productSearch, setProductSearch] = useState("");

  // Product map for quick lookup
  const productMap = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of allProducts) {
      map.set(p.uuid, p);
      map.set(p.id, p);
    }
    return map;
  }, [allProducts]);

  // Filtered available products to add
  const availableProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return allProducts
      .filter((p) => {
        const matchesQuery =
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q);
        const alreadySelected =
          selectedProductIds.includes(p.uuid) || selectedProductIds.includes(p.id);
        return matchesQuery && !alreadySelected;
      })
      .slice(0, 15);
  }, [allProducts, productSearch, selectedProductIds]);

  // Resolved list of selected products in manual order
  const selectedProducts = useMemo(() => {
    return selectedProductIds
      .map((id) => productMap.get(id))
      .filter((p): p is Product => Boolean(p));
  }, [selectedProductIds, productMap]);

  // Construct themeConfig object
  const currentThemeConfig: ThemeConfig = useMemo(
    () => ({
      bg_color: customBgColor.trim() || undefined,
      heading_color: customHeadingColor.trim() || undefined,
      text_color: customTextColor.trim() || undefined,
      accent_color: customAccentColor.trim() || undefined,
      cta_bg: customCtaBg.trim() || undefined,
      card_style: cardStyle,
      pattern_overlay: patternOverlay,
      background_image_url: bgImageUrl.trim() || undefined,
      background_image_opacity: bgImageOpacity,
    }),
    [
      customBgColor,
      customHeadingColor,
      customTextColor,
      customAccentColor,
      customCtaBg,
      cardStyle,
      patternOverlay,
      bgImageUrl,
      bgImageOpacity,
    ],
  );

  // Resolved theme for preview
  const resolvedTheme = useMemo(
    () => resolveSectionTheme(themePreset, currentThemeConfig),
    [themePreset, currentThemeConfig],
  );

  // Virtual section for live preview
  const previewSection: HomepageSection = useMemo(() => {
    return {
      id: section?.id || "preview-id",
      title: title || "Section Title Preview",
      subtitle: subtitle,
      slug: "preview",
      section_type: sectionType,
      source_type: sourceType,
      category_slug: categorySlug,
      status: status,
      is_visible: isVisible,
      sort_order: section?.sort_order ?? 0,
      theme_preset: themePreset,
      theme_config: currentThemeConfig,
      badge_text: badgeText || null,
      starts_at: enableSchedule && startsAt ? new Date(startsAt).toISOString() : null,
      ends_at: enableSchedule && endsAt ? new Date(endsAt).toISOString() : null,
      spacing: spacing,
      display_settings: {
        max_products: maxProducts,
        show_subtitle: showSubtitle,
        show_cta: showCta,
        cta_label: ctaLabel,
        cta_link: ctaLink,
      },
      items: selectedProductIds.map((pid, idx) => ({
        id: `prev-${pid}`,
        section_id: "preview-id",
        product_id: pid,
        sort_order: idx + 1,
        is_visible: true,
      })),
    };
  }, [
    section,
    title,
    subtitle,
    sectionType,
    sourceType,
    categorySlug,
    status,
    isVisible,
    themePreset,
    currentThemeConfig,
    badgeText,
    enableSchedule,
    startsAt,
    endsAt,
    spacing,
    maxProducts,
    showSubtitle,
    showCta,
    ctaLabel,
    ctaLink,
    selectedProductIds,
  ]);

  const previewProducts = useMemo(
    () => resolveSectionProducts(previewSection, allProducts),
    [previewSection, allProducts],
  );

  // Apply Campaign Quick Preset
  const applyCampaignPreset = (camp: (typeof CAMPAIGN_PRESETS)[0]) => {
    setTitle(camp.suggestedTitle);
    setSubtitle(camp.suggestedSubtitle);
    setBadgeText(camp.badge);
    setThemePreset(camp.themePreset);
    setCardStyle(camp.cardStyle);
    setPatternOverlay(camp.pattern);
    setCtaLabel(camp.ctaLabel);
    toast.success(`Applied "${camp.name}" campaign template`);
  };

  // Reordering products
  const moveProduct = (index: number, direction: "up" | "down") => {
    const newIdx = direction === "up" ? index - 1 : index + 1;
    if (newIdx < 0 || newIdx >= selectedProductIds.length) return;
    const next = [...selectedProductIds];
    const [moved] = next.splice(index, 1);
    next.splice(newIdx, 0, moved);
    setSelectedProductIds(next);
  };

  const removeProduct = (id: string) => {
    setSelectedProductIds((prev) => prev.filter((p) => p !== id));
  };

  const addProduct = (p: Product) => {
    const idToAdd = p.uuid || p.id;
    if (!selectedProductIds.includes(idToAdd)) {
      setSelectedProductIds((prev) => [...prev, idToAdd]);
    }
  };

  // Handle Save
  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("Please enter a section title");
      setActiveTab("general");
      return;
    }

    if (sourceType === "MANUAL" && selectedProductIds.length === 0) {
      toast.error("Please select at least one product for manual curation");
      setActiveTab("products");
      return;
    }

    const payload: SectionUpsertInput = {
      id: section?.id,
      title: title.trim(),
      subtitle: subtitle.trim(),
      section_type: sectionType,
      source_type: sourceType,
      category_slug: sourceType === "CATEGORY" ? categorySlug : null,
      status,
      is_visible: isVisible,
      sort_order: section?.sort_order,
      theme_preset: themePreset,
      theme_config: currentThemeConfig,
      badge_text: badgeText.trim() || null,
      starts_at: enableSchedule && startsAt ? new Date(startsAt).toISOString() : null,
      ends_at: enableSchedule && endsAt ? new Date(endsAt).toISOString() : null,
      spacing: spacing,
      display_settings: {
        max_products: maxProducts,
        show_subtitle: showSubtitle,
        show_cta: showCta,
        cta_label: ctaLabel.trim() || "View all",
        cta_link: ctaLink.trim() || "/shop",
      },
      product_ids: sourceType === "MANUAL" ? selectedProductIds : undefined,
    };

    try {
      await saveSection.mutateAsync(payload);
      onSuccess?.();
      onClose();
    } catch (err) {
      // Error handled by hook
    }
  };

  const patternSvg = getPatternSvgDataUrl(resolvedTheme.patternOverlay, resolvedTheme.accentColor);

  const modalContent = (
    <div
      id="section-editor-modal-overlay"
      className="fixed inset-0 z-[99999] isolate flex flex-col items-center justify-center bg-black/80 backdrop-blur-md p-2 sm:p-4 md:p-6 overflow-hidden select-text"
      role="dialog"
      aria-modal="true"
      aria-labelledby="section-editor-title"
    >
      <div
        id="section-editor-dialog-card"
        className="relative flex flex-col w-full max-w-5xl h-full max-h-[92dvh] sm:max-h-[90dvh] bg-background rounded-2xl sm:rounded-3xl border border-border shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - Fixed & Pinned at Top */}
        <div className="flex items-center justify-between border-b border-border px-4 sm:px-6 py-3.5 sm:py-4 bg-muted/40 shrink-0 select-none">
          <div className="min-w-0 pr-2">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
                <Palette className="h-4 w-4" />
              </span>
              <h2
                id="section-editor-title"
                className="text-base sm:text-lg font-bold text-foreground truncate"
              >
                {isEditing ? `Edit Section: ${section?.title}` : "Create Advanced Homepage Section"}
              </h2>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
              Configure per-section themes, festival campaigns, products, layout & scheduling
            </p>
          </div>
          <button
            type="button"
            id="section-editor-close-btn"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition shrink-0 cursor-pointer"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Navigation - Fixed & Pinned below Header */}
        <div className="flex items-center gap-1 border-b border-border bg-muted/20 px-3 sm:px-6 py-2 overflow-x-auto no-scrollbar shrink-0 select-none">
          <button
            onClick={() => setActiveTab("general")}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
              activeTab === "general"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Sliders className="h-3.5 w-3.5" />
            General
          </button>
          <button
            onClick={() => setActiveTab("theme")}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
              activeTab === "theme"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Palette className="h-3.5 w-3.5" />
            Theme & Appearance
          </button>
          <button
            onClick={() => setActiveTab("products")}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
              activeTab === "products"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Package className="h-3.5 w-3.5" />
            Products ({sourceType === "MANUAL" ? selectedProductIds.length : sourceType})
          </button>
          <button
            onClick={() => setActiveTab("display")}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
              activeTab === "display"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            CTA & Display
          </button>
          <button
            onClick={() => setActiveTab("schedule")}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
              activeTab === "schedule"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Calendar className="h-3.5 w-3.5" />
            Scheduling{" "}
            {enableSchedule && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
          </button>
          <button
            onClick={() => setActiveTab("preview")}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
              activeTab === "preview"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            Live Preview
          </button>
        </div>

        {/* Modal Body - Sole Scrollable Viewport */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6 space-y-6">
          {/* ──────────────── TAB 1: GENERAL ──────────────── */}
          {activeTab === "general" && (
            <div className="space-y-5 max-w-3xl">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Section Title <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. New Arrivals, Summer Picks, Baby Essentials"
                  className="w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm font-medium text-foreground focus-ring shadow-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Subtitle
                </label>
                <input
                  type="text"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="e.g. Fresh picks loved by parents across India"
                  className="w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm text-foreground focus-ring shadow-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Optional Badge / Pill Tag
                </label>
                <input
                  type="text"
                  value={badgeText}
                  onChange={(e) => setBadgeText(e.target.value)}
                  placeholder="e.g. ✨ DIWALI SPECIAL, 🔥 FLAT 40% OFF, 👶 NEW LAUNCH"
                  className="w-full rounded-2xl border border-input bg-background px-4 py-2.5 text-sm text-foreground focus-ring shadow-sm"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Renders an eye-catching decorative pill tag right above the section heading.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                    Section Layout Mode
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setSectionType("PRODUCT_GRID")}
                      className={`flex flex-col items-center justify-center p-4 rounded-2xl border transition text-center ${
                        sectionType === "PRODUCT_GRID"
                          ? "border-primary bg-primary/5 text-primary font-bold shadow-sm"
                          : "border-border hover:bg-muted/40 text-muted-foreground"
                      }`}
                    >
                      <Grid className="h-5 w-5 mb-2" />
                      <span className="text-xs">Responsive Grid</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSectionType("PRODUCT_CAROUSEL")}
                      className={`flex flex-col items-center justify-center p-4 rounded-2xl border transition text-center ${
                        sectionType === "PRODUCT_CAROUSEL"
                          ? "border-primary bg-primary/5 text-primary font-bold shadow-sm"
                          : "border-border hover:bg-muted/40 text-muted-foreground"
                      }`}
                    >
                      <Layers className="h-5 w-5 mb-2" />
                      <span className="text-xs">Touch Carousel</span>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                    Vertical Spacing
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(["compact", "normal", "spacious"] as SpacingVariant[]).map((sp) => (
                      <button
                        key={sp}
                        type="button"
                        onClick={() => setSpacing(sp)}
                        className={`py-3 px-2 rounded-2xl border text-center text-xs font-medium capitalize transition ${
                          spacing === sp
                            ? "border-primary bg-primary/5 text-primary font-bold shadow-sm"
                            : "border-border hover:bg-muted/40 text-muted-foreground"
                        }`}
                      >
                        {sp}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-2">
                    Controls the top and bottom padding of this section on the storefront.
                  </p>
                </div>
              </div>

              {/* Visibility & Status */}
              <div className="pt-4 border-t border-border flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isVisible}
                    onChange={(e) => setIsVisible(e.target.checked)}
                    className="h-4 w-4 rounded text-primary focus-ring"
                  />
                  <div>
                    <span className="text-sm font-semibold text-foreground">
                      Visible on Storefront
                    </span>
                    <p className="text-xs text-muted-foreground">
                      If unchecked, hidden from public customers
                    </p>
                  </div>
                </label>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase text-muted-foreground">Status:</span>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="rounded-xl border border-input bg-background px-3 py-1.5 text-xs font-semibold focus-ring"
                  >
                    <option value="published">Published</option>
                    <option value="draft">Draft (Admin only)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* ──────────────── TAB 2: THEMES & APPEARANCE ──────────────── */}
          {activeTab === "theme" && (
            <div className="space-y-7">
              {/* Campaign Quick Presets */}
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                    Festival & Campaign Quick Templates
                  </label>
                  <span className="text-[11px] text-muted-foreground">
                    Click to apply full theme, title & badges
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2 sm:gap-2.5">
                  {CAMPAIGN_PRESETS.map((camp) => (
                    <button
                      key={camp.id}
                      type="button"
                      onClick={() => applyCampaignPreset(camp)}
                      className="flex flex-col items-start p-2.5 sm:p-3 rounded-2xl border border-border bg-card hover:border-amber-400/80 hover:bg-amber-50/20 dark:hover:bg-amber-950/20 text-left transition group shadow-sm min-w-0"
                    >
                      <span className="text-xs font-bold text-foreground group-hover:text-amber-600 transition truncate w-full">
                        {camp.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
                        {camp.badge}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Theme Presets */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                  1. Visual Theme Presets
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">
                  {Object.values(THEME_PRESETS).map((p) => {
                    const isSelected = themePreset === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setThemePreset(p.id)}
                        className={`flex flex-col p-3 rounded-2xl border text-left transition relative overflow-hidden group shadow-sm ${
                          isSelected
                            ? "border-primary ring-2 ring-primary/20 shadow-md"
                            : "border-border hover:border-border/80 hover:bg-muted/30"
                        }`}
                        style={{
                          backgroundColor: p.defaults.bg_color,
                          backgroundImage: p.defaults.bg_gradient,
                        }}
                      >
                        {isSelected && (
                          <span className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                            <Check className="h-3 w-3" />
                          </span>
                        )}
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span
                            className="h-3 w-3 rounded-full border border-black/10 shadow-xs shrink-0"
                            style={{ backgroundColor: p.defaults.accent_color }}
                          />
                          <span
                            className="text-xs font-bold truncate"
                            style={{ color: p.defaults.heading_color }}
                          >
                            {p.name}
                          </span>
                        </div>
                        <p
                          className="text-[10px] line-clamp-2 leading-tight"
                          style={{ color: p.defaults.text_color }}
                        >
                          {p.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Card Treatment & Pattern Overlays */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-4 border-t border-border">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                    2. Product Card Treatment
                  </label>
                  <div className="grid grid-cols-2 gap-2.5">
                    {(
                      [
                        { id: "default", label: "Classic Card", desc: "Clean rounded card" },
                        { id: "minimal", label: "Minimalist", desc: "Borderless floating" },
                        { id: "premium", label: "Editorial Gold", desc: "Ambient gold rim" },
                        { id: "festive", label: "Festive Gala", desc: "Celebratory gold ring" },
                      ] as const
                    ).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setCardStyle(c.id)}
                        className={`p-3 rounded-2xl border text-left transition ${
                          cardStyle === c.id
                            ? "border-primary bg-primary/5 text-primary font-bold shadow-sm"
                            : "border-border hover:bg-muted/30 text-foreground"
                        }`}
                      >
                        <div className="text-xs font-bold">{c.label}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{c.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                    3. Decorative Pattern Overlay
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { id: "none", label: "None" },
                        { id: "sparkles", label: "Sparkles" },
                        { id: "dots", label: "Dots" },
                        { id: "stars", label: "Stars" },
                        { id: "mandala", label: "Mandala" },
                        { id: "confetti", label: "Confetti" },
                      ] as const
                    ).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPatternOverlay(p.id)}
                        className={`py-2 px-2.5 rounded-xl border text-center text-xs transition ${
                          patternOverlay === p.id
                            ? "border-primary bg-primary/5 text-primary font-bold shadow-sm"
                            : "border-border hover:bg-muted/30 text-muted-foreground"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-2">
                    Adds a subtle festive SVG texture behind the section cards.
                  </p>
                </div>
              </div>

              {/* Custom Color Overrides */}
              <div className="pt-4 border-t border-border">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    4. Optional Custom Color Overrides
                  </label>
                  {(customBgColor ||
                    customHeadingColor ||
                    customTextColor ||
                    customAccentColor ||
                    customCtaBg) && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomBgColor("");
                        setCustomHeadingColor("");
                        setCustomTextColor("");
                        setCustomAccentColor("");
                        setCustomCtaBg("");
                      }}
                      className="text-[11px] text-destructive hover:underline flex items-center gap-1"
                    >
                      <RotateCcw className="h-3 w-3" /> Reset overrides
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                      Background
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={customBgColor || resolvedTheme.bgColor}
                        onChange={(e) => setCustomBgColor(e.target.value)}
                        className="h-8 w-8 rounded-lg cursor-pointer border border-border p-0.5"
                      />
                      <input
                        type="text"
                        value={customBgColor}
                        onChange={(e) => setCustomBgColor(e.target.value)}
                        placeholder="Auto"
                        className="w-full text-xs font-mono rounded-lg border border-input px-2 py-1.5 bg-background"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                      Heading Text
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={customHeadingColor || resolvedTheme.headingColor}
                        onChange={(e) => setCustomHeadingColor(e.target.value)}
                        className="h-8 w-8 rounded-lg cursor-pointer border border-border p-0.5"
                      />
                      <input
                        type="text"
                        value={customHeadingColor}
                        onChange={(e) => setCustomHeadingColor(e.target.value)}
                        placeholder="Auto"
                        className="w-full text-xs font-mono rounded-lg border border-input px-2 py-1.5 bg-background"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                      Body Text
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={customTextColor || resolvedTheme.textColor}
                        onChange={(e) => setCustomTextColor(e.target.value)}
                        className="h-8 w-8 rounded-lg cursor-pointer border border-border p-0.5"
                      />
                      <input
                        type="text"
                        value={customTextColor}
                        onChange={(e) => setCustomTextColor(e.target.value)}
                        placeholder="Auto"
                        className="w-full text-xs font-mono rounded-lg border border-input px-2 py-1.5 bg-background"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                      Accent & Badge
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={customAccentColor || resolvedTheme.accentColor}
                        onChange={(e) => setCustomAccentColor(e.target.value)}
                        className="h-8 w-8 rounded-lg cursor-pointer border border-border p-0.5"
                      />
                      <input
                        type="text"
                        value={customAccentColor}
                        onChange={(e) => setCustomAccentColor(e.target.value)}
                        placeholder="Auto"
                        className="w-full text-xs font-mono rounded-lg border border-input px-2 py-1.5 bg-background"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                      CTA Button
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={customCtaBg || resolvedTheme.ctaBg}
                        onChange={(e) => setCustomCtaBg(e.target.value)}
                        className="h-8 w-8 rounded-lg cursor-pointer border border-border p-0.5"
                      />
                      <input
                        type="text"
                        value={customCtaBg}
                        onChange={(e) => setCustomCtaBg(e.target.value)}
                        placeholder="Auto"
                        className="w-full text-xs font-mono rounded-lg border border-input px-2 py-1.5 bg-background"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Background Image */}
              <div className="pt-4 border-t border-border">
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                  5. Optional Background Image URL
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="url"
                    value={bgImageUrl}
                    onChange={(e) => setBgImageUrl(e.target.value)}
                    placeholder="https://.../festival-background.jpg"
                    className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-xs text-foreground focus-ring"
                  />
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">Opacity:</span>
                    <input
                      type="range"
                      min="0.05"
                      max="1.0"
                      step="0.05"
                      value={bgImageOpacity}
                      onChange={(e) => setBgImageOpacity(parseFloat(e.target.value))}
                      className="w-20"
                    />
                    <span className="text-xs font-mono w-8">
                      {Math.round(bgImageOpacity * 100)}%
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ──────────────── TAB 3: PRODUCTS ──────────────── */}
          {activeTab === "products" && (
            <div className="space-y-6">
              {/* Source Mode */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                  Product Source Engine
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  {[
                    { id: "MANUAL", label: "Manual Handpick", desc: "Curate specific products" },
                    { id: "BESTSELLERS", label: "Bestsellers", desc: "Top rated catalog items" },
                    { id: "NEW_ARRIVALS", label: "New Arrivals", desc: "Latest additions" },
                    {
                      id: "DISCOUNTED",
                      label: "Deals & Offers",
                      desc: "Items with active discount",
                    },
                    { id: "CATEGORY", label: "Category Filter", desc: "Filter by single category" },
                  ].map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSourceType(s.id as any)}
                      className={`p-3 rounded-2xl border text-left transition ${
                        sourceType === s.id
                          ? "border-primary bg-primary/5 text-primary font-bold shadow-sm"
                          : "border-border hover:bg-muted/30 text-foreground"
                      }`}
                    >
                      <div className="text-xs font-bold">{s.label}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{s.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {sourceType === "CATEGORY" && (
                <div className="p-4 rounded-2xl border border-border bg-muted/20">
                  <label className="block text-xs font-bold uppercase text-muted-foreground mb-1.5">
                    Select Target Category
                  </label>
                  <select
                    value={categorySlug}
                    onChange={(e) => setCategorySlug(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm font-medium focus-ring"
                  >
                    <option value="">-- Choose Category --</option>
                    {categories.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name} ({c.slug})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {sourceType === "MANUAL" && (
                <div className="space-y-4">
                  {/* Search and Catalog Picker */}
                  <div className="p-4 rounded-2xl border border-border bg-muted/10 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Search & Add From Catalog
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {allProducts.length} products available
                      </span>
                    </div>

                    <div className="relative">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <input
                        type="text"
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        placeholder="Search catalog by product name, SKU, or category..."
                        className="w-full rounded-xl border border-input bg-background pl-10 pr-4 py-2.5 text-xs text-foreground focus-ring"
                      />
                    </div>

                    {availableProducts.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-1 border border-border/50 rounded-xl bg-background">
                        {availableProducts.map((p) => (
                          <div
                            key={p.id}
                            className="flex items-center justify-between gap-2 p-2 rounded-lg border border-border/40 hover:bg-muted/40 transition"
                          >
                            <div className="flex items-center gap-2 overflow-hidden">
                              <img
                                src={p.image || ""}
                                alt={p.name}
                                className="h-8 w-8 rounded-md object-cover bg-muted shrink-0"
                              />
                              <div className="truncate text-left">
                                <div className="text-xs font-semibold text-foreground truncate">
                                  {p.name}
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                  {formatPrice(p.price)} · Stock: {p.stock}
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => addProduct(p)}
                              className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition shrink-0"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Curated Products List */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Curated Products & Ordering ({selectedProducts.length})
                      </span>
                      {selectedProducts.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setSelectedProductIds([])}
                          className="text-[11px] text-destructive hover:underline"
                        >
                          Remove all
                        </button>
                      )}
                    </div>

                    {selectedProducts.length === 0 ? (
                      <div className="p-8 rounded-2xl border border-dashed border-border text-center text-muted-foreground text-xs">
                        No products curated yet. Use the catalog search above to add items.
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                        {selectedProducts.map((p, idx) => (
                          <div
                            key={p.id}
                            className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-border bg-card shadow-xs"
                          >
                            <div className="flex items-center gap-3 overflow-hidden">
                              <span className="text-xs font-mono font-bold text-muted-foreground w-5 text-center shrink-0">
                                {idx + 1}
                              </span>
                              <img
                                src={p.image || ""}
                                alt={p.name}
                                className="h-9 w-9 rounded-lg object-cover bg-muted shrink-0"
                              />
                              <div className="truncate">
                                <div className="text-xs font-bold text-foreground truncate">
                                  {p.name}
                                </div>
                                <div className="text-[11px] text-muted-foreground">
                                  {formatPrice(p.price)} · SKU: {p.sku}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => moveProduct(idx, "up")}
                                disabled={idx === 0}
                                className="h-7 w-7 flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-30"
                              >
                                <ArrowUp className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => moveProduct(idx, "down")}
                                disabled={idx === selectedProducts.length - 1}
                                className="h-7 w-7 flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-30"
                              >
                                <ArrowDown className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeProduct(p.uuid || p.id)}
                                className="h-7 w-7 flex items-center justify-center rounded-lg text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ──────────────── TAB 4: CTA & DISPLAY ──────────────── */}
          {activeTab === "display" && (
            <div className="space-y-5 max-w-2xl">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
                  Maximum Products Displayed:{" "}
                  <span className="font-mono text-primary font-bold">{maxProducts}</span>
                </label>
                <input
                  type="range"
                  min="2"
                  max="24"
                  step="2"
                  value={maxProducts}
                  onChange={(e) => setMaxProducts(parseInt(e.target.value))}
                  className="w-full mt-2"
                />
                <div className="flex justify-between text-[11px] text-muted-foreground mt-1">
                  <span>2 items</span>
                  <span>12 items</span>
                  <span>24 items</span>
                </div>
              </div>

              <div className="pt-4 border-t border-border space-y-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showSubtitle}
                    onChange={(e) => setShowSubtitle(e.target.checked)}
                    className="h-4 w-4 rounded text-primary focus-ring"
                  />
                  <span className="text-sm font-medium text-foreground">
                    Render Subtitle on Storefront
                  </span>
                </label>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showCta}
                    onChange={(e) => setShowCta(e.target.checked)}
                    className="h-4 w-4 rounded text-primary focus-ring"
                  />
                  <span className="text-sm font-medium text-foreground">
                    Render CTA Button ("View all")
                  </span>
                </label>

                {showCta && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-7 pt-2">
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1">
                        CTA Button Label
                      </label>
                      <input
                        type="text"
                        value={ctaLabel}
                        onChange={(e) => setCtaLabel(e.target.value)}
                        placeholder="View all"
                        className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs font-semibold focus-ring"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1">
                        CTA Destination Route
                      </label>
                      <input
                        type="text"
                        value={ctaLink}
                        onChange={(e) => setCtaLink(e.target.value)}
                        placeholder="/shop"
                        className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs font-semibold focus-ring"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ──────────────── TAB 5: SCHEDULING ──────────────── */}
          {activeTab === "schedule" && (
            <div className="space-y-5 max-w-2xl">
              <label className="flex items-center gap-3 cursor-pointer p-4 rounded-2xl border border-border bg-muted/20">
                <input
                  type="checkbox"
                  checked={enableSchedule}
                  onChange={(e) => setEnableSchedule(e.target.checked)}
                  className="h-5 w-5 rounded text-primary focus-ring"
                />
                <div>
                  <span className="text-sm font-bold text-foreground">
                    Enable Automated Campaign Scheduling
                  </span>
                  <p className="text-xs text-muted-foreground">
                    Section automatically appears and vanishes according to configured start & end
                    timestamps.
                  </p>
                </div>
              </label>

              {enableSchedule && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                      Campaign Starts At
                    </label>
                    <input
                      type="datetime-local"
                      value={startsAt}
                      onChange={(e) => setStartsAt(e.target.value)}
                      className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus-ring"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Leave empty to activate immediately
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                      Campaign Ends At
                    </label>
                    <input
                      type="datetime-local"
                      value={endsAt}
                      onChange={(e) => setEndsAt(e.target.value)}
                      className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus-ring"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Leave empty for no automatic expiry
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ──────────────── TAB 6: LIVE PREVIEW ──────────────── */}
          {activeTab === "preview" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Rendering real-time section canvas with resolved theme, cards & styles</span>
                <span className="font-semibold text-primary">
                  {previewProducts.length} items · {themePreset} Theme · {cardStyle} Cards
                </span>
              </div>

              {/* Preview Container */}
              <div
                className={`relative rounded-3xl border border-border/80 overflow-hidden transition-all duration-300 p-6 sm:p-8 ${
                  spacing === "compact"
                    ? "py-6 sm:py-8"
                    : spacing === "spacious"
                      ? "py-12 sm:py-16"
                      : "py-8 sm:py-10"
                }`}
                style={resolvedTheme.containerStyle}
              >
                {/* SVG Pattern Overlay */}
                {patternSvg && (
                  <div
                    className="pointer-events-none absolute inset-0 z-0 opacity-100"
                    style={{ backgroundImage: `url("${patternSvg}")` }}
                  />
                )}

                {/* Background Image Overlay */}
                {resolvedTheme.backgroundImageUrl && (
                  <div
                    className="pointer-events-none absolute inset-0 z-0 bg-cover bg-center"
                    style={{
                      backgroundImage: `url("${resolvedTheme.backgroundImageUrl}")`,
                      opacity: resolvedTheme.backgroundImageOpacity,
                    }}
                  />
                )}

                <div className="relative z-10 max-w-7xl mx-auto">
                  {/* Header Row */}
                  <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-6 sm:mb-8 gap-4">
                    <div>
                      {badgeText && (
                        <span
                          className="inline-block px-3 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-wider mb-2.5 shadow-xs"
                          style={{
                            backgroundColor: resolvedTheme.badgeBg,
                            color: resolvedTheme.badgeTextColor,
                          }}
                        >
                          {badgeText}
                        </span>
                      )}
                      <h3
                        className="text-2xl sm:text-3xl font-display font-extrabold tracking-tight"
                        style={{ color: resolvedTheme.headingColor }}
                      >
                        {title || "Section Title"}
                      </h3>
                      {showSubtitle && subtitle && (
                        <p
                          className="text-sm sm:text-base mt-1.5"
                          style={{ color: resolvedTheme.textColor }}
                        >
                          {subtitle}
                        </p>
                      )}
                    </div>

                    {showCta && (
                      <button
                        type="button"
                        className="self-start sm:self-auto px-5 py-2.5 rounded-full text-xs font-bold transition shadow-xs"
                        style={{
                          backgroundColor: resolvedTheme.ctaBg,
                          color: resolvedTheme.ctaText,
                        }}
                      >
                        {ctaLabel} →
                      </button>
                    )}
                  </div>

                  {/* Products Presentation */}
                  {previewProducts.length === 0 ? (
                    <div className="p-8 text-center text-sm border border-dashed rounded-2xl opacity-60">
                      No products match this selection yet.
                    </div>
                  ) : sectionType === "PRODUCT_CAROUSEL" ? (
                    <ProductCarousel products={previewProducts} cardStyle={cardStyle} />
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-6">
                      {previewProducts.map((prod) => (
                        <ProductCard key={prod.id} product={prod} cardStyle={cardStyle} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions - Fixed & Pinned at Bottom */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 sm:px-6 py-3 sm:py-4 bg-muted/30 shrink-0 select-none">
          <div className="flex items-center gap-2">
            <span
              className="h-3 w-3 rounded-full border border-black/10 shrink-0"
              style={{ backgroundColor: resolvedTheme.bgColor }}
            />
            <span className="text-xs text-muted-foreground font-medium truncate">
              Theme: <span className="text-foreground font-bold">{themePreset}</span>
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 sm:px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted rounded-xl transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saveSection.isPending}
              className="flex items-center justify-center gap-2 px-4 sm:px-6 py-2.5 text-xs font-bold text-primary-foreground bg-primary hover:bg-primary/95 rounded-xl shadow-sm transition disabled:opacity-50 cursor-pointer min-h-[38px]"
            >
              {saveSection.isPending ? "Saving to Supabase..." : "Save & Publish Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (!mounted || typeof document === "undefined") {
    return null;
  }

  return createPortal(modalContent, document.body);
}
