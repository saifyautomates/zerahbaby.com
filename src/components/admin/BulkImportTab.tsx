/**
 * BulkImportTab.tsx
 *
 * Full-parity Bulk Product Import Wizard for Zérah Baby & Kids.
 * 100% parity with the Add Product form (ProductForm.tsx) and database schema.
 *
 * Steps:
 *   0 — Setup   (download full Excel template, choose import mode)
 *   1 — Upload  (drag-and-drop single ZIP, XLSX, or CSV)
 *   2 — Preview (paginated validation table, variants matrix, image thumbnails)
 *   3 — Results (progress bar, upload stats, failure report)
 */

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Upload,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Loader2,
  SkipForward,
  RefreshCw,
  FileDown,
  X,
  ChevronDown,
  ChevronUp,
  Info,
  Layers,
  Image as ImageIcon,
  FolderArchive,
  Search,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  DollarSign,
  Package,
} from "lucide-react";

import {
  type BulkProductGroup,
  type BulkMode,
  type CommitProgress,
  type CommitResult,
  parsePackageFile,
  groupAndValidateRows,
  commitBulkImport,
  fetchExistingProducts,
  downloadBulkImportTemplate,
  downloadFailureReport,
  VALID_CATEGORIES,
  VALID_AGE_GROUPS,
  TEMPLATE_COLUMNS,
} from "@/lib/bulk-import";

// ─────────────────────────────────────────────────────────────────────────────
// Constants & Configuration
// ─────────────────────────────────────────────────────────────────────────────

type WizardStep = 0 | 1 | 2 | 3;

const STEP_LABELS = ["Setup & Template", "Upload Package", "Validate & Preview", "Results"];

const MODE_OPTIONS: { value: BulkMode; label: string; description: string }[] = [
  {
    value: "new_and_update",
    label: "Create New + Update Existing",
    description: "Inserts new products and updates existing products matching by Product SKU.",
  },
  {
    value: "new_only",
    label: "Create New Only",
    description: "Only creates brand-new products. Any rows matching existing SKUs are skipped.",
  },
  {
    value: "update_only",
    label: "Update Existing Only",
    description: "Only updates existing catalog products. Any new product rows are skipped.",
  },
];

const ITEMS_PER_PAGE = 30;

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

interface BulkImportTabProps {
  onBack: () => void;
}

export function BulkImportTab({ onBack }: BulkImportTabProps) {
  const qc = useQueryClient();

  // Wizard state
  const [step, setStep] = useState<WizardStep>(0);
  const [mode, setMode] = useState<BulkMode>("new_and_update");

  // File + parsing state
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Validation state
  const [products, setProducts] = useState<BulkProductGroup[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<
    "all" | "valid" | "new" | "update" | "skip" | "error"
  >("all");
  const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set());
  const [expandedVariants, setExpandedVariants] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [isValidating, setIsValidating] = useState(false);

  // Commit state
  const [progress, setProgress] = useState<CommitProgress | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // ── Derived Counts ────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    let totalVariants = 0;
    let totalMedia = 0;

    products.forEach((p) => {
      totalVariants += p.variants.length;
      totalMedia += p.zipMedia.length + p.imageUrls.length;
    });

    return {
      total: products.length,
      new: products.filter((p) => p.status === "new").length,
      update: products.filter((p) => p.status === "update").length,
      skip: products.filter((p) => p.status === "skip").length,
      error: products.filter((p) => p.status === "error").length,
      valid: products.filter((p) => p.status === "new" || p.status === "update").length,
      selected: products.filter((p) => p.selected).length,
      totalVariants,
      totalMedia,
    };
  }, [products]);

  // ── Filtered & Paginated Products ─────────────────────────────────────────
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      // Status filter
      if (filterStatus === "valid" && p.status !== "new" && p.status !== "update") return false;
      if (filterStatus !== "all" && filterStatus !== "valid" && p.status !== filterStatus) {
        return false;
      }

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = p.name.toLowerCase().includes(q);
        const matchesSku = p.sku.toLowerCase().includes(q);
        const matchesBarcode = p.barcode.toLowerCase().includes(q);
        const matchesCategory = p.category.toLowerCase().includes(q);
        const matchesVariant = p.variants.some(
          (v) =>
            (v.color && v.color.toLowerCase().includes(q)) ||
            (v.size && v.size.toLowerCase().includes(q)) ||
            v.sku.toLowerCase().includes(q),
        );
        return matchesName || matchesSku || matchesBarcode || matchesCategory || matchesVariant;
      }

      return true;
    });
  }, [products, filterStatus, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / ITEMS_PER_PAGE));
  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredProducts.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredProducts, currentPage]);

  // Reset page when filter or search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [filterStatus, searchQuery]);

  // ── File Handling (Single ZIP, XLSX, CSV) ─────────────────────────────────
  const handleFile = useCallback(
    async (f: File) => {
      setParseError(null);
      setFile(f);
      setIsParsing(true);

      try {
        const { rawRows, mediaBySku } = await parsePackageFile(f);

        if (rawRows.length === 0) {
          throw new Error("The spreadsheet contains no data rows.");
        }
        if (rawRows.length > 5000) {
          throw new Error(
            `File contains ${rawRows.length} rows. Maximum allowed is 5,000 rows per import.`,
          );
        }

        setIsValidating(true);
        const existing = await fetchExistingProducts();
        const validatedGroups = groupAndValidateRows(rawRows, mediaBySku, existing, mode);

        setProducts(validatedGroups);
        setStep(2);
      } catch (err) {
        setParseError((err as Error).message);
        setFile(null);
      } finally {
        setIsParsing(false);
        setIsValidating(false);
      }
    },
    [mode],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) handleFile(f);
      e.target.value = "";
    },
    [handleFile],
  );

  // ── Selection Toggles ─────────────────────────────────────────────────────
  const toggleProduct = (sku: string) => {
    setProducts((prev) =>
      prev.map((p) => (p.sku === sku ? { ...p, selected: !p.selected } : p)),
    );
  };

  const toggleAll = () => {
    const eligibleInView = filteredProducts.filter(
      (p) => p.status !== "error" && p.status !== "skip",
    );
    const allSelected = eligibleInView.length > 0 && eligibleInView.every((p) => p.selected);

    const eligibleSkus = new Set(eligibleInView.map((p) => p.sku));

    setProducts((prev) =>
      prev.map((p) => {
        if (eligibleSkus.has(p.sku)) {
          return { ...p, selected: !allSelected };
        }
        return p;
      }),
    );
  };

  // ── Commit Execution ──────────────────────────────────────────────────────
  const handleCommit = async () => {
    const ac = new AbortController();
    abortRef.current = ac;
    setIsCommitting(true);
    setProgress({
      current: 0,
      total: counts.selected,
      message: "Starting import pipeline…",
      stage: "media",
    });

    try {
      const res = await commitBulkImport(products, mode, ac.signal, (p) => setProgress(p));
      setResult(res);

      // Invalidate relevant React Query caches
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["products"] }),
        qc.invalidateQueries({ queryKey: ["admin-products"] }),
        qc.invalidateQueries({ queryKey: ["inventory-products"] }),
        qc.invalidateQueries({ queryKey: ["categories"] }),
        qc.invalidateQueries({ queryKey: ["homepage-sections"] }),
      ]);

      setStep(3);

      if (res.failed.length === 0) {
        toast.success(
          `✓ ${res.succeeded + res.updated} products imported successfully (${res.totalMediaUploaded} media files attached)`,
        );
      } else {
        toast.warning(
          `${res.succeeded + res.updated} succeeded · ${res.failed.length} failed to save`,
        );
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsCommitting(false);
      abortRef.current = null;
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const reset = () => {
    setStep(0);
    setFile(null);
    setProducts([]);
    setResult(null);
    setProgress(null);
    setParseError(null);
    setFilterStatus("all");
    setSearchQuery("");
    setExpandedIssues(new Set());
    setExpandedVariants(new Set());
    setCurrentPage(1);
  };

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
            aria-label="Back to products list"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-foreground tracking-tight">
                Bulk Product Import
              </h2>
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-extrabold text-primary uppercase tracking-wider">
                Full Parity
              </span>
            </div>
            <p className="text-xs text-muted-foreground font-medium mt-0.5">
              Import hundreds of products with complete variant support, buying prices, and
              single-ZIP media
            </p>
          </div>
        </div>
      </div>

      {/* ── Progress Stepper ───────────────────────────────────────────────── */}
      <StepIndicator current={step} labels={STEP_LABELS} />

      {/* ── Wizard Steps ───────────────────────────────────────────────────── */}
      {step === 0 && (
        <StepSetup mode={mode} onModeChange={setMode} onNext={() => setStep(1)} />
      )}

      {step === 1 && (
        <StepUpload
          isDragging={isDragging}
          isParsing={isParsing}
          isValidating={isValidating}
          parseError={parseError}
          fileInputRef={fileInputRef}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onFileInput={handleFileInput}
          onBack={() => setStep(0)}
        />
      )}

      {step === 2 && (
        <StepPreview
          products={paginatedProducts}
          allProducts={products}
          counts={counts}
          filterStatus={filterStatus}
          searchQuery={searchQuery}
          currentPage={currentPage}
          totalPages={totalPages}
          expandedIssues={expandedIssues}
          expandedVariants={expandedVariants}
          onFilterChange={setFilterStatus}
          onSearchChange={setSearchQuery}
          onPageChange={setCurrentPage}
          onToggleProduct={toggleProduct}
          onToggleAll={toggleAll}
          onToggleIssues={(sku) =>
            setExpandedIssues((prev) => {
              const next = new Set(prev);
              if (next.has(sku)) next.delete(sku);
              else next.add(sku);
              return next;
            })
          }
          onToggleVariants={(sku) =>
            setExpandedVariants((prev) => {
              const next = new Set(prev);
              if (next.has(sku)) next.delete(sku);
              else next.add(sku);
              return next;
            })
          }
          onBack={() => {
            setStep(1);
            setFile(null);
            setProducts([]);
            setParseError(null);
          }}
          onCommit={handleCommit}
          isCommitting={isCommitting}
          progress={progress}
          onCancel={handleCancel}
        />
      )}

      {step === 3 && result && (
        <StepResults result={result} onReset={reset} onBack={onBack} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-Components
// ─────────────────────────────────────────────────────────────────────────────

function StepIndicator({ current, labels }: { current: number; labels: string[] }) {
  return (
    <div className="flex items-center gap-0 py-2">
      {labels.map((label, i) => (
        <div key={i} className="flex items-center flex-1 last:flex-none">
          <div className="flex flex-col items-center gap-1.5">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-xl text-xs font-black transition-all ${
                i < current
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : i === current
                    ? "bg-primary text-primary-foreground ring-4 ring-primary/20 shadow-md"
                    : "bg-muted text-muted-foreground border border-border"
              }`}
            >
              {i < current ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
            </div>
            <span
              className={`text-[11px] font-bold hidden sm:block whitespace-nowrap ${
                i === current ? "text-foreground font-black" : "text-muted-foreground"
              }`}
            >
              {label}
            </span>
          </div>
          {i < labels.length - 1 && (
            <div
              className={`flex-1 h-0.5 mx-3 mt-[-16px] transition-colors ${
                i < current ? "bg-primary" : "bg-border"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Step 0: Setup & Template Download ──────────────────────────────────────

function StepSetup({
  mode,
  onModeChange,
  onNext,
}: {
  mode: BulkMode;
  onModeChange: (m: BulkMode) => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-6">
      {/* Hero Template Download Card */}
      <div className="rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/5 via-card to-primary/10 p-6 md:p-8 shadow-sm">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md">
              <FileSpreadsheet className="h-7 w-7" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base md:text-lg font-black text-foreground">
                  Official Excel Import Template
                </h3>
                <span className="rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-400 px-2 py-0.5 text-[10px] font-extrabold uppercase">
                  100% Parity
                </span>
              </div>
              <p className="mt-1 text-xs md:text-sm text-muted-foreground max-w-2xl leading-relaxed">
                Includes all fields matching the Add Product form: full variant matrix (Size, Color,
                Overrides), buying prices, barcode codes, delivery fees, and category references.
              </p>
            </div>
          </div>
          <button
            onClick={downloadBulkImportTemplate}
            className="shrink-0 inline-flex items-center gap-2.5 rounded-2xl bg-primary px-6 py-3.5 text-xs font-black text-primary-foreground shadow-md hover:opacity-95 transition cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
          >
            <Download className="h-4 w-4" />
            Download Excel Template (.xlsx)
          </button>
        </div>
      </div>

      {/* Instructions & Features Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-primary font-bold text-xs mb-2">
            <Layers className="h-4 w-4" />
            <span>Multi-Variant Matrix</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Enter the same <strong>Product SKU</strong> on consecutive rows to link multiple
            variants (Color, Size, Custom Variant Stock, Price/MRP Overrides) without duplicating parent
            products.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-primary font-bold text-xs mb-2">
            <FolderArchive className="h-4 w-4" />
            <span>Single-ZIP Media Workflow</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Upload one <strong>products-import.zip</strong> containing your spreadsheet and SKU
            folders (e.g. <code>ZR001/1.jpg</code>, <code>2.jpg</code>, <code>video.mp4</code>). All media is
            automatically attached in sorted order.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-primary font-bold text-xs mb-2">
            <DollarSign className="h-4 w-4" />
            <span>Buying Price & Profit Safe</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Internal buying prices are written directly to <code>product_costs</code>. Historical sales
            and orders remain untouched and authoritative.
          </p>
        </div>
      </div>

      {/* Mode Selector */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <h3 className="font-black text-foreground text-sm mb-4">Choose Import Mode</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {MODE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${
                mode === opt.value
                  ? "border-primary bg-primary/5 ring-2 ring-primary/20 shadow-sm"
                  : "border-border hover:border-primary/40 hover:bg-muted/40"
              }`}
            >
              <input
                type="radio"
                name="bulk-mode"
                value={opt.value}
                checked={mode === opt.value}
                onChange={() => onModeChange(opt.value)}
                className="mt-1 accent-primary cursor-pointer"
              />
              <div>
                <p className="text-xs font-black text-foreground">{opt.label}</p>
                <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                  {opt.description}
                </p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Continue Button */}
      <div className="flex justify-end pt-2">
        <button
          onClick={onNext}
          className="inline-flex items-center gap-2 rounded-2xl bg-primary px-7 py-3 text-xs font-black text-primary-foreground shadow-md hover:opacity-90 transition cursor-pointer"
        >
          Proceed to Upload
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ── Step 1: Upload Package ─────────────────────────────────────────────────

function StepUpload({
  isDragging,
  isParsing,
  isValidating,
  parseError,
  fileInputRef,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileInput,
  onBack,
}: {
  isDragging: boolean;
  isParsing: boolean;
  isValidating: boolean;
  parseError: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBack: () => void;
}) {
  const isLoading = isParsing || isValidating;

  return (
    <div className="space-y-6">
      {/* Drop Zone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => !isLoading && fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Upload ZIP, XLSX, or CSV package"
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !isLoading) {
            fileInputRef.current?.click();
          }
        }}
        className={`flex flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed p-14 text-center transition-all ${
          isDragging
            ? "border-primary bg-primary/10 scale-[1.01] shadow-lg"
            : isLoading
              ? "cursor-not-allowed border-border bg-muted/30"
              : "cursor-pointer border-border hover:border-primary/50 hover:bg-muted/30 shadow-sm"
        }`}
      >
        {isLoading ? (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <div>
              <p className="text-base font-black text-foreground">
                {isValidating ? "Validating product rules…" : "Extracting package contents…"}
              </p>
              <p className="text-xs text-muted-foreground mt-1.5">
                Checking against live database constraints, barcodes, SKUs, and variants
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="flex h-18 w-18 items-center justify-center rounded-3xl bg-primary/10 text-primary shadow-sm">
              <Upload className="h-9 w-9" />
            </div>
            <div>
              <p className="text-base font-black text-foreground">
                Drop your <span className="text-primary font-black">.ZIP</span> package or Excel
                file here
              </p>
              <p className="text-xs text-muted-foreground mt-1.5">
                Accepts <strong>.zip</strong> (with products.xlsx & SKU media folders),{" "}
                <strong>.xlsx</strong>, or <strong>.csv</strong>
              </p>
              <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-[11px] font-bold text-muted-foreground">
                <FolderArchive className="h-3.5 w-3.5 text-primary" />
                Single-ZIP automatically links all product images & videos
              </div>
            </div>
          </>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,.xlsx,.xls,.csv"
        className="hidden"
        onChange={onFileInput}
        aria-label="File upload input"
      />

      {parseError && (
        <div className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-destructive">Package extraction error</p>
            <p className="text-xs text-destructive/90 mt-0.5 leading-relaxed">{parseError}</p>
          </div>
        </div>
      )}

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-2xl border border-border px-5 py-2.5 text-xs font-bold text-muted-foreground hover:bg-muted transition cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Setup
        </button>
      </div>
    </div>
  );
}

// ── Step 2: Validate & Preview ─────────────────────────────────────────────

function StepPreview({
  products,
  allProducts,
  counts,
  filterStatus,
  searchQuery,
  currentPage,
  totalPages,
  expandedIssues,
  expandedVariants,
  onFilterChange,
  onSearchChange,
  onPageChange,
  onToggleProduct,
  onToggleAll,
  onToggleIssues,
  onToggleVariants,
  onBack,
  onCommit,
  isCommitting,
  progress,
  onCancel,
}: {
  products: BulkProductGroup[];
  allProducts: BulkProductGroup[];
  counts: {
    total: number;
    new: number;
    update: number;
    skip: number;
    error: number;
    valid: number;
    selected: number;
    totalVariants: number;
    totalMedia: number;
  };
  filterStatus: string;
  searchQuery: string;
  currentPage: number;
  totalPages: number;
  expandedIssues: Set<string>;
  expandedVariants: Set<string>;
  onFilterChange: (s: "all" | "valid" | "new" | "update" | "skip" | "error") => void;
  onSearchChange: (q: string) => void;
  onPageChange: (p: number) => void;
  onToggleProduct: (sku: string) => void;
  onToggleAll: () => void;
  onToggleIssues: (sku: string) => void;
  onToggleVariants: (sku: string) => void;
  onBack: () => void;
  onCommit: () => void;
  isCommitting: boolean;
  progress: CommitProgress | null;
  onCancel: () => void;
}) {
  const eligibleInView = products.filter((p) => p.status !== "error" && p.status !== "skip");
  const allSelectedInView = eligibleInView.length > 0 && eligibleInView.every((p) => p.selected);

  const filterTabs = [
    { key: "all", label: "All Products", count: counts.total },
    { key: "valid", label: "Ready to Import", count: counts.valid },
    { key: "new", label: "New", count: counts.new },
    { key: "update", label: "Updates", count: counts.update },
    { key: "skip", label: "Skipped", count: counts.skip },
    { key: "error", label: "Errors", count: counts.error },
  ] as const;

  return (
    <div className="space-y-5">
      {/* Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <MetricCard
          label="Total Products"
          value={counts.total}
          subtitle={`${counts.totalVariants} variants`}
          color="text-foreground"
          bg="bg-card border-border"
        />
        <MetricCard
          label="Ready to Create"
          value={counts.new}
          subtitle="Brand new items"
          color="text-emerald-600 dark:text-emerald-400"
          bg="bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200/60 dark:border-emerald-800/40"
        />
        <MetricCard
          label="Ready to Update"
          value={counts.update}
          subtitle="Matched existing SKU"
          color="text-blue-600 dark:text-blue-400"
          bg="bg-blue-50 dark:bg-blue-950/40 border-blue-200/60 dark:border-blue-800/40"
        />
        <MetricCard
          label="ZIP Media Files"
          value={counts.totalMedia}
          subtitle="Auto-attached media"
          color="text-violet-600 dark:text-violet-400"
          bg="bg-violet-50 dark:bg-violet-950/40 border-violet-200/60 dark:border-violet-800/40"
        />
        <MetricCard
          label="Skipped"
          value={counts.skip}
          subtitle="Excluded by mode"
          color="text-muted-foreground"
          bg="bg-muted/60 border-border"
        />
        <MetricCard
          label="Validation Errors"
          value={counts.error}
          subtitle="Will not be imported"
          color="text-destructive"
          bg="bg-destructive/5 border-destructive/30"
        />
      </div>

      {/* Warning Notice if Errors Exist */}
      {counts.error > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {counts.error} product{counts.error !== 1 ? "s have" : " has"} validation errors.
              Invalid products are automatically deselected.
            </span>
          </div>
          <button
            onClick={() =>
              downloadFailureReport(allProducts.filter((p) => p.status === "error"))
            }
            className="inline-flex items-center gap-1.5 rounded-xl bg-destructive text-destructive-foreground px-3 py-1.5 font-bold hover:opacity-90 transition cursor-pointer shrink-0"
          >
            <FileDown className="h-3.5 w-3.5" />
            Download Error Report (.csv)
          </button>
        </div>
      )}

      {/* Controls Bar: Filters & Search */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {filterTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => onFilterChange(t.key)}
              className={`rounded-xl px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                filterStatus === t.key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
              }`}
            >
              {t.label}
              <span
                className={`ml-1.5 rounded-full px-1.5 py-0.2 text-[10px] ${
                  filterStatus === t.key ? "bg-primary-foreground/20" : "bg-border"
                }`}
              >
                {t.count}
              </span>
            </button>
          ))}
        </div>

        <div className="relative min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by name, SKU, category, variant…"
            className="w-full rounded-xl border border-border bg-card pl-9 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>

      {/* Products Preview Table */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-muted-foreground font-black">
                <th className="w-10 px-3 py-3.5 text-center">
                  <input
                    type="checkbox"
                    checked={allSelectedInView}
                    onChange={onToggleAll}
                    className="accent-primary cursor-pointer"
                    aria-label="Select all visible products"
                  />
                </th>
                <th className="px-3 py-3.5 text-left w-12">Media</th>
                <th className="px-3 py-3.5 text-left min-w-[200px]">Product Info</th>
                <th className="px-3 py-3.5 text-left">SKU & Barcode</th>
                <th className="px-3 py-3.5 text-left">Category</th>
                <th className="px-3 py-3.5 text-right">Pricing (₹)</th>
                <th className="px-3 py-3.5 text-right">Stock</th>
                <th className="px-3 py-3.5 text-center">Variants</th>
                <th className="px-3 py-3.5 text-center">Status</th>
                <th className="px-3 py-3.5 text-center">Issues</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {products.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-14 text-center text-muted-foreground">
                    <Package className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
                    No products match the selected filter.
                  </td>
                </tr>
              ) : (
                products.map((p) => (
                  <ProductRow
                    key={p.sku}
                    product={p}
                    isExpandedIssues={expandedIssues.has(p.sku)}
                    isExpandedVariants={expandedVariants.has(p.sku)}
                    onToggle={() => onToggleProduct(p.sku)}
                    onToggleIssues={() => onToggleIssues(p.sku)}
                    onToggleVariants={() => onToggleVariants(p.sku)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 bg-muted/20">
            <p className="text-xs text-muted-foreground">
              Page <span className="font-bold text-foreground">{currentPage}</span> of{" "}
              <span className="font-bold text-foreground">{totalPages}</span>
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => onPageChange(currentPage - 1)}
                disabled={currentPage <= 1}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-muted disabled:opacity-40 transition cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => onPageChange(currentPage + 1)}
                disabled={currentPage >= totalPages}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-muted disabled:opacity-40 transition cursor-pointer"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Commit / Progress Execution Area */}
      {isCommitting && progress ? (
        <div className="rounded-3xl border border-primary/30 bg-card p-6 space-y-4 shadow-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="text-sm font-black text-foreground">
                {progress.stage === "media"
                  ? "Uploading Media to Storage…"
                  : progress.stage === "database"
                    ? "Saving Products & Variants…"
                    : "Finalizing Store Sync…"}
              </p>
            </div>
            <button
              onClick={onCancel}
              className="flex items-center gap-1.5 text-xs font-bold text-destructive hover:underline cursor-pointer"
            >
              <X className="h-4 w-4" />
              Cancel Import
            </button>
          </div>

          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{
                width: `${Math.round((progress.current / Math.max(progress.total, 1)) * 100)}%`,
              }}
            />
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{progress.message}</span>
            <span className="font-mono font-bold text-foreground">
              {progress.current} / {progress.total}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-2xl border border-border px-5 py-2.5 text-xs font-bold text-muted-foreground hover:bg-muted transition cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            Re-upload Package
          </button>

          <div className="flex items-center gap-4">
            <p className="text-xs text-muted-foreground">
              <span className="font-bold text-foreground">{counts.selected}</span> product
              {counts.selected !== 1 ? "s" : ""} selected for import
            </p>
            <button
              onClick={onCommit}
              disabled={counts.selected === 0 || isCommitting}
              className="inline-flex items-center gap-2 rounded-2xl bg-primary px-7 py-3 text-xs font-black text-primary-foreground shadow-md hover:opacity-90 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CheckCircle2 className="h-4 w-4" />
              Import {counts.selected} Product{counts.selected !== 1 ? "s" : ""}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProductRow({
  product,
  isExpandedIssues,
  isExpandedVariants,
  onToggle,
  onToggleIssues,
  onToggleVariants,
}: {
  product: BulkProductGroup;
  isExpandedIssues: boolean;
  isExpandedVariants: boolean;
  onToggle: () => void;
  onToggleIssues: () => void;
  onToggleVariants: () => void;
}) {
  const isError = product.status === "error";
  const isSkip = product.status === "skip";
  const hasIssues = product.errors.length > 0 || product.warnings.length > 0;

  // Media preview
  const primaryMedia = product.zipMedia[0];
  const primaryUrl = primaryMedia?.previewUrl || product.imageUrls[0];
  const totalMediaCount = product.zipMedia.length + product.imageUrls.length;

  const rowBg = isError
    ? "bg-destructive/5"
    : isSkip
      ? "opacity-60 bg-muted/20"
      : product.status === "update"
        ? "bg-blue-50/40 dark:bg-blue-950/20"
        : "";

  return (
    <>
      <tr className={`${rowBg} transition hover:bg-muted/30`}>
        {/* Checkbox */}
        <td className="px-3 py-3 text-center">
          <input
            type="checkbox"
            checked={product.selected}
            onChange={onToggle}
            disabled={isError || isSkip}
            className="accent-primary cursor-pointer disabled:cursor-not-allowed"
            aria-label={`Select product ${product.sku}`}
          />
        </td>

        {/* Media Thumbnail */}
        <td className="px-3 py-3">
          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-border bg-muted flex items-center justify-center">
            {primaryUrl ? (
              <img
                src={primaryUrl}
                alt={product.name}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <ImageIcon className="h-4 w-4 text-muted-foreground/50" />
            )}
            {totalMediaCount > 1 && (
              <span className="absolute bottom-0 right-0 rounded-tl-md bg-black/75 px-1 text-[9px] font-black text-white">
                +{totalMediaCount - 1}
              </span>
            )}
          </div>
        </td>

        {/* Name & Basic Info */}
        <td className="px-3 py-3 max-w-[220px]">
          <p className="font-bold text-foreground truncate">{product.name || "—"}</p>
          <p className="text-[11px] text-muted-foreground truncate">
            {product.brand} · {product.ageGroup || "All Ages"}
          </p>
        </td>

        {/* SKU & Barcode */}
        <td className="px-3 py-3 font-mono text-[11px]">
          <p className="font-bold text-foreground">{product.sku}</p>
          <p className="text-muted-foreground text-[10px]">{product.barcode || "Auto Barcode"}</p>
        </td>

        {/* Category */}
        <td className="px-3 py-3 capitalize text-muted-foreground font-medium">
          {product.category || "—"}
        </td>

        {/* Pricing */}
        <td className="px-3 py-3 text-right">
          <p className="font-bold text-foreground">₹{product.price.toLocaleString("en-IN")}</p>
          <p className="text-[10px] text-muted-foreground line-through">
            ₹{product.mrp.toLocaleString("en-IN")}
          </p>
          {product.buyingPrice > 0 && (
            <p className="text-[9px] font-medium text-emerald-600 dark:text-emerald-400">
              Cost: ₹{product.buyingPrice}
            </p>
          )}
        </td>

        {/* Stock */}
        <td className="px-3 py-3 text-right font-bold text-foreground">
          {product.stock}
        </td>

        {/* Variants */}
        <td className="px-3 py-3 text-center">
          {product.variants.length > 0 ? (
            <button
              onClick={onToggleVariants}
              className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-[11px] font-bold text-primary hover:bg-primary/20 transition cursor-pointer"
            >
              <Layers className="h-3 w-3" />
              {product.variants.length} var
              {isExpandedVariants ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
          ) : (
            <span className="text-muted-foreground/50 text-[11px]">—</span>
          )}
        </td>

        {/* Status */}
        <td className="px-3 py-3 text-center">
          <StatusBadge status={product.status} />
        </td>

        {/* Issues */}
        <td className="px-3 py-3 text-center">
          {hasIssues ? (
            <button
              onClick={onToggleIssues}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-muted-foreground hover:text-foreground cursor-pointer"
            >
              {isError ? (
                <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              )}
              {product.errors.length + product.warnings.length}
              {isExpandedIssues ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
          ) : (
            <span className="text-emerald-500 text-xs">✓</span>
          )}
        </td>
      </tr>

      {/* Expanded Issues Drawer */}
      {isExpandedIssues && hasIssues && (
        <tr className={isError ? "bg-destructive/5" : "bg-amber-50/50 dark:bg-amber-950/20"}>
          <td colSpan={10} className="px-8 py-3">
            <ul className="space-y-1 text-[11px]">
              {product.errors.map((e, idx) => (
                <li key={idx} className="flex items-center gap-2 text-destructive font-medium">
                  <XCircle className="h-3.5 w-3.5 shrink-0" />
                  {e}
                </li>
              ))}
              {product.warnings.map((w, idx) => (
                <li
                  key={idx}
                  className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-medium"
                >
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {w}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}

      {/* Expanded Variants Matrix Drawer */}
      {isExpandedVariants && product.variants.length > 0 && (
        <tr className="bg-muted/40">
          <td colSpan={10} className="p-4">
            <div className="rounded-xl border border-border bg-card p-3 shadow-inner">
              <p className="text-xs font-black text-foreground mb-2 flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-primary" />
                Variant Matrix ({product.variants.length} items)
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border text-left font-bold">
                      <th className="pb-1.5">Variant Name</th>
                      <th className="pb-1.5">Color</th>
                      <th className="pb-1.5">Size</th>
                      <th className="pb-1.5">SKU</th>
                      <th className="pb-1.5">Barcode</th>
                      <th className="pb-1.5 text-right">Stock</th>
                      <th className="pb-1.5 text-right">Price Override</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {product.variants.map((v, vIdx) => (
                      <tr key={vIdx} className="hover:bg-muted/30">
                        <td className="py-1 font-bold text-foreground">{v.name}</td>
                        <td className="py-1 text-muted-foreground">{v.color || "—"}</td>
                        <td className="py-1 text-muted-foreground">{v.size || "—"}</td>
                        <td className="py-1 font-mono text-muted-foreground">{v.sku}</td>
                        <td className="py-1 font-mono text-muted-foreground">
                          {v.barcode || "—"}
                        </td>
                        <td className="py-1 text-right font-bold text-foreground">{v.stock}</td>
                        <td className="py-1 text-right text-muted-foreground">
                          {v.priceOverride ? `₹${v.priceOverride}` : "Inherit"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: BulkProductGroup["status"] }) {
  const map = {
    new: {
      label: "New",
      cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-400",
    },
    update: {
      label: "Update",
      cls: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-400",
    },
    skip: {
      label: "Skip",
      cls: "bg-muted text-muted-foreground",
    },
    error: {
      label: "Error",
      cls: "bg-destructive/10 text-destructive",
    },
  };
  const { label, cls } = map[status];
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${cls}`}>{label}</span>;
}

function MetricCard({
  label,
  value,
  subtitle,
  color,
  bg,
}: {
  label: string;
  value: number;
  subtitle: string;
  color: string;
  bg: string;
}) {
  return (
    <div className={`rounded-2xl border p-3.5 ${bg}`}>
      <p className={`text-xl font-black ${color}`}>{value}</p>
      <p className="text-[11px] font-bold text-foreground mt-0.5">{label}</p>
      <p className="text-[10px] text-muted-foreground">{subtitle}</p>
    </div>
  );
}

// ── Step 3: Results ────────────────────────────────────────────────────────

function StepResults({
  result,
  onReset,
  onBack,
}: {
  result: CommitResult;
  onReset: () => void;
  onBack: () => void;
}) {
  const allGood = result.failed.length === 0;

  return (
    <div className="space-y-6">
      {/* Hero Result Banner */}
      <div
        className={`flex flex-col items-center gap-3 rounded-3xl border p-10 text-center ${
          allGood
            ? "border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/60 dark:bg-emerald-950/30"
            : "border-amber-200 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-950/30"
        }`}
      >
        {allGood ? (
          <CheckCircle2 className="h-14 w-14 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <AlertTriangle className="h-14 w-14 text-amber-600 dark:text-amber-400" />
        )}
        <div>
          <p className="text-2xl font-black text-foreground">
            {result.succeeded + result.updated} Products Processed
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {result.succeeded} created · {result.updated} updated ·{" "}
            {result.totalMediaUploaded} media files uploaded
          </p>
        </div>
      </div>

      {/* Failed Products Breakdown */}
      {result.failed.length > 0 && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <h3 className="text-sm font-bold text-foreground">
              Failed Products ({result.failed.length})
            </h3>
            <button
              onClick={() => downloadFailureReport(result.failed)}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline cursor-pointer"
            >
              <FileDown className="h-3.5 w-3.5" />
              Download Failure Report
            </button>
          </div>
          <div className="divide-y divide-border max-h-64 overflow-y-auto">
            {result.failed.map((p, idx) => (
              <div key={idx} className="flex items-start gap-3 px-5 py-3">
                <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-foreground">
                    Row {p.rowIndices.join(", ")}: {p.name || p.sku}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {p.errors.join("; ")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Catalog Synced Notification */}
      <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
        <span>
          Storefront catalog, Admin inventory, delivery fees, and offline POS caches have all been
          synchronized automatically.
        </span>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3 justify-between pt-2">
        <button
          onClick={onReset}
          className="inline-flex items-center gap-2 rounded-2xl border border-border px-5 py-2.5 text-xs font-bold text-muted-foreground hover:bg-muted transition cursor-pointer"
        >
          <RefreshCw className="h-4 w-4" />
          Import Another Package
        </button>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-2xl bg-primary px-6 py-2.5 text-xs font-black text-primary-foreground hover:opacity-90 transition cursor-pointer shadow-md"
        >
          <SkipForward className="h-4 w-4" />
          View Products in Admin
        </button>
      </div>
    </div>
  );
}
