import { useState, useMemo } from "react";
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
} from "lucide-react";
import {
  type HomepageSection,
  type HomepageSectionType,
  type HomepageSectionSource,
  type SectionUpsertInput,
  useSaveSection,
  resolveSectionProducts,
} from "@/lib/homepage-sections";
import { useCategories, useProducts, formatPrice, type Product } from "@/lib/store";
import { ProductCard } from "@/components/site/ProductCard";
import { ProductCarousel } from "@/components/site/ProductCarousel";
import { toast } from "sonner";

interface SectionEditorModalProps {
  section?: HomepageSection | null; // If null/undefined, creating a new section
  onClose: () => void;
  onSuccess?: () => void;
}

export function SectionEditorModal({ section, onClose, onSuccess }: SectionEditorModalProps) {
  const isEditing = Boolean(section);
  const saveSection = useSaveSection();
  const { data: allProducts = [] } = useProducts(false);
  const { data: categories = [] } = useCategories();

  // Form states
  const [title, setTitle] = useState(section?.title || "");
  const [subtitle, setSubtitle] = useState(section?.subtitle || "");
  const [sectionType, setSectionType] = useState<HomepageSectionType>(
    section?.section_type || "PRODUCT_GRID",
  );
  const [sourceType, setSourceType] = useState<HomepageSectionSource>(
    section?.source_type || "MANUAL",
  );
  const [categorySlug, setCategorySlug] = useState(section?.category_slug || "");
  const [isVisible, setIsVisible] = useState(section?.is_visible !== false);
  const [status, setStatus] = useState<"published" | "draft">(
    (section?.status as "published" | "draft") || "published",
  );
  const [maxProducts, setMaxProducts] = useState(section?.display_settings?.max_products ?? 8);
  const [showSubtitle, setShowSubtitle] = useState(
    section?.display_settings?.show_subtitle !== false,
  );
  const [showCta, setShowCta] = useState(section?.display_settings?.show_cta !== false);
  const [ctaLabel, setCtaLabel] = useState(section?.display_settings?.cta_label || "View all");
  const [ctaLink, setCtaLink] = useState(section?.display_settings?.cta_link || "/shop");

  // Selected products for MANUAL mode
  const initialProductIds = useMemo(() => {
    if (!section?.items) return [];
    return section.items.map((it) => it.product_id);
  }, [section]);

  const [selectedProductIds, setSelectedProductIds] = useState<string[]>(initialProductIds);

  // Search filter for product picker
  const [productSearch, setProductSearch] = useState("");
  const [previewMode, setPreviewMode] = useState(false);

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

  // Selected product objects in order
  const selectedProducts = useMemo(() => {
    return selectedProductIds
      .map((id) => productMap.get(id))
      .filter((p): p is Product => Boolean(p));
  }, [selectedProductIds, productMap]);

  // Reorder products in manual list
  const moveProduct = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= selectedProductIds.length) return;

    const copy = [...selectedProductIds];
    const temp = copy[index];
    copy[index] = copy[targetIndex];
    copy[targetIndex] = temp;
    setSelectedProductIds(copy);
  };

  const removeProduct = (id: string) => {
    setSelectedProductIds((prev) => prev.filter((pId) => pId !== id));
  };

  const addProduct = (product: Product) => {
    const idToAdd = product.uuid || product.id;
    if (!selectedProductIds.includes(idToAdd)) {
      setSelectedProductIds((prev) => [...prev, idToAdd]);
    }
  };

  // Build draft section for live preview
  const previewSection: HomepageSection = useMemo(() => {
    return {
      id: section?.id || "preview-temp",
      title: title || "Section Title",
      subtitle: subtitle,
      slug: section?.slug || "preview-slug",
      section_type: sectionType,
      source_type: sourceType,
      category_slug: categorySlug,
      status: status,
      is_visible: isVisible,
      sort_order: section?.sort_order ?? 1,
      display_settings: {
        max_products: maxProducts,
        show_subtitle: showSubtitle,
        show_cta: showCta,
        cta_label: ctaLabel,
        cta_link: ctaLink,
      },
      items: selectedProductIds.map((pId, idx) => ({
        id: `item-${idx}`,
        section_id: section?.id || "preview-temp",
        product_id: pId,
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
    maxProducts,
    showSubtitle,
    showCta,
    ctaLabel,
    ctaLink,
    selectedProductIds,
  ]);

  const previewProducts = useMemo(() => {
    return resolveSectionProducts(previewSection, allProducts);
  }, [previewSection, allProducts]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Section title cannot be empty");
      return;
    }

    if (sourceType === "CATEGORY" && !categorySlug) {
      toast.error("Please select a category for this section");
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
      display_settings: {
        max_products: maxProducts,
        show_subtitle: showSubtitle,
        show_cta: showCta,
        cta_label: ctaLabel.trim() || "View all",
        cta_link: ctaLink.trim() || "/shop",
      },
      product_ids: sourceType === "MANUAL" ? selectedProductIds : [],
    };

    try {
      await saveSection.mutateAsync(payload);
      onSuccess?.();
      onClose();
    } catch {
      // toast is triggered by hook
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-3xl border border-border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Layers className="size-4.5" />
            </span>
            <div>
              <h2 className="text-base font-bold text-foreground">
                {isEditing ? `Edit Section: ${section?.title}` : "Create New Homepage Section"}
              </h2>
              <p className="text-xs text-muted-foreground">
                Configure content, product curation, and display layout
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPreviewMode(!previewMode)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition border ${
                previewMode
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:text-foreground"
              }`}
            >
              <Eye className="size-3.5" /> {previewMode ? "Exit Preview" : "Preview"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {previewMode ? (
            /* Live Preview View */
            <div className="space-y-6 rounded-2xl border border-dashed border-primary/30 p-6 bg-background/50">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
                <div>
                  <h3 className="font-display text-2xl font-bold text-foreground">
                    {previewSection.title}
                  </h3>
                  {previewSection.display_settings.show_subtitle && previewSection.subtitle && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {previewSection.subtitle}
                    </p>
                  )}
                </div>
                {previewSection.display_settings.show_cta && (
                  <span className="text-sm font-semibold text-primary underline">
                    {previewSection.display_settings.cta_label}
                  </span>
                )}
              </div>

              {previewProducts.length === 0 ? (
                <div className="py-12 text-center rounded-2xl border border-dashed border-border bg-card/40">
                  <Package className="size-8 mx-auto text-muted-foreground/50 mb-2" />
                  <p className="text-sm font-semibold text-foreground">No products to display</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {sourceType === "MANUAL"
                      ? "Add products in the manual selection list below."
                      : "No products matched this automated catalog rule."}
                  </p>
                </div>
              ) : sectionType === "PRODUCT_CAROUSEL" ? (
                <ProductCarousel products={previewProducts} />
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
                  {previewProducts.map((p) => (
                    <ProductCard key={p.id} product={p} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Editing Form */
            <form id="section-form" onSubmit={handleSave} className="space-y-6">
              {/* Basic Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1.5">
                    Section Title <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Bestsellers, Summer Picks, Trending Now"
                    className="w-full rounded-2xl border border-border bg-background px-4 py-2.5 text-sm font-medium focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-foreground mb-1.5">
                    Subtitle (Optional)
                  </label>
                  <input
                    type="text"
                    value={subtitle}
                    onChange={(e) => setSubtitle(e.target.value)}
                    placeholder="e.g. Top picks loved by parents across India"
                    className="w-full rounded-2xl border border-border bg-background px-4 py-2.5 text-sm font-medium focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              {/* Layout & Source Type */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border/60">
                {/* Section Layout Type */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1.5">
                    Display Layout
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSectionType("PRODUCT_GRID")}
                      className={`flex items-center justify-center gap-2 p-3 rounded-2xl border text-xs font-bold transition cursor-pointer ${
                        sectionType === "PRODUCT_GRID"
                          ? "border-primary bg-primary/10 text-primary shadow-sm"
                          : "border-border bg-background text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Grid className="size-4" /> Grid
                    </button>
                    <button
                      type="button"
                      onClick={() => setSectionType("PRODUCT_CAROUSEL")}
                      className={`flex items-center justify-center gap-2 p-3 rounded-2xl border text-xs font-bold transition cursor-pointer ${
                        sectionType === "PRODUCT_CAROUSEL"
                          ? "border-primary bg-primary/10 text-primary shadow-sm"
                          : "border-border bg-background text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Sliders className="size-4" /> Carousel
                    </button>
                  </div>
                </div>

                {/* Section Source Type */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1.5">
                    Product Source
                  </label>
                  <select
                    value={sourceType}
                    onChange={(e) => setSourceType(e.target.value as HomepageSectionSource)}
                    className="w-full rounded-2xl border border-border bg-background px-4 py-2.5 text-sm font-medium focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="MANUAL">Manual Curated Selection</option>
                    <option value="BESTSELLERS">Auto: Bestsellers (Most Reviewed)</option>
                    <option value="NEW_ARRIVALS">Auto: New Arrivals</option>
                    <option value="DISCOUNTED">Auto: Deals & Highest Discounts</option>
                    <option value="CATEGORY">Auto: By Specific Category</option>
                  </select>
                </div>
              </div>

              {/* Category Selector (if source is CATEGORY) */}
              {sourceType === "CATEGORY" && (
                <div className="p-4 rounded-2xl bg-secondary/30 border border-border space-y-2">
                  <label className="block text-xs font-bold text-foreground">
                    Select Category
                  </label>
                  <select
                    value={categorySlug}
                    onChange={(e) => setCategorySlug(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">-- Choose Category --</option>
                    {categories.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* MANUAL PRODUCT CURATION AREA */}
              {sourceType === "MANUAL" && (
                <div className="space-y-4 pt-2 border-t border-border/60">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
                        Curated Products ({selectedProducts.length})
                      </h4>
                      <p className="text-[11px] text-muted-foreground">
                        Select and reorder products to appear in this section
                      </p>
                    </div>
                  </div>

                  {/* Selected Products List */}
                  {selectedProducts.length === 0 ? (
                    <div className="p-6 text-center rounded-2xl border border-dashed border-border bg-muted/10">
                      <p className="text-xs text-muted-foreground">
                        No products added yet. Use the catalog search below to add products.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                      {selectedProducts.map((prod, idx) => (
                        <div
                          key={prod.id}
                          className="flex items-center justify-between gap-3 p-2.5 rounded-2xl border border-border bg-background/80 hover:bg-muted/40 transition"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-[11px] font-bold text-muted-foreground w-4 text-center">
                              {idx + 1}
                            </span>
                            <div className="size-10 rounded-xl overflow-hidden bg-muted shrink-0 border border-border/50">
                              <img
                                src={prod.image || prod.imageUrl || ""}
                                alt={prod.name}
                                className="size-full object-cover"
                              />
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-foreground truncate">{prod.name}</p>
                              <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                                <span>{formatPrice(prod.price)}</span>
                                <span>•</span>
                                <span>Stock: {prod.stock}</span>
                                <span>•</span>
                                <span className="font-mono">{prod.sku}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => moveProduct(idx, "up")}
                              aria-label="Move product up"
                              className="size-7 grid place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                            >
                              <ArrowUp className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === selectedProducts.length - 1}
                              onClick={() => moveProduct(idx, "down")}
                              aria-label="Move product down"
                              className="size-7 grid place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                            >
                              <ArrowDown className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeProduct(prod.uuid || prod.id)}
                              aria-label="Remove product from section"
                              className="size-7 grid place-items-center rounded-lg text-destructive hover:bg-destructive/10 transition"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add Products from Catalog */}
                  <div className="p-4 rounded-2xl border border-border bg-muted/20 space-y-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                      <input
                        type="text"
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        placeholder="Search products by name, SKU, or category to add..."
                        className="w-full rounded-xl border border-border bg-background pl-8 pr-3 py-2 text-xs focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div className="max-h-44 overflow-y-auto space-y-1.5">
                      {availableProducts.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground py-2 text-center">
                          {productSearch ? "No matching available products found" : "All products already added"}
                        </p>
                      ) : (
                        availableProducts.map((p) => (
                          <div
                            key={p.id}
                            className="flex items-center justify-between p-2 rounded-xl border border-border/50 bg-background hover:bg-muted/30 transition text-xs"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="size-8 rounded-lg overflow-hidden bg-muted shrink-0">
                                <img
                                  src={p.image || p.imageUrl || ""}
                                  alt={p.name}
                                  className="size-full object-cover"
                                />
                              </div>
                              <div className="min-w-0">
                                <p className="font-semibold text-foreground truncate">{p.name}</p>
                                <p className="text-[10px] text-muted-foreground">
                                  {formatPrice(p.price)} • {p.sku}
                                </p>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => addProduct(p)}
                              className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary hover:bg-primary hover:text-primary-foreground transition shrink-0"
                            >
                              <Plus className="size-3" /> Add
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Display & CTA Settings */}
              <div className="space-y-4 pt-2 border-t border-border/60">
                <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
                  Display & CTA Settings
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-foreground mb-1">
                      Max Products Count
                    </label>
                    <select
                      value={maxProducts}
                      onChange={(e) => setMaxProducts(Number(e.target.value))}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs"
                    >
                      <option value={4}>4 Products</option>
                      <option value={8}>8 Products</option>
                      <option value={12}>12 Products</option>
                      <option value={16}>16 Products</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-foreground mb-1">CTA Label</label>
                    <input
                      type="text"
                      value={ctaLabel}
                      onChange={(e) => setCtaLabel(e.target.value)}
                      placeholder="e.g. View all"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-foreground mb-1">
                      CTA Link Destination
                    </label>
                    <input
                      type="text"
                      value={ctaLink}
                      onChange={(e) => setCtaLink(e.target.value)}
                      placeholder="/shop or /shop?category=..."
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-6 pt-2">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-foreground">
                    <input
                      type="checkbox"
                      checked={showSubtitle}
                      onChange={(e) => setShowSubtitle(e.target.checked)}
                      className="rounded border-border text-primary focus:ring-primary size-4"
                    />
                    Show Subtitle
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-foreground">
                    <input
                      type="checkbox"
                      checked={showCta}
                      onChange={(e) => setShowCta(e.target.checked)}
                      className="rounded border-border text-primary focus:ring-primary size-4"
                    />
                    Show CTA Button
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-foreground">
                    <input
                      type="checkbox"
                      checked={isVisible}
                      onChange={(e) => setIsVisible(e.target.checked)}
                      className="rounded border-border text-primary focus:ring-primary size-4"
                    />
                    Publish to Storefront (Visible)
                  </label>
                </div>
              </div>
            </form>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/20">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-full border border-border bg-background text-xs font-bold text-foreground hover:bg-muted transition cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="submit"
            form="section-form"
            disabled={saveSection.isPending}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2 text-xs font-bold text-primary-foreground shadow-md hover:bg-primary/90 transition disabled:opacity-50 cursor-pointer"
          >
            {saveSection.isPending ? "Saving..." : isEditing ? "Save Changes" : "Create Section"}
          </button>
        </div>
      </div>
    </div>
  );
}
