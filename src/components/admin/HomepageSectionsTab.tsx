import { useState } from "react";
import {
  Layers,
  Plus,
  Pencil,
  Trash2,
  Copy,
  Eye,
  EyeOff,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  Grid,
  Sliders,
  Sparkles,
  Package,
} from "lucide-react";
import {
  type HomepageSection,
  useHomepageSections,
  useToggleSectionVisibility,
  useReorderSections,
  useDuplicateSection,
  useDeleteSection,
} from "@/lib/homepage-sections";
import { SectionEditorModal } from "@/components/admin/SectionEditorModal";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { Link } from "@tanstack/react-router";

export function HomepageSectionsTab() {
  const { data: sections = [], isLoading } = useHomepageSections(true);
  const toggleVisibility = useToggleSectionVisibility();
  const reorder = useReorderSections();
  const duplicate = useDuplicateSection();
  const remove = useDeleteSection();

  const [editingSection, setEditingSection] = useState<HomepageSection | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const moveSection = async (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= sections.length) return;

    const copy = [...sections];
    const temp = copy[index];
    copy[index] = copy[targetIndex];
    copy[targetIndex] = temp;

    const reorderedPayload = copy.map((sec, idx) => ({
      id: sec.id,
      sort_order: idx + 1,
    }));

    await reorder.mutateAsync(reorderedPayload);
  };

  const getSourceBadge = (source: string) => {
    switch (source) {
      case "BESTSELLERS":
        return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-400";
      case "NEW_ARRIVALS":
        return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-400";
      case "DISCOUNTED":
        return "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-400";
      case "CATEGORY":
        return "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-400";
      default:
        return "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-400";
    }
  };

  return (
    <div className="space-y-6">
      {/* Top action bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-3xl border border-border bg-card p-6 shadow-sm">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">
            Homepage Section Manager
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Curate, reorder, and customize the dynamic sections displayed on the live homepage.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            to="/"
            target="_blank"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-4 py-2 text-xs font-bold text-foreground hover:bg-muted transition"
          >
            <ExternalLink className="size-3.5" /> View Storefront
          </Link>
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-xs font-bold text-primary-foreground shadow-md hover:bg-primary/90 transition cursor-pointer"
          >
            <Plus className="size-4" /> Add Section
          </button>
        </div>
      </div>

      {/* Sections Table / Cards */}
      {isLoading ? (
        <div className="p-12 text-center rounded-3xl border border-border bg-card animate-pulse">
          <p className="text-sm font-semibold text-muted-foreground">Loading sections...</p>
        </div>
      ) : sections.length === 0 ? (
        <div className="p-16 text-center rounded-3xl border border-dashed border-border bg-card">
          <Layers className="size-10 mx-auto text-muted-foreground/40 mb-3" />
          <h3 className="text-base font-bold text-foreground">No Homepage Sections Yet</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            Create your first dynamic homepage section to display curated product collections.
          </p>
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-xs font-bold text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            <Plus className="size-3.5" /> Create Section
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {sections.map((section, index) => (
            <div
              key={section.id}
              className={`flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl border transition-all ${
                section.is_visible
                  ? "bg-card border-border shadow-sm hover:border-primary/40"
                  : "bg-muted/30 border-dashed border-border/70 opacity-70"
              }`}
            >
              {/* Left Details */}
              <div className="flex items-start md:items-center gap-3 min-w-0">
                {/* Reorder Buttons */}
                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={index === 0 || reorder.isPending}
                    onClick={() => moveSection(index, "up")}
                    aria-label={`Move ${section.title} up`}
                    className="size-7 grid place-items-center rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={index === sections.length - 1 || reorder.isPending}
                    onClick={() => moveSection(index, "down")}
                    aria-label={`Move ${section.title} down`}
                    className="size-7 grid place-items-center rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                </div>

                {/* Section Icon / Position */}
                <div className="grid size-10 place-items-center rounded-2xl bg-secondary text-primary font-bold text-xs shrink-0">
                  #{index + 1}
                </div>

                {/* Info */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-bold text-foreground truncate">
                      {section.title}
                    </h3>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${getSourceBadge(
                        section.source_type,
                      )}`}
                    >
                      {section.source_type}
                    </span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground flex items-center gap-1">
                      {section.section_type === "PRODUCT_CAROUSEL" ? (
                        <>
                          <Sliders className="size-2.5" /> Carousel
                        </>
                      ) : (
                        <>
                          <Grid className="size-2.5" /> Grid
                        </>
                      )}
                    </span>
                    {section.status === "draft" && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                        Draft
                      </span>
                    )}
                  </div>

                  {section.subtitle && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                      {section.subtitle}
                    </p>
                  )}

                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1">
                    <span>
                      {section.source_type === "MANUAL"
                        ? `${section.items?.length ?? 0} curated items`
                        : `Auto rules (Max ${section.display_settings.max_products || 8})`}
                    </span>
                    <span>•</span>
                    <span>CTA: "{section.display_settings.cta_label || "View all"}"</span>
                  </div>
                </div>
              </div>

              {/* Right Action Controls */}
              <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                {/* Fast Visibility Toggle */}
                <button
                  type="button"
                  onClick={() =>
                    toggleVisibility.mutate({ id: section.id, is_visible: !section.is_visible })
                  }
                  title={section.is_visible ? "Hide from homepage" : "Show on homepage"}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition cursor-pointer border ${
                    section.is_visible
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800"
                      : "bg-muted text-muted-foreground border-border"
                  }`}
                >
                  {section.is_visible ? (
                    <>
                      <Eye className="size-3.5" /> Visible
                    </>
                  ) : (
                    <>
                      <EyeOff className="size-3.5" /> Hidden
                    </>
                  )}
                </button>

                {/* Edit Button */}
                <button
                  type="button"
                  onClick={() => setEditingSection(section)}
                  className="size-8 grid place-items-center rounded-full border border-border bg-background text-foreground hover:bg-muted transition cursor-pointer"
                  title="Edit section"
                >
                  <Pencil className="size-3.5" />
                </button>

                {/* Duplicate Button */}
                <button
                  type="button"
                  disabled={duplicate.isPending}
                  onClick={() => duplicate.mutate(section)}
                  className="size-8 grid place-items-center rounded-full border border-border bg-background text-foreground hover:bg-muted transition cursor-pointer disabled:opacity-50"
                  title="Duplicate section"
                >
                  <Copy className="size-3.5" />
                </button>

                {/* Delete Button */}
                <button
                  type="button"
                  onClick={() => setDeletingId(section.id)}
                  className="size-8 grid place-items-center rounded-full border border-destructive/20 bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground transition cursor-pointer"
                  title="Delete section"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Editor Modal */}
      {(isCreating || editingSection) && (
        <SectionEditorModal
          section={editingSection}
          onClose={() => {
            setIsCreating(false);
            setEditingSection(null);
          }}
        />
      )}

      {/* Delete Confirmation */}
      {deletingId && (
        <ConfirmDialog
          destructive
          title="Delete this homepage section?"
          message="This section will be removed from the homepage. The products inside will remain in the catalog."
          confirmLabel="Delete Section"
          busy={remove.isPending}
          onCancel={() => setDeletingId(null)}
          onConfirm={() => {
            remove.mutate(deletingId, {
              onSuccess: () => setDeletingId(null),
            });
          }}
        />
      )}
    </div>
  );
}
