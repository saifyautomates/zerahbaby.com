import { useState, useEffect } from "react";
import {
  Pencil,
  Plus,
  Trash2,
  Check,
  RotateCcw,
  Sparkles,
  Save,
  X,
  Eye,
  FileText,
  HelpCircle,
} from "lucide-react";
import { useAdminMode } from "@/lib/admin-mode";
import { usePageContent, type PolicyPageContent, type PolicySection } from "@/lib/pages-content";

export function EditablePolicyPage({
  pageKey,
  defaultContent,
  pageUrl,
}: {
  pageKey: string;
  defaultContent: PolicyPageContent;
  pageUrl?: string;
}) {
  const { adminMode } = useAdminMode();
  const { content, save, isSaving, resetToDefault, isResetting } =
    usePageContent<PolicyPageContent>(pageKey, defaultContent);

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<PolicyPageContent>(content);
  const [previewTab, setPreviewTab] = useState<"edit" | "preview">("edit");

  // Keep draft in sync with loaded content
  useEffect(() => {
    setDraft(content);
  }, [content]);

  const handleSave = () => {
    save(draft, {
      onSuccess: () => {
        setIsEditing(false);
      },
    });
  };

  const handleAddSection = () => {
    const newSection: PolicySection = {
      id: `sec-${Date.now()}`,
      title: `${draft.sections.length + 1}. New Policy Section`,
      content: "Enter detailed policy guidelines and details here.",
    };
    setDraft({
      ...draft,
      sections: [...draft.sections, newSection],
    });
  };

  const handleRemoveSection = (index: number) => {
    const updated = draft.sections.filter((_, idx) => idx !== index);
    setDraft({ ...draft, sections: updated });
  };

  const handleUpdateSection = (index: number, field: keyof PolicySection, value: unknown) => {
    const updated = [...draft.sections];
    updated[index] = { ...updated[index], [field]: value };
    setDraft({ ...draft, sections: updated });
  };

  const handleAddBullet = (secIndex: number) => {
    const sec = draft.sections[secIndex];
    const bullets = sec.bullets ? [...sec.bullets, "New list item"] : ["New list item"];
    handleUpdateSection(secIndex, "bullets", bullets);
  };

  const handleUpdateBullet = (secIndex: number, bulletIndex: number, text: string) => {
    const sec = draft.sections[secIndex];
    if (!sec.bullets) return;
    const bullets = [...sec.bullets];
    bullets[bulletIndex] = text;
    handleUpdateSection(secIndex, "bullets", bullets);
  };

  const handleRemoveBullet = (secIndex: number, bulletIndex: number) => {
    const sec = draft.sections[secIndex];
    if (!sec.bullets) return;
    const bullets = sec.bullets.filter((_, i) => i !== bulletIndex);
    handleUpdateSection(secIndex, "bullets", bullets);
  };

  return (
    <div className="relative mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Admin Mode Bar & Controls */}
      {adminMode && (
        <div className="mb-8 rounded-2xl border-2 border-primary/40 bg-primary/5 p-4 shadow-sm backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs">
                <Sparkles className="size-4" />
              </span>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-primary">
                  Admin Live Page Editor
                </p>
                <p className="text-xs text-muted-foreground">
                  You can edit all text, headings, and sections on this page. All changes sync to
                  Supabase database.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {!isEditing ? (
                <button
                  type="button"
                  onClick={() => {
                    setDraft(content);
                    setIsEditing(true);
                  }}
                  className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm transition hover:bg-primary/90 cursor-pointer active:scale-95"
                >
                  <Pencil className="size-3.5" /> Edit This Page
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={handleSave}
                    className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 cursor-pointer active:scale-95 disabled:opacity-50"
                  >
                    <Save className="size-3.5" /> {isSaving ? "Saving to DB…" : "Save Changes"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(content);
                      setIsEditing(false);
                    }}
                    className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-muted cursor-pointer"
                  >
                    <X className="size-3.5" /> Cancel
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* EDIT MODE ACTIVE */}
      {isEditing ? (
        <div className="space-y-6 rounded-3xl border border-primary/30 bg-card p-6 shadow-xl animate-in fade-in duration-200">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              <FileText className="size-5 text-primary" /> Editing Page Content
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPreviewTab(previewTab === "edit" ? "preview" : "edit")}
                className="flex items-center gap-1 rounded-lg border border-border px-3 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted cursor-pointer"
              >
                <Eye className="size-3.5" />{" "}
                {previewTab === "edit" ? "Live Preview" : "Edit Fields"}
              </button>
              <button
                type="button"
                disabled={isResetting}
                onClick={() => {
                  if (confirm("Reset this page to its standard original default template?")) {
                    resetToDefault();
                    setIsEditing(false);
                  }
                }}
                className="flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 cursor-pointer"
                title="Reset to factory template"
              >
                <RotateCcw className="size-3.5" /> Reset Template
              </button>
            </div>
          </div>

          {previewTab === "edit" ? (
            <div className="space-y-5">
              {/* PAGE TITLE */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
                  Page Title (H1)
                </label>
                <input
                  type="text"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-lg font-bold text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>

              {/* LAST UPDATED */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
                  Last Updated Date Text
                </label>
                <input
                  type="text"
                  value={draft.lastUpdated}
                  onChange={(e) => setDraft({ ...draft, lastUpdated: e.target.value })}
                  placeholder="e.g. August 27, 2026"
                  className="w-full rounded-xl border border-border bg-background px-4 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>

              {/* INTRO PARAGRAPH */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
                  Intro Paragraph (Optional)
                </label>
                <textarea
                  rows={2}
                  value={draft.intro || ""}
                  onChange={(e) => setDraft({ ...draft, intro: e.target.value })}
                  className="w-full rounded-xl border border-border bg-background p-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>

              {/* SECTIONS */}
              <div className="space-y-4 pt-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
                    Policy Sections ({draft.sections.length})
                  </h3>
                  <button
                    type="button"
                    onClick={handleAddSection}
                    className="flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary hover:bg-primary/20 transition cursor-pointer"
                  >
                    <Plus className="size-3.5" /> Add Section
                  </button>
                </div>

                {draft.sections.map((section, idx) => (
                  <div
                    key={section.id || idx}
                    className="rounded-2xl border border-border/80 bg-muted/20 p-4 space-y-3 relative group"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <input
                        type="text"
                        value={section.title}
                        onChange={(e) => handleUpdateSection(idx, "title", e.target.value)}
                        placeholder="Section Heading"
                        className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-bold text-foreground outline-none focus:border-primary"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveSection(idx)}
                        className="rounded-lg p-1.5 text-destructive hover:bg-destructive/10 transition cursor-pointer"
                        title="Delete Section"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>

                    <textarea
                      rows={3}
                      value={section.content}
                      onChange={(e) => handleUpdateSection(idx, "content", e.target.value)}
                      placeholder="Section content and description..."
                      className="w-full rounded-lg border border-border bg-background p-3 text-sm text-foreground outline-none focus:border-primary"
                    />

                    {/* BULLET POINTS */}
                    <div className="space-y-2 pt-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-muted-foreground">
                          Bullet Points (Optional)
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAddBullet(idx)}
                          className="text-[11px] font-bold text-primary hover:underline cursor-pointer"
                        >
                          + Add Bullet
                        </button>
                      </div>

                      {(section.bullets || []).map((bullet, bIdx) => (
                        <div key={bIdx} className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">•</span>
                          <input
                            type="text"
                            value={bullet}
                            onChange={(e) => handleUpdateBullet(idx, bIdx, e.target.value)}
                            className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs text-foreground outline-none focus:border-primary"
                          />
                          <button
                            type="button"
                            onClick={() => handleRemoveBullet(idx, bIdx)}
                            className="text-muted-foreground hover:text-destructive p-1 cursor-pointer"
                            title="Remove bullet"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* SAVE / CANCEL ACTION BUTTONS */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="rounded-full border border-border px-5 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={handleSave}
                  className="flex items-center gap-2 rounded-full bg-primary px-6 py-2 text-sm font-bold text-primary-foreground shadow-md hover:bg-primary/90 cursor-pointer disabled:opacity-60"
                >
                  <Check className="size-4" /> {isSaving ? "Saving to Database…" : "Save Changes"}
                </button>
              </div>
            </div>
          ) : (
            /* PREVIEW TAB */
            <div className="space-y-6 pt-2">
              <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                {draft.title}
              </h1>
              <p className="text-xs text-muted-foreground">Last updated: {draft.lastUpdated}</p>
              {draft.intro && (
                <p className="text-muted-foreground leading-relaxed text-sm">{draft.intro}</p>
              )}
              {draft.sections.map((sec) => (
                <div key={sec.id} className="space-y-2">
                  <h2 className="text-lg font-bold text-foreground">{sec.title}</h2>
                  <p className="text-muted-foreground leading-relaxed text-sm whitespace-pre-line">
                    {sec.content}
                  </p>
                  {sec.bullets && sec.bullets.length > 0 && (
                    <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                      {sec.bullets.map((b, bi) => (
                        <li key={bi}>{b}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* NORMAL STOREFRONT VIEW */
        <div className="space-y-6 text-muted-foreground leading-relaxed">
          <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {content.title}
          </h1>

          <p className="text-sm text-muted-foreground">Last updated: {content.lastUpdated}</p>

          {content.intro && <p className="text-foreground/90 font-medium">{content.intro}</p>}

          {content.sections.map((section) => (
            <div key={section.id} className="mt-8 space-y-3">
              <h2 className="text-xl font-semibold text-foreground">{section.title}</h2>
              <p className="text-muted-foreground leading-relaxed whitespace-pre-line">
                {section.content}
              </p>
              {section.bullets && section.bullets.length > 0 && (
                <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
                  {section.bullets.map((bullet, bIdx) => (
                    <li key={bIdx}>{bullet}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
