/**
 * PrintLabelsModal.tsx — Advanced / Manual Label Configuration Modal.
 *
 * Provides a live visual sticker preview (identical to physical thermal print)
 * with three user-facing formats — Horizontal, Vertical, and Custom — plus
 * independent 0°/90°/180°/270° rotation, saved custom label sizes,
 * fully clickable label toggles, and quantity controls.
 */
import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Printer, Minus, Plus, Tag, CheckCircle2, Sparkles, ExternalLink, ChevronDown, RotateCw } from "lucide-react";
import { toast } from "sonner";
import type { Product } from "@/lib/store";
import {
  LabelPrintEngine,
  type LabelEntry,
  type LabelType,
  type LabelLayout,
} from "./LabelPrintEngine";
const SAVED_CUSTOM_LABEL_SIZES_KEY = "zerah_saved_custom_label_sizes_v1";

type SavedCustomLabelSize = {
  id: string;
  widthMm: number;
  heightMm: number;
  name: string;
};

function readSavedCustomLabelSizes(): SavedCustomLabelSize[] {
  try {
    const raw = localStorage.getItem(SAVED_CUSTOM_LABEL_SIZES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedCustomLabelSize =>
        item &&
        typeof item.id === "string" &&
        typeof item.widthMm === "number" &&
        typeof item.heightMm === "number" &&
        Number.isFinite(item.widthMm) &&
        Number.isFinite(item.heightMm),
    );
  } catch {
    return [];
  }
}

function writeSavedCustomLabelSizes(sizes: SavedCustomLabelSize[]) {
  try {
    localStorage.setItem(SAVED_CUSTOM_LABEL_SIZES_KEY, JSON.stringify(sizes));
  } catch {
    // Ignore localStorage failures; normal label settings still work.
  }
}

/**
 * The UI intentionally exposes only three format choices.
 * Legacy / previously-saved profiles are normalized to their closest
 * supported user-facing format so an old setting can never reappear in the UI.
 */
function normalizeLabelLayout(profile: LabelLayout): Extract<LabelLayout, "58x50" | "50x58" | "custom"> {
  if (profile === "50x58") return "50x58";
  if (profile === "custom") return "custom";
  return "58x50";
}

import {
  getSavedLabelProfile,
  setSavedLabelProfile,
  getSavedCustomDimensions,
  setSavedCustomDimensions,
  resolvePrintFormatConfig,
  getSavedLabelType,
  setSavedLabelType,
  getSavedShowDiscount,
  setSavedShowDiscount,
  getSavedShowMrp,
  setSavedShowMrp,
  getSavedShowSellPrice,
  setSavedShowSellPrice,
  getSavedShowProductName,
  setSavedShowProductName,
  getSavedSeparatePrice,
  setSavedSeparatePrice,
  printProductLabels,
  openLabelPrintInNewTab,
  type LabelRotation,
  getSavedLabelRotation,
  setSavedLabelRotation,
} from "@/lib/label-printer";

export function PrintLabelsModal({
  products,
  onClose,
}: {
  products: Product[];
  onClose: () => void;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(products.map((p) => [p.uuid || p.id, 1])),
  );
  const [layout, setLayout] = useState<LabelLayout>(() =>
    normalizeLabelLayout(getSavedLabelProfile()),
  );
  const [customDims, setCustomDims] = useState(() => getSavedCustomDimensions());
  const [savedCustomSizes, setSavedCustomSizes] = useState<SavedCustomLabelSize[]>(() =>
    readSavedCustomLabelSizes(),
  );
  const [labelType, setLabelType] = useState<LabelType>(() => getSavedLabelType());
  const [showDiscount, setShowDiscount] = useState<boolean>(() => getSavedShowDiscount());
  const [showMrp, setShowMrp] = useState<boolean>(() => getSavedShowMrp());
  const [showSellPrice, setShowSellPrice] = useState<boolean>(() => getSavedShowSellPrice());
  const [showProductName, setShowProductName] = useState<boolean>(() => getSavedShowProductName());
  const [separatePriceLine, setSeparatePriceLine] = useState<boolean>(() =>
    getSavedSeparatePrice(),
  );
  const [rotation, setRotation] = useState<LabelRotation>(() => getSavedLabelRotation());
  const [isPrinting, setIsPrinting] = useState(false);

  const persistSavedCustomSizes = (sizes: SavedCustomLabelSize[]) => {
    setSavedCustomSizes(sizes);
    writeSavedCustomLabelSizes(sizes);
  };

  const saveCurrentCustomSize = () => {
    const widthMm = Math.max(20, Math.min(200, Math.round(Number(customDims.widthMm) || 50)));
    const heightMm = Math.max(15, Math.min(200, Math.round(Number(customDims.heightMm) || 50)));
    const existing = savedCustomSizes.find(
      (size) => size.widthMm === widthMm && size.heightMm === heightMm,
    );

    if (existing) {
      toast.success(`${widthMm} × ${heightMm} mm is already saved`);
      return;
    }

    const next: SavedCustomLabelSize = {
      id: `${widthMm}x${heightMm}-${Date.now()}`,
      widthMm,
      heightMm,
      name: `${widthMm} × ${heightMm} mm`,
    };

    persistSavedCustomSizes([...savedCustomSizes, next]);
    setLayout("custom");
    setSavedLabelProfile("custom");
    setCustomDims({ widthMm, heightMm });
    setSavedCustomDimensions(widthMm, heightMm);
    toast.success(`Saved ${next.name}`);
  };

  const deleteSavedCustomSize = (id: string) => {
    const target = savedCustomSizes.find((size) => size.id === id);
    persistSavedCustomSizes(savedCustomSizes.filter((size) => size.id !== id));
    if (target) toast.success(`Deleted ${target.name}`);
  };

  const selectSavedCustomSize = (size: SavedCustomLabelSize) => {
    const next = { widthMm: size.widthMm, heightMm: size.heightMm };
    setLayout("custom");
    setSavedLabelProfile("custom");
    setCustomDims(next);
    setSavedCustomDimensions(next.widthMm, next.heightMm);
  };

  const handleRotationChange = (newRot: LabelRotation) => {
    setRotation(newRot);
    setSavedLabelRotation(newRot);
  };

  const cycleRotation = () => {
    const nextRot: Record<LabelRotation, LabelRotation> = { 0: 90, 90: 180, 180: 270, 270: 0 };
    handleRotationChange(nextRot[rotation] ?? 0);
  };

  const handleLabelTypeChange = (newType: LabelType) => {
    setLabelType(newType);
    setSavedLabelType(newType);
    if (newType === "barcode-only") {
      setShowDiscount(false);
      setSavedShowDiscount(false);
    }
  };

  const handleDiscountToggle = (checked: boolean) => {
    setShowDiscount(checked);
    setSavedShowDiscount(checked);
    // When Show Discount % is clicked, ensure full label with text/prices is active
    if (checked && labelType === "barcode-only") {
      setLabelType("full");
      setSavedLabelType("full");
    }
  };

  const handleSellPriceToggle = (checked: boolean) => {
    setShowSellPrice(checked);
    setSavedShowSellPrice(checked);
    if (checked && labelType === "barcode-only") {
      setLabelType("full");
      setSavedLabelType("full");
    }
  };

  const handleProductNameToggle = (checked: boolean) => {
    setShowProductName(checked);
    setSavedShowProductName(checked);
    if (checked && labelType === "barcode-only") {
      setLabelType("full");
      setSavedLabelType("full");
    }
  };

  const handleMrpToggle = (checked: boolean) => {
    setShowMrp(checked);
    setSavedShowMrp(checked);
    if (checked && labelType === "barcode-only") {
      setLabelType("full");
      setSavedLabelType("full");
    }
  };

  const handleSeparatePriceToggle = (checked: boolean) => {
    setSeparatePriceLine(checked);
    setSavedSeparatePrice(checked);
  };

  const setQty = (uuid: string, qty: number) => {
    setQuantities((prev) => ({ ...prev, [uuid]: Math.max(1, Math.min(500, qty)) }));
  };

  const printableProducts = products.filter((p) => p.sku || p.barcode || p.name);

  const preparedProducts = useMemo(() => {
    return printableProducts.flatMap((p) => {
      const variants = p.variants?.length ? p.variants : [null];

      return variants.map((variant) => ({
        ...p,
        uuid: variant ? `${p.uuid || p.id}-${variant.id}` : p.uuid || p.id,
        brand: p.brand || "ZERAH",
        artNo: variant?.sku || (p as any).artNo || p.sku || p.barcode || "—",
        sku: variant?.sku || p.sku || "",
        barcode: variant?.barcode || p.barcode || variant?.sku || p.sku || "",
        price: variant?.priceOverride ?? p.price,
        mrp: variant?.mrpOverride ?? p.mrp ?? p.price,
        stock: variant?.stock ?? p.stock ?? 1,
        size:
          variant?.size ||
          variant?.color ||
          (p as any).size ||
          (p as any).ageGroup ||
          "--",
        variants: undefined,
      }));
    });
  }, [printableProducts]);

  const variantQuantities = useMemo(() => {
    const next: Record<string, number> = {};

    for (const p of printableProducts) {
      const parentKey = p.uuid || p.id;
      const qty = quantities[parentKey] ?? 1;
      const variants = p.variants?.length ? p.variants : [null];

      for (const variant of variants) {
        const key = variant ? `${parentKey}-${variant.id}` : parentKey;
        next[key] = qty;
      }
    }

    return next;
  }, [printableProducts, quantities]);

  const totalLabels = preparedProducts.reduce((sum, p) => {
    return sum + (variantQuantities[p.uuid || p.id] ?? 1);
  }, 0);

  const entries: LabelEntry[] = useMemo(() => {
    return preparedProducts.map((p) => ({
      product: {
        uuid: p.uuid || p.id,
        name: p.name,
        sku: p.sku || "",
        artNo: p.artNo,
        barcode: p.barcode || p.sku || "",
        price: p.price,
        mrp: p.mrp || p.price,
        stock: p.stock ?? 1,
        brand: p.brand,
        size: p.size,
      },
      qty: variantQuantities[p.uuid || p.id] ?? 1,
    }));
  }, [preparedProducts, variantQuantities]);

  const activeCfg = resolvePrintFormatConfig(layout, customDims.widthMm, customDims.heightMm);

  const handlePrint = () => {
    if (preparedProducts.length === 0 || isPrinting) return;
    setIsPrinting(true);

    try {
      printProductLabels({
        products: preparedProducts,
        quantities: variantQuantities,
        layout,
        customWidthMm: customDims.widthMm,
        customHeightMm: customDims.heightMm,
        labelType,
        showDiscount,
        showMrp,
        showSellPrice,
        showProductName,
        separatePriceLine,
        rotation,
        onDone: () => setIsPrinting(false),
      });
    } catch (err) {
      console.error("[PrintLabelsModal] Print invocation error:", err);
      setIsPrinting(false);
      toast.error("Failed to open print dialog");
    }
  };

  const handlePrintNewTab = () => {
    if (preparedProducts.length === 0) return;
    openLabelPrintInNewTab({
      products: preparedProducts,
      quantities: variantQuantities,
      layout,
      customWidthMm: customDims.widthMm,
      customHeightMm: customDims.heightMm,
      labelType,
      showDiscount,
      showMrp,
      showSellPrice,
      showProductName,
      separatePriceLine,
      rotation,
    });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-3 sm:p-6 backdrop-blur-sm overflow-y-auto print:block print:bg-white print:p-0"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-2xl max-h-[calc(100dvh-2rem)] my-auto flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-2xl print:max-h-none print:overflow-visible print:w-full print:rounded-none print:border-0 print:bg-white print:shadow-none animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between border-b border-border/60 p-4 sm:p-5 bg-card print:hidden">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#8B2020]/10 text-[#8B2020] border border-[#8B2020]/20">
              <Tag className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg font-bold text-foreground">
                  Print Product Labels
                </h2>
                <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  {activeCfg.name}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {totalLabels} label{totalLabels !== 1 ? "s" : ""} • {printableProducts.length}{" "}
                product{printableProducts.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrintNewTab}
              title="Open labels in new browser tab for direct preview or print"
              className="hidden sm:flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
            >
              <ExternalLink className="size-3.5" />
              <span>Open in Tab</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={isPrinting || printableProducts.length === 0}
              className="flex items-center gap-2 rounded-xl bg-[#8B2020] px-5 py-2.5 text-sm font-bold text-white shadow-premium-sm hover:bg-[#7a1c1c] active:scale-95 transition cursor-pointer disabled:opacity-50"
            >
              <Printer className="size-4" />
              <span>{isPrinting ? "Opening Print…" : "Print Labels"}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
              aria-label="Close dialog"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Format & Option Controls Bar */}
        <div className="shrink-0 border-b border-border/60 px-4 py-3 bg-muted/20 flex flex-wrap items-center justify-between gap-3 text-xs print:hidden">
          {/* Format selector */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-muted-foreground">Format:</span>
            <div className="relative">
              <select
                value={layout}
                aria-label="Label format"
                onChange={(e) => {
                  const newLayout = normalizeLabelLayout(e.target.value as LabelLayout);
                  setLayout(newLayout);
                  setSavedLabelProfile(newLayout);
                }}
                className="bg-card text-foreground font-bold text-xs py-1.5 pl-3 pr-8 rounded-xl border border-border focus:ring-2 focus:ring-[#8B2020] focus:border-[#8B2020] shadow-2xs cursor-pointer appearance-none outline-none"
              >
                <option value="58x50">Horizontal (58 × 50 mm)</option>
                <option value="50x58">Vertical (50 × 58 mm)</option>
                <option value="custom">Custom</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground">
                <ChevronDown className="size-3.5" />
              </div>
            </div>

            {/* Rotation & Flip Controls */}
            <div className="flex items-center gap-1.5 bg-card px-2.5 py-1 rounded-xl border border-border shadow-2xs">
              <button
                type="button"
                onClick={cycleRotation}
                title="Click to cycle rotation by 90°"
                className="flex items-center gap-1 text-[10px] font-extrabold uppercase text-muted-foreground hover:text-foreground tracking-wider cursor-pointer"
              >
                <RotateCw className="size-3 text-[#8B2020]" />
                <span>Rotate:</span>
              </button>
              {([0, 90, 180, 270] as const).map((deg) => (
                <button
                  key={deg}
                  type="button"
                  onClick={() => handleRotationChange(deg)}
                  className={`px-2 py-0.5 rounded-lg text-xs font-black transition cursor-pointer ${
                    rotation === deg
                      ? "bg-[#8B2020] text-white shadow-2xs"
                      : "bg-muted/50 text-foreground border border-transparent hover:bg-muted"
                  }`}
                >
                  {deg}°
                </button>
              ))}

            </div>

            {/* Custom size controls */}
            {layout === "custom" && (
              <div className="flex w-full flex-col gap-2 bg-card px-2.5 py-2 rounded-xl border border-border shadow-2xs animate-in fade-in duration-150">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider mr-0.5">
                    Size:
                  </span>

                  <span className="text-[11px] font-semibold text-muted-foreground">W:</span>
                  <input
                    type="number"
                    min={20}
                    max={200}
                    value={customDims.widthMm}
                    onChange={(e) => {
                      const val = Math.max(20, Math.min(200, parseInt(e.target.value) || 50));
                      setCustomDims((prev) => ({ ...prev, widthMm: val }));
                    }}
                    onBlur={() => setSavedCustomDimensions(customDims.widthMm, customDims.heightMm)}
                    className="w-14 text-center text-xs font-black rounded border border-border py-0.5 bg-background"
                  />
                  <span className="text-[11px] text-muted-foreground font-semibold">×</span>
                  <span className="text-[11px] font-semibold text-muted-foreground">H:</span>
                  <input
                    type="number"
                    min={15}
                    max={200}
                    value={customDims.heightMm}
                    onChange={(e) => {
                      const val = Math.max(15, Math.min(200, parseInt(e.target.value) || 50));
                      setCustomDims((prev) => ({ ...prev, heightMm: val }));
                    }}
                    onBlur={() => setSavedCustomDimensions(customDims.widthMm, customDims.heightMm)}
                    className="w-14 text-center text-xs font-black rounded border border-border py-0.5 bg-background"
                  />
                  <span className="text-[10px] text-muted-foreground font-bold">mm</span>

                  <button
                    type="button"
                    onClick={saveCurrentCustomSize}
                    className="ml-auto px-2.5 py-1 rounded-lg bg-[#8B2020] text-white text-xs font-extrabold hover:bg-[#7a1c1c] active:scale-95 transition cursor-pointer"
                  >
                    Save Size
                  </button>
                </div>

                {savedCustomSizes.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/60">
                    <span className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider mr-0.5">
                      Saved:
                    </span>
                    {savedCustomSizes.map((size) => (
                      <div
                        key={size.id}
                        className="flex items-center rounded-lg border border-border bg-muted/40 overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() => selectSavedCustomSize(size)}
                          className={`px-2 py-1 text-[11px] font-bold transition cursor-pointer hover:bg-muted ${
                            customDims.widthMm === size.widthMm && customDims.heightMm === size.heightMm
                              ? "text-[#8B2020] bg-[#8B2020]/10"
                              : "text-foreground"
                          }`}
                          title={`Use ${size.name}`}
                        >
                          {size.name}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteSavedCustomSize(size.id)}
                          className="px-1.5 py-1 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition cursor-pointer border-l border-border"
                          title={`Delete ${size.name}`}
                          aria-label={`Delete saved size ${size.name}`}
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Fully Clickable Option Toggles */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Barcode Only toggle */}
            <label className="flex items-center gap-1.5 cursor-pointer text-xs font-bold text-foreground select-none">
              <input
                type="checkbox"
                checked={labelType === "barcode-only"}
                onChange={(e) => handleLabelTypeChange(e.target.checked ? "barcode-only" : "full")}
                className="size-4 rounded border-border text-[#8B2020] focus:ring-[#8B2020] cursor-pointer"
              />
              <span>Barcode Only</span>
            </label>

            <div className="h-4 w-px bg-border/60" />

            {/* Product Name toggle */}
            <label
              className={`flex items-center gap-1.5 cursor-pointer text-xs font-bold select-none transition ${
                labelType === "barcode-only" ? "opacity-40 pointer-events-none" : "text-foreground"
              }`}
            >
              <input
                type="checkbox"
                disabled={labelType === "barcode-only"}
                checked={showProductName}
                onChange={(e) => handleProductNameToggle(e.target.checked)}
                className="size-4 rounded border-border text-[#8B2020] focus:ring-[#8B2020] cursor-pointer"
              />
              <span>Product Name</span>
            </label>

            {/* Sell Price toggle */}
            <label
              className={`flex items-center gap-1.5 cursor-pointer text-xs font-bold select-none transition ${
                labelType === "barcode-only" ? "opacity-40 pointer-events-none" : "text-foreground"
              }`}
            >
              <input
                type="checkbox"
                disabled={labelType === "barcode-only"}
                checked={showSellPrice}
                onChange={(e) => handleSellPriceToggle(e.target.checked)}
                className="size-4 rounded border-border text-[#8B2020] focus:ring-[#8B2020] cursor-pointer"
              />
              <span>Sell Price</span>
            </label>

            {/* MRP toggle */}
            <label
              className={`flex items-center gap-1.5 cursor-pointer text-xs font-bold select-none transition ${
                labelType === "barcode-only" ? "opacity-40 pointer-events-none" : "text-foreground"
              }`}
            >
              <input
                type="checkbox"
                disabled={labelType === "barcode-only"}
                checked={showMrp}
                onChange={(e) => handleMrpToggle(e.target.checked)}
                className="size-4 rounded border-border text-[#8B2020] focus:ring-[#8B2020] cursor-pointer"
              />
              <span>MRP</span>
            </label>

            {/* Show Discount % toggle */}
            <label
              className={`flex items-center gap-1.5 cursor-pointer text-xs font-bold select-none transition ${
                labelType === "barcode-only" ? "opacity-40 pointer-events-none" : "text-foreground"
              }`}
            >
              <input
                type="checkbox"
                disabled={labelType === "barcode-only"}
                checked={showDiscount}
                onChange={(e) => handleDiscountToggle(e.target.checked)}
                className="size-4 rounded border-border text-[#8B2020] focus:ring-[#8B2020] cursor-pointer"
              />
              <span className="flex items-center gap-1">
                <Sparkles className="size-3 text-amber-500" />
                <span>Discount %</span>
              </span>
            </label>

            <div className="h-4 w-px bg-border/60" />

            {/* Separate Price Row toggle */}
            <label
              className={`flex items-center gap-1.5 cursor-pointer text-xs font-bold select-none transition ${
                labelType === "barcode-only" || (!showMrp && !showSellPrice)
                  ? "opacity-40 pointer-events-none"
                  : "text-foreground"
              }`}
              title="Print price on a separate dedicated line instead of inline with product name"
            >
              <input
                type="checkbox"
                disabled={labelType === "barcode-only" || (!showMrp && !showSellPrice)}
                checked={separatePriceLine}
                onChange={(e) => handleSeparatePriceToggle(e.target.checked)}
                className="size-4 rounded border-border text-[#8B2020] focus:ring-[#8B2020] cursor-pointer"
              />
              <span>Separate Price Row</span>
            </label>
          </div>
        </div>

        {/* Quantities Quick Selector */}
        <div className="shrink-0 px-4 py-2.5 bg-muted/10 border-b border-border/40 flex flex-wrap items-center gap-2 print:hidden">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground mr-1">
            Quantities:
          </span>
          {printableProducts.map((p) => {
            const key = p.uuid || p.id;
            const q = quantities[key] ?? 1;
            return (
              <div
                key={key}
                className="flex items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-1 shadow-2xs"
              >
                <span
                  className="text-xs font-bold text-foreground max-w-[110px] truncate"
                  title={p.name}
                >
                  {p.name}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setQty(key, q - 1)}
                    className="flex h-5 w-5 items-center justify-center rounded-md border border-border bg-muted/50 hover:bg-muted text-muted-foreground cursor-pointer active:scale-95 transition"
                  >
                    <Minus className="size-3" />
                  </button>
                  <input
                    type="number"
                    value={q}
                    onChange={(e) => setQty(key, parseInt(e.target.value) || 1)}
                    className="w-8 text-center text-xs font-black rounded border border-border py-0.5 bg-background"
                    min={1}
                    max={500}
                  />
                  <button
                    type="button"
                    onClick={() => setQty(key, q + 1)}
                    className="flex h-5 w-5 items-center justify-center rounded-md border border-border bg-muted/50 hover:bg-muted text-muted-foreground cursor-pointer active:scale-95 transition"
                  >
                    <Plus className="size-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Live Sticker Preview Center Area — Full Prominent View */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 bg-slate-100 dark:bg-slate-900/60 flex flex-col items-center justify-start max-h-[50vh]">
          <div className="w-full flex flex-col items-center">
            <LabelPrintEngine
              entries={entries}
              labelType={labelType}
              layout={layout}
              customWidthMm={customDims.widthMm}
              customHeightMm={customDims.heightMm}
              showDiscount={showDiscount}
              showMrp={showMrp}
              showSellPrice={showSellPrice}
              showProductName={showProductName}
              separatePriceLine={separatePriceLine}
              rotation={rotation}
            />
          </div>
        </div>

        {/* Footer info & print shortcut */}
        <div className="shrink-0 border-t border-border/60 p-4 bg-muted/20 flex items-center justify-between text-xs text-muted-foreground print:hidden">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5 text-emerald-600" />
            <span>
              Exact physical preview ({activeCfg.name} • {rotation !== 0 ? `${rotation}° Rotated • ` : ""}{activeCfg.isSheet ? "Sheet Grid" : activeCfg.pageHeightMm >= activeCfg.pageWidthMm ? "Thermal Portrait" : "Thermal Landscape"})
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handlePrintNewTab}
              className="flex items-center gap-1 font-semibold text-muted-foreground hover:text-foreground cursor-pointer transition"
            >
              <ExternalLink className="size-3.5" />
              <span>Open in Tab</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={isPrinting || printableProducts.length === 0}
              className="flex items-center gap-1.5 font-bold text-[#8B2020] hover:underline cursor-pointer disabled:opacity-50 transition"
            >
              <Printer className="size-3.5" />
              <span>
                {isPrinting
                  ? "Opening Print Dialog…"
                  : `Ready to Print ${totalLabels} Label${totalLabels !== 1 ? "s" : ""}`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
