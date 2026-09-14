/**
 * PrintLabelsModal.tsx — Advanced / Manual Label Configuration Modal.
 *
 * Provides a live visual sticker preview (identical to physical thermal print)
 * with 50×25mm 1-Up Thermal automatic default, fully clickable Barcode-Only
 * and Show Discount % toggles, and quantity controls.
 */
import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Printer, Minus, Plus, Tag, CheckCircle2, Sparkles, ExternalLink, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import type { Product } from "@/lib/store";
import {
  LabelPrintEngine,
  type LabelEntry,
  type LabelType,
  type LabelLayout,
} from "./LabelPrintEngine";
import {
  getSavedLabelProfile,
  setSavedLabelProfile,
  getSavedCustomDimensions,
  setSavedCustomDimensions,
  resolvePrintFormatConfig,
  LABEL_SIZE_OPTIONS,
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
  const [layout, setLayout] = useState<LabelLayout>(() => getSavedLabelProfile());
  const [customDims, setCustomDims] = useState(() => getSavedCustomDimensions());
  const [labelType, setLabelType] = useState<LabelType>(() => getSavedLabelType());
  const [showDiscount, setShowDiscount] = useState<boolean>(() => getSavedShowDiscount());
  const [showMrp, setShowMrp] = useState<boolean>(() => getSavedShowMrp());
  const [showSellPrice, setShowSellPrice] = useState<boolean>(() => getSavedShowSellPrice());
  const [showProductName, setShowProductName] = useState<boolean>(() => getSavedShowProductName());
  const [separatePriceLine, setSeparatePriceLine] = useState<boolean>(() =>
    getSavedSeparatePrice(),
  );
  const [isPrinting, setIsPrinting] = useState(false);

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
  const totalLabels = printableProducts.reduce(
    (sum, p) => sum + (quantities[p.uuid || p.id] ?? 1),
    0,
  );

  const preparedProducts = useMemo(() => {
    return printableProducts.map((p) => ({
      ...p,
      brand: p.brand || "ZERAH",
      artNo: (p as any).artNo || p.sku || p.barcode || "—",
      size: (p as any).size || (p as any).ageGroup || p.variants?.[0]?.size || "--",
    }));
  }, [printableProducts]);

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
      qty: quantities[p.uuid || p.id] ?? 1,
    }));
  }, [preparedProducts, quantities]);

  const activeCfg = resolvePrintFormatConfig(layout, customDims.widthMm, customDims.heightMm);

  const handlePrint = () => {
    if (preparedProducts.length === 0 || isPrinting) return;
    setIsPrinting(true);

    try {
      printProductLabels({
        products: preparedProducts,
        quantities,
        layout,
        customWidthMm: customDims.widthMm,
        customHeightMm: customDims.heightMm,
        labelType,
        showDiscount,
        showMrp,
        showSellPrice,
        showProductName,
        separatePriceLine,
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
      quantities,
      layout,
      customWidthMm: customDims.widthMm,
      customHeightMm: customDims.heightMm,
      labelType,
      showDiscount,
      showMrp,
      showSellPrice,
      showProductName,
      separatePriceLine,
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
                onChange={(e) => {
                  const newLayout = e.target.value as LabelLayout;
                  setLayout(newLayout);
                  setSavedLabelProfile(newLayout);
                }}
                className="bg-card text-foreground font-bold text-xs py-1.5 pl-3 pr-8 rounded-xl border border-border focus:ring-2 focus:ring-[#8B2020] focus:border-[#8B2020] shadow-2xs cursor-pointer appearance-none outline-none"
              >
                <optgroup label="Thermal — Square">
                  {LABEL_SIZE_OPTIONS.filter((o) => o.category === "thermal" && o.subcategory === "square").map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label} ({o.description})
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Thermal — Portrait">
                  {LABEL_SIZE_OPTIONS.filter((o) => o.category === "thermal" && o.subcategory === "portrait").map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label} ({o.description})
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Thermal — Landscape / Compact">
                  {LABEL_SIZE_OPTIONS.filter((o) => o.category === "thermal" && o.subcategory === "landscape").map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label} ({o.description})
                    </option>
                  ))}
                </optgroup>
                <optgroup label="A4 Sheet Grids">
                  {LABEL_SIZE_OPTIONS.filter((o) => o.category === "sheet").map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Custom Size">
                  {LABEL_SIZE_OPTIONS.filter((o) => o.category === "custom").map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label} ({o.description})
                    </option>
                  ))}
                </optgroup>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground">
                <ChevronDown className="size-3.5" />
              </div>
            </div>

            {/* If Custom is selected, show Presets and Width/Height inputs */}
            {layout === "custom" && (
              <div className="flex flex-wrap items-center gap-1.5 bg-card px-2.5 py-1 rounded-xl border border-border shadow-2xs animate-in fade-in duration-150">
                <span className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider mr-0.5">
                  Presets:
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setCustomDims({ widthMm: 50, heightMm: 50 });
                    setSavedCustomDimensions(50, 50);
                  }}
                  className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                    customDims.widthMm === 50 && customDims.heightMm === 50
                      ? "bg-[#8B2020] text-white border-[#8B2020]"
                      : "bg-muted/50 text-foreground border-border hover:bg-muted"
                  }`}
                >
                  Square (50×50)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCustomDims({ widthMm: 58, heightMm: 58 });
                    setSavedCustomDimensions(58, 58);
                  }}
                  className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                    customDims.widthMm === 58 && customDims.heightMm === 58
                      ? "bg-[#8B2020] text-white border-[#8B2020]"
                      : "bg-muted/50 text-foreground border-border hover:bg-muted"
                  }`}
                >
                  Square (58×58)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCustomDims({ widthMm: 50, heightMm: 75 });
                    setSavedCustomDimensions(50, 75);
                  }}
                  className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                    customDims.widthMm === 50 && customDims.heightMm === 75
                      ? "bg-[#8B2020] text-white border-[#8B2020]"
                      : "bg-muted/50 text-foreground border-border hover:bg-muted"
                  }`}
                >
                  Portrait (50×75)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCustomDims({ widthMm: 58, heightMm: 40 });
                    setSavedCustomDimensions(58, 40);
                  }}
                  className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                    customDims.widthMm === 58 && customDims.heightMm === 40
                      ? "bg-[#8B2020] text-white border-[#8B2020]"
                      : "bg-muted/50 text-foreground border-border hover:bg-muted"
                  }`}
                >
                  Landscape (58×40)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCustomDims({ widthMm: 50, heightMm: 25 });
                    setSavedCustomDimensions(50, 25);
                  }}
                  className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                    customDims.widthMm === 50 && customDims.heightMm === 25
                      ? "bg-[#8B2020] text-white border-[#8B2020]"
                      : "bg-muted/50 text-foreground border-border hover:bg-muted"
                  }`}
                >
                  Compact (50×25)
                </button>

                <div className="h-3.5 w-px bg-border mx-1" />

                <span className="text-[11px] font-semibold text-muted-foreground">W:</span>
                <input
                  type="number"
                  min={20}
                  max={200}
                  value={customDims.widthMm}
                  onChange={(e) => {
                    const val = Math.max(20, Math.min(200, parseInt(e.target.value) || 50));
                    setCustomDims((prev) => {
                      const next = { ...prev, widthMm: val };
                      setSavedCustomDimensions(next.widthMm, next.heightMm);
                      return next;
                    });
                  }}
                  className="w-12 text-center text-xs font-black rounded border border-border py-0.5 bg-background"
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
                    setCustomDims((prev) => {
                      const next = { ...prev, heightMm: val };
                      setSavedCustomDimensions(next.widthMm, next.heightMm);
                      return next;
                    });
                  }}
                  className="w-12 text-center text-xs font-black rounded border border-border py-0.5 bg-background"
                />
                <span className="text-[10px] text-muted-foreground font-bold">mm</span>
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
            />
          </div>
        </div>

        {/* Footer info & print shortcut */}
        <div className="shrink-0 border-t border-border/60 p-4 bg-muted/20 flex items-center justify-between text-xs text-muted-foreground print:hidden">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5 text-emerald-600" />
            <span>
              Exact physical preview ({activeCfg.name} • {activeCfg.isSheet ? "Sheet Grid" : activeCfg.pageHeightMm >= activeCfg.pageWidthMm ? "Thermal Portrait" : "Thermal Landscape"})
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
