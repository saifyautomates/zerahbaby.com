/**
 * ZÉRAH BABY & KIDS — Smart Selection Summary Toolbar
 * Compact, sticky, live calculation bar displayed directly above tables/lists when rows are selected.
 */
import React from "react";
import { X, Sparkles } from "lucide-react";
import type { SummaryMetric } from "@/lib/table-selection";

export interface SmartSelectionSummaryProps {
  selectedCount: number;
  selectedLabel?: string;
  metrics: SummaryMetric[];
  onClear: () => void;
  actions?: React.ReactNode;
  className?: string;
}

export function SmartSelectionSummary({
  selectedCount,
  selectedLabel = "Selected",
  metrics,
  onClear,
  actions,
  className = "",
}: SmartSelectionSummaryProps) {
  if (selectedCount <= 0) return null;

  // Ensure no duplicate "Selected" chip is rendered if passed in metrics array
  const cleanMetrics = (metrics || []).filter((m) => {
    const lbl = m.label?.trim().toLowerCase() || "";
    return !lbl.startsWith("selected");
  });

  return (
    <div
      role="region"
      aria-label="Selection calculation summary"
      className={`sticky top-2 z-30 mb-4 animate-in fade-in slide-in-from-top-2 duration-200 ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/90 bg-card/95 p-2.5 sm:px-4 sm:py-2.5 shadow-md backdrop-blur-md transition-all">
        {/* Left: Metric Chips */}
        <div className="flex flex-1 flex-wrap items-center gap-2 sm:gap-3 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          <div className="flex items-center gap-1.5 rounded-xl bg-primary/10 px-2.5 py-1 text-primary border border-primary/20">
            <Sparkles className="size-3.5 animate-pulse text-primary shrink-0" />
            <span className="text-[11px] font-black uppercase tracking-wider">
              {selectedLabel}: {selectedCount}
            </span>
          </div>

          {cleanMetrics.map((m, i) => {
            let badgeBg = "bg-muted/70 text-foreground border-border/80";
            let valColor = "text-foreground font-black";

            if (m.highlight === "brand") {
              badgeBg = "bg-[#8B2020]/10 text-[#8B2020] border-[#8B2020]/20";
              valColor = "text-[#8B2020] font-black";
            } else if (m.highlight === "success") {
              badgeBg =
                "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
              valColor = "text-emerald-700 dark:text-emerald-400 font-black";
            } else if (m.highlight === "warning") {
              badgeBg = "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20";
              valColor = "text-amber-700 dark:text-amber-400 font-black";
            } else if (m.highlight === "danger") {
              badgeBg = "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20";
              valColor = "text-rose-700 dark:text-rose-400 font-black";
            }

            return (
              <div
                key={i}
                title={m.tooltip}
                className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs border ${badgeBg} whitespace-nowrap transition-all`}
              >
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {m.label}:
                </span>
                <span className={`tabular-nums ${valColor}`}>{m.value}</span>
              </div>
            );
          })}
        </div>

        {/* Right: Actions & Clear Selection */}
        <div className="flex items-center gap-2 shrink-0">
          {actions}

          <button
            type="button"
            onClick={onClear}
            aria-label="Clear selection"
            title="Clear current selection (Esc)"
            className="inline-flex items-center gap-1 rounded-xl border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer shadow-2xs"
          >
            <X className="size-3.5" />
            <span className="hidden sm:inline">Clear</span>
          </button>
        </div>
      </div>
    </div>
  );
}
