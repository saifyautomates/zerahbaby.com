/**
 * BulkImportTab.tsx
 *
 * 4-step wizard for bulk product import/update.
 * Plugs into ProductsTab in admin.tsx.
 *
 * Steps:
 *   0 — Landing   (download template, choose mode)
 *   1 — Upload    (drag-and-drop / browse)
 *   2 — Preview   (validation table with per-row status)
 *   3 — Commit    (progress bar + results)
 */

import { useState, useRef, useCallback, useEffect } from "react";
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
} from "lucide-react";

import {
  type BulkRow,
  type BulkMode,
  type CommitProgress,
  type CommitResult,
  parseFile,
  validateRows,
  commitBatch,
  fetchExistingProducts,
  downloadCsvTemplate,
  downloadFailureReport,
  VALID_CATEGORIES,
  VALID_AGE_GROUPS,
} from "@/lib/bulk-import";

// ─────────────────────────────────────────────────────────────────────────────
// Types / constants
// ─────────────────────────────────────────────────────────────────────────────

type WizardStep = 0 | 1 | 2 | 3;

const STEP_LABELS = ["Setup", "Upload", "Preview & Validate", "Results"];

const MODE_OPTIONS: { value: BulkMode; label: string; description: string }[] = [
  {
    value: "new_and_update",
    label: "New + Update",
    description: "Create new products AND update existing ones matched by slug.",
  },
  {
    value: "new_only",
    label: "New Products Only",
    description: "Only create new products. Rows matching existing slugs are skipped.",
  },
  {
    value: "stock_only",
    label: "Stock Update Only",
    description: "Only update stock quantities for existing products. New products are skipped.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Main component
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
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [filterStatus, setFilterStatus] = useState<"all" | "new" | "update" | "skip" | "error">(
    "all",
  );
  const [expandedErrors, setExpandedErrors] = useState<Set<number>>(new Set());
  const [isValidating, setIsValidating] = useState(false);

  // Commit state
  const [progress, setProgress] = useState<CommitProgress | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // ── Derived counts ────────────────────────────────────────────────────────
  const counts = {
    new: rows.filter((r) => r.status === "new").length,
    update: rows.filter((r) => r.status === "update").length,
    skip: rows.filter((r) => r.status === "skip").length,
    error: rows.filter((r) => r.status === "error").length,
    selected: rows.filter((r) => r.selected).length,
  };

  const filteredRows =
    filterStatus === "all" ? rows : rows.filter((r) => r.status === filterStatus);

  // ── File handling ─────────────────────────────────────────────────────────
  const handleFile = useCallback(
    async (f: File) => {
      setParseError(null);
      setFile(f);
      setIsParsing(true);

      try {
        const rawRows = await parseFile(f);
        if (rawRows.length === 0) {
          throw new Error("The file contains no data rows.");
        }
        if (rawRows.length > 2000) {
          throw new Error(
            `File has ${rawRows.length} rows. Maximum allowed is 2,000 rows per import.`,
          );
        }

        setIsValidating(true);
        const existing = await fetchExistingProducts();
        const validated = validateRows(rawRows, existing, mode);
        setRows(validated);
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

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
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

  // ── Row selection ─────────────────────────────────────────────────────────
  const toggleRow = (index: number) => {
    setRows((prev) => prev.map((r) => (r.index === index ? { ...r, selected: !r.selected } : r)));
  };

  const toggleAll = () => {
    const allEligible = filteredRows.filter((r) => r.status !== "error" && r.status !== "skip");
    const allSelected = allEligible.every((r) => r.selected);
    setRows((prev) =>
      prev.map((r) => {
        if (r.status === "error" || r.status === "skip") return r;
        if (filteredRows.find((fr) => fr.index === r.index)) {
          return { ...r, selected: !allSelected };
        }
        return r;
      }),
    );
  };

  // ── Commit ────────────────────────────────────────────────────────────────
  const handleCommit = async () => {
    const ac = new AbortController();
    abortRef.current = ac;
    setIsCommitting(true);
    setProgress({ current: 0, total: counts.selected, message: "Starting…" });

    try {
      const res = await commitBatch(rows, ac.signal, (p) => setProgress(p));
      setResult(res);

      // Invalidate all relevant caches
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["products"] }),
        qc.invalidateQueries({ queryKey: ["admin-products"] }),
        qc.invalidateQueries({ queryKey: ["inventory-products"] }),
        qc.invalidateQueries({ queryKey: ["categories"] }),
      ]);

      // Also refresh offline-sync catalog cache
      import("@/lib/offline-sync-engine")
        .then((m) => {
          if (typeof m.cacheFullCatalog === "function") {
            m.cacheFullCatalog([]).catch(() => null);
          }
        })
        .catch(() => null);

      setStep(3);
      if (res.failed.length === 0) {
        toast.success(
          `✓ ${res.succeeded} product${res.succeeded !== 1 ? "s" : ""} imported successfully`,
        );
      } else {
        toast.warning(`${res.succeeded} succeeded · ${res.failed.length} failed`);
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

  // Cleanup on unmount
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // ── Reset ─────────────────────────────────────────────────────────────────
  const reset = () => {
    setStep(0);
    setFile(null);
    setRows([]);
    setResult(null);
    setProgress(null);
    setParseError(null);
    setFilterStatus("all");
    setExpandedErrors(new Set());
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-xl border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
          aria-label="Back to products list"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h2 className="text-lg font-extrabold text-foreground tracking-tight">
            Bulk Product Import
          </h2>
          <p className="text-xs text-muted-foreground font-medium">
            Import or update hundreds of products from a CSV or Excel file
          </p>
        </div>
      </div>

      {/* ── Progress stepper ───────────────────────────────────────────────── */}
      <StepIndicator current={step} labels={STEP_LABELS} />

      {/* ── Step content ───────────────────────────────────────────────────── */}
      {step === 0 && <StepSetup mode={mode} onModeChange={setMode} onNext={() => setStep(1)} />}

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
          rows={filteredRows}
          allRows={rows}
          counts={counts}
          filterStatus={filterStatus}
          expandedErrors={expandedErrors}
          onFilterChange={setFilterStatus}
          onToggleRow={toggleRow}
          onToggleAll={toggleAll}
          onToggleExpand={(idx) =>
            setExpandedErrors((prev) => {
              const next = new Set(prev);
              if (next.has(idx)) {
                next.delete(idx);
              } else {
                next.add(idx);
              }
              return next;
            })
          }
          onBack={() => {
            setStep(1);
            setFile(null);
            setRows([]);
            setParseError(null);
          }}
          onCommit={handleCommit}
          isCommitting={isCommitting}
          progress={progress}
          onCancel={handleCancel}
        />
      )}

      {step === 3 && result && <StepResults result={result} onReset={reset} onBack={onBack} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function StepIndicator({ current, labels }: { current: number; labels: string[] }) {
  return (
    <div className="flex items-center gap-0">
      {labels.map((label, i) => (
        <div key={i} className="flex items-center flex-1 last:flex-none">
          <div className="flex flex-col items-center gap-1">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-black transition-colors ${
                i < current
                  ? "bg-primary text-primary-foreground"
                  : i === current
                    ? "bg-primary text-primary-foreground ring-4 ring-primary/20"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {i < current ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
            </div>
            <span
              className={`text-[10px] font-bold hidden sm:block whitespace-nowrap ${
                i === current ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {label}
            </span>
          </div>
          {i < labels.length - 1 && (
            <div
              className={`flex-1 h-0.5 mx-2 mt-[-14px] transition-colors ${
                i < current ? "bg-primary" : "bg-border"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Step 0: Setup ──────────────────────────────────────────────────────────

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
      {/* Template download */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-foreground text-sm">Download CSV Template</h3>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Start with our pre-configured template. It includes all required and optional columns
              with 2 sample rows to guide you.
            </p>
            <button
              onClick={downloadCsvTemplate}
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:opacity-90 transition cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              Download Template
            </button>
          </div>
        </div>
      </div>

      {/* Column reference */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <h3 className="font-bold text-foreground text-sm mb-3">Column Reference</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {[
            { col: "name", req: true, note: "Product title (max 120 chars)" },
            { col: "slug", req: true, note: "URL slug — auto-generated from name if blank" },
            { col: "brand", req: true, note: "Brand name" },
            { col: "category", req: true, note: VALID_CATEGORIES.join(", ") },
            { col: "price", req: true, note: "Selling price (₹)" },
            { col: "mrp", req: true, note: "MRP must be ≥ price" },
            { col: "age_group", req: true, note: VALID_AGE_GROUPS.join(", ") },
            { col: "stock", req: true, note: "Quantity on hand (integer)" },
            { col: "sku", req: false, note: "Auto-generated if blank" },
            { col: "barcode", req: false, note: "8-14 digit number; auto-generated if blank" },
            { col: "description", req: false, note: "Full product description" },
            { col: "highlights", req: false, note: "Pipe-separated: A | B | C" },
            { col: "buying_price", req: false, note: "Cost price (internal only)" },
            { col: "low_stock_at", req: false, note: "Low-stock threshold (default 5)" },
            { col: "sort_order", req: false, note: "Display order (default 999)" },
            { col: "is_featured", req: false, note: "true / false" },
            { col: "is_active", req: false, note: "true / false (default true)" },
            { col: "image_url", req: false, note: "Primary product image URL" },
            { col: "image_url_2", req: false, note: "Additional image URL" },
            { col: "image_url_3", req: false, note: "Additional image URL" },
          ].map(({ col, req, note }) => (
            <div key={col} className="flex gap-2 items-start">
              <code
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono font-bold ${req ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
              >
                {col}
              </code>
              <span className="text-muted-foreground leading-relaxed">{note}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Mode selector */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <h3 className="font-bold text-foreground text-sm mb-3">Import Mode</h3>
        <div className="space-y-2">
          {MODE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${
                mode === opt.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40 hover:bg-muted/40"
              }`}
            >
              <input
                type="radio"
                name="bulk-mode"
                value={opt.value}
                checked={mode === opt.value}
                onChange={() => onModeChange(opt.value)}
                className="mt-0.5 accent-primary"
              />
              <div>
                <p className="text-xs font-bold text-foreground">{opt.label}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{opt.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={onNext}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground hover:opacity-90 transition cursor-pointer"
        >
          Continue
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Step 1: Upload ─────────────────────────────────────────────────────────

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
    <div className="space-y-5">
      {/* Drop zone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => !isLoading && fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Upload CSV or Excel file"
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !isLoading) {
            fileInputRef.current?.click();
          }
        }}
        className={`flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-12 text-center transition-all ${
          isDragging
            ? "border-primary bg-primary/5 scale-[1.01]"
            : isLoading
              ? "cursor-not-allowed border-border bg-muted/30"
              : "cursor-pointer border-border hover:border-primary/50 hover:bg-muted/30"
        }`}
      >
        {isLoading ? (
          <>
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <div>
              <p className="text-sm font-bold text-foreground">
                {isValidating ? "Validating rows…" : "Parsing file…"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Checking against your live catalog
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Upload className="h-8 w-8" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">
                Drop your file here, or click to browse
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Accepts .csv, .xlsx, .xls · Max 5 MB · Max 2,000 rows
              </p>
            </div>
          </>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={onFileInput}
        aria-label="File upload input"
      />

      {parseError && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-destructive">Parse error</p>
            <p className="text-xs text-destructive/80 mt-0.5">{parseError}</p>
          </div>
        </div>
      )}

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-muted transition cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>
      </div>
    </div>
  );
}

// ── Step 2: Preview & Validate ─────────────────────────────────────────────

function StepPreview({
  rows,
  allRows,
  counts,
  filterStatus,
  expandedErrors,
  onFilterChange,
  onToggleRow,
  onToggleAll,
  onToggleExpand,
  onBack,
  onCommit,
  isCommitting,
  progress,
  onCancel,
}: {
  rows: BulkRow[];
  allRows: BulkRow[];
  counts: Record<string, number>;
  filterStatus: string;
  expandedErrors: Set<number>;
  onFilterChange: (s: "all" | "new" | "update" | "skip" | "error") => void;
  onToggleRow: (idx: number) => void;
  onToggleAll: () => void;
  onToggleExpand: (idx: number) => void;
  onBack: () => void;
  onCommit: () => void;
  isCommitting: boolean;
  progress: CommitProgress | null;
  onCancel: () => void;
}) {
  const eligibleInView = rows.filter((r) => r.status !== "error" && r.status !== "skip");
  const allSelected = eligibleInView.length > 0 && eligibleInView.every((r) => r.selected);

  const filterTabs = [
    { key: "all", label: "All", count: allRows.length },
    { key: "new", label: "New", count: counts.new },
    { key: "update", label: "Update", count: counts.update },
    { key: "skip", label: "Skip", count: counts.skip },
    { key: "error", label: "Errors", count: counts.error },
  ] as const;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard
          value={counts.new}
          label="New Products"
          color="text-emerald-600 dark:text-emerald-400"
          bg="bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200/60 dark:border-emerald-800/40"
        />
        <SummaryCard
          value={counts.update}
          label="Updates"
          color="text-blue-600 dark:text-blue-400"
          bg="bg-blue-50 dark:bg-blue-950/40 border-blue-200/60 dark:border-blue-800/40"
        />
        <SummaryCard
          value={counts.skip}
          label="Skipped"
          color="text-muted-foreground"
          bg="bg-muted border-border"
        />
        <SummaryCard
          value={counts.error}
          label="Errors"
          color="text-destructive"
          bg="bg-destructive/5 border-destructive/20"
        />
      </div>

      {counts.error > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 px-4 py-2.5 text-xs font-medium text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {counts.error} row{counts.error !== 1 ? "s" : ""} have errors and will not be imported.
          Fix them in your file and re-upload, or proceed without them.
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1">
        {filterTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => onFilterChange(t.key)}
            className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition cursor-pointer ${
              filterStatus === t.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            <span
              className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${filterStatus === t.key ? "bg-primary-foreground/20" : "bg-border"}`}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Preview table */}
      <div className="overflow-hidden rounded-2xl border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={onToggleAll}
                    className="accent-primary cursor-pointer"
                    aria-label="Select all visible rows"
                  />
                </th>
                <th className="px-3 py-3 text-left font-bold text-muted-foreground w-8">#</th>
                <th className="px-3 py-3 text-left font-bold text-muted-foreground min-w-[180px]">
                  Name
                </th>
                <th className="px-3 py-3 text-left font-bold text-muted-foreground">SKU</th>
                <th className="px-3 py-3 text-left font-bold text-muted-foreground">Category</th>
                <th className="px-3 py-3 text-right font-bold text-muted-foreground">Price</th>
                <th className="px-3 py-3 text-right font-bold text-muted-foreground">Stock</th>
                <th className="px-3 py-3 text-center font-bold text-muted-foreground">Status</th>
                <th className="px-3 py-3 text-left font-bold text-muted-foreground">Issues</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-muted-foreground">
                    No rows match this filter.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <PreviewRow
                    key={row.index}
                    row={row}
                    isExpanded={expandedErrors.has(row.index)}
                    onToggle={() => onToggleRow(row.index)}
                    onToggleExpand={() => onToggleExpand(row.index)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Commit area */}
      {isCommitting && progress ? (
        <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-foreground">
              Importing… {progress.current} / {progress.total}
            </p>
            <button
              onClick={onCancel}
              className="flex items-center gap-1.5 text-xs font-bold text-destructive hover:underline cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </button>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{
                width: `${Math.round((progress.current / Math.max(progress.total, 1)) * 100)}%`,
              }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">{progress.message}</p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={onBack}
            disabled={isCommitting}
            className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-muted transition cursor-pointer disabled:opacity-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Re-upload
          </button>

          <div className="flex items-center gap-3">
            <p className="text-xs text-muted-foreground">
              <span className="font-bold text-foreground">{counts.selected}</span> row
              {counts.selected !== 1 ? "s" : ""} selected
            </p>
            <button
              onClick={onCommit}
              disabled={counts.selected === 0 || isCommitting}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground hover:opacity-90 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Apply {counts.selected} Row{counts.selected !== 1 ? "s" : ""}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewRow({
  row,
  isExpanded,
  onToggle,
  onToggleExpand,
}: {
  row: BulkRow;
  isExpanded: boolean;
  onToggle: () => void;
  onToggleExpand: () => void;
}) {
  const isError = row.status === "error";
  const isSkip = row.status === "skip";
  const hasIssues = row.errors.length > 0 || row.warnings.length > 0;

  const rowBg = isError
    ? "bg-destructive/5"
    : isSkip
      ? "opacity-50"
      : row.status === "update"
        ? "bg-blue-50/50 dark:bg-blue-950/20"
        : "";

  return (
    <>
      <tr className={`${rowBg} transition`}>
        <td className="px-3 py-2.5 text-center">
          <input
            type="checkbox"
            checked={row.selected}
            onChange={onToggle}
            disabled={isError || isSkip}
            className="accent-primary cursor-pointer disabled:cursor-not-allowed"
            aria-label={`Select row ${row.index + 2}`}
          />
        </td>
        <td className="px-3 py-2.5 text-muted-foreground font-mono">{row.index + 2}</td>
        <td className="px-3 py-2.5 font-medium text-foreground max-w-[220px] truncate">
          {row.name || <span className="text-muted-foreground italic">—</span>}
        </td>
        <td className="px-3 py-2.5 font-mono text-muted-foreground">{row.sku || "—"}</td>
        <td className="px-3 py-2.5 capitalize text-muted-foreground">{row.category || "—"}</td>
        <td className="px-3 py-2.5 text-right font-medium text-foreground">
          {row.price > 0 ? `₹${row.price.toLocaleString("en-IN")}` : "—"}
        </td>
        <td className="px-3 py-2.5 text-right text-muted-foreground">{row.stock}</td>
        <td className="px-3 py-2.5 text-center">
          <StatusBadge status={row.status} />
        </td>
        <td className="px-3 py-2.5">
          {hasIssues ? (
            <button
              onClick={onToggleExpand}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition cursor-pointer"
            >
              {isError ? (
                <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              )}
              {row.errors.length + row.warnings.length} issue
              {row.errors.length + row.warnings.length !== 1 ? "s" : ""}
              {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          ) : (
            <span className="text-muted-foreground/40">—</span>
          )}
        </td>
      </tr>
      {isExpanded && hasIssues && (
        <tr className={isError ? "bg-destructive/5" : "bg-amber-50/50 dark:bg-amber-950/20"}>
          <td colSpan={9} className="px-10 py-3">
            <ul className="space-y-1">
              {row.errors.map((e, i) => (
                <li key={i} className="flex items-start gap-2 text-[11px] text-destructive">
                  <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {e}
                </li>
              ))}
              {row.warnings.map((w, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-[11px] text-amber-600 dark:text-amber-400"
                >
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {w}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: BulkRow["status"] }) {
  const map = {
    new: {
      label: "New",
      cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
    },
    update: {
      label: "Update",
      cls: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
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
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}>{label}</span>;
}

function SummaryCard({
  value,
  label,
  color,
  bg,
}: {
  value: number;
  label: string;
  color: string;
  bg: string;
}) {
  return (
    <div className={`rounded-xl border p-3 ${bg}`}>
      <p className={`text-2xl font-black ${color}`}>{value}</p>
      <p className="text-[11px] font-semibold text-muted-foreground mt-0.5">{label}</p>
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
      {/* Hero result */}
      <div
        className={`flex flex-col items-center gap-3 rounded-2xl border p-8 text-center ${
          allGood
            ? "border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/30"
            : "border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30"
        }`}
      >
        {allGood ? (
          <CheckCircle2 className="h-12 w-12 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <AlertTriangle className="h-12 w-12 text-amber-600 dark:text-amber-400" />
        )}
        <div>
          <p className="text-xl font-black text-foreground">
            {result.succeeded} product{result.succeeded !== 1 ? "s" : ""} imported
          </p>
          {result.failed.length > 0 && (
            <p className="text-sm text-muted-foreground mt-1">
              {result.failed.length} row{result.failed.length !== 1 ? "s" : ""} failed
            </p>
          )}
        </div>
      </div>

      {/* Failed rows */}
      {result.failed.length > 0 && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h3 className="text-sm font-bold text-foreground">
              Failed Rows ({result.failed.length})
            </h3>
            <button
              onClick={() => downloadFailureReport(result.failed)}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline cursor-pointer"
            >
              <FileDown className="h-3.5 w-3.5" />
              Download Report
            </button>
          </div>
          <div className="divide-y divide-border max-h-64 overflow-y-auto">
            {result.failed.map((row, i) => (
              <div key={i} className="flex items-start gap-3 px-5 py-3">
                <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-foreground">
                    Row {row.index + 2}: {row.name || "(unnamed)"}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {row.errors.join("; ")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Info about sync */}
      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        Product catalog, POS inventory, and offline cache have all been refreshed automatically.
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3 justify-between">
        <button
          onClick={onReset}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-muted transition cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Import Another File
        </button>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground hover:opacity-90 transition cursor-pointer"
        >
          <SkipForward className="h-3.5 w-3.5" />
          Go to Products
        </button>
      </div>
    </div>
  );
}
