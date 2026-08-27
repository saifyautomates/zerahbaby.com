import { useState } from "react";
import {
  FileText,
  Save,
  RotateCcw,
  ExternalLink,
  Plus,
  Trash2,
  Check,
  Eye,
  Shield,
  Truck,
  Undo2,
  Info,
  Layers,
  Sparkles,
} from "lucide-react";
import {
  usePageContent,
  type PolicyPageContent,
  type PolicySection,
  DEFAULT_CANCELLATION_REFUND,
  DEFAULT_PRIVACY_POLICY,
  DEFAULT_TERMS_CONDITIONS,
  DEFAULT_SHIPPING_DELIVERY,
  DEFAULT_RETURNS_POLICY,
} from "@/lib/pages-content";

interface PageConfig {
  id: string;
  title: string;
  url: string;
  icon: typeof FileText;
  settingKey: string;
  defaultContent: PolicyPageContent;
  description: string;
}

const PAGES_LIST: PageConfig[] = [
  {
    id: "cancellation",
    title: "Cancellation & Refund Policy",
    url: "/cancellation-refund",
    icon: Undo2,
    settingKey: "page_cancellation_refund",
    defaultContent: DEFAULT_CANCELLATION_REFUND,
    description:
      "Rules for order cancellations, return windows, non-returnable items, and refund processing.",
  },
  {
    id: "privacy",
    title: "Privacy Policy",
    url: "/privacy-policy",
    icon: Shield,
    settingKey: "page_privacy_policy",
    defaultContent: DEFAULT_PRIVACY_POLICY,
    description:
      "Customer data collection, usage, PCI-DSS payment compliance, and privacy protections.",
  },
  {
    id: "terms",
    title: "Terms & Conditions",
    url: "/terms-conditions",
    icon: FileText,
    settingKey: "page_terms_conditions",
    defaultContent: DEFAULT_TERMS_CONDITIONS,
    description: "Store usage rules, pricing terms, user agreements, and legal governing law.",
  },
  {
    id: "shipping",
    title: "Shipping & Delivery Policy",
    url: "/shipping-delivery",
    icon: Truck,
    settingKey: "page_shipping_delivery",
    defaultContent: DEFAULT_SHIPPING_DELIVERY,
    description:
      "Dispatch schedules, delivery timelines, free delivery threshold, and courier tracking.",
  },
  {
    id: "returns",
    title: "Returns & Exchange Policy",
    url: "/returns",
    icon: RotateCcw,
    settingKey: "page_returns",
    defaultContent: DEFAULT_RETURNS_POLICY,
    description:
      "7-day return guidelines, reverse doorstep pickup rules, and refund inspection criteria.",
  },
];

export function PagesPoliciesTab() {
  const [selectedPageId, setSelectedPageId] = useState<string>("cancellation");

  const currentPage = PAGES_LIST.find((p) => p.id === selectedPageId) || PAGES_LIST[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FileText className="size-5" />
            </span>
            Pages & Policy Content Management
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Edit text, headings, and policy guidelines across all store pages. All changes sync
            instantly to Supabase database.
          </p>
        </div>

        <a
          href={currentPage.url}
          className="flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-xs font-bold text-foreground shadow-xs hover:bg-muted transition"
        >
          <span>View Live Page ({currentPage.url})</span>
          <ExternalLink className="size-3.5 text-muted-foreground" />
        </a>
      </div>

      {/* Main Grid: Sidebar list of pages + Page Editor */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Navigation: Page Selector */}
        <div className="space-y-2 lg:col-span-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground px-1 mb-2">
            Store Pages ({PAGES_LIST.length})
          </h3>
          <div className="space-y-1.5">
            {PAGES_LIST.map((page) => {
              const Icon = page.icon;
              const isSelected = page.id === selectedPageId;
              return (
                <button
                  key={page.id}
                  type="button"
                  onClick={() => setSelectedPageId(page.id)}
                  className={`flex w-full items-start gap-3 rounded-2xl p-3.5 text-left transition cursor-pointer border ${
                    isSelected
                      ? "border-primary bg-primary/5 text-foreground shadow-sm ring-1 ring-primary/20"
                      : "border-border/60 bg-card hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl transition ${
                      isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                    }`}
                  >
                    <Icon className="size-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate text-foreground">{page.title}</p>
                    <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                      {page.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="rounded-2xl border border-border bg-card/60 p-4 mt-6">
            <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <Sparkles className="size-4 text-primary" /> Live Syncing
            </h4>
            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
              Every edit you save is immediately visible to all store visitors on both desktop &
              mobile. You can also edit in-place directly on any page when Admin Mode is ON.
            </p>
          </div>
        </div>

        {/* Right Editor for Selected Page */}
        <div className="lg:col-span-8">
          <SinglePageEditor key={currentPage.settingKey} pageConfig={currentPage} />
        </div>
      </div>
    </div>
  );
}

function SinglePageEditor({ pageConfig }: { pageConfig: PageConfig }) {
  const { content, save, isSaving, resetToDefault, isResetting } =
    usePageContent<PolicyPageContent>(pageConfig.settingKey, pageConfig.defaultContent);

  const [draft, setDraft] = useState<PolicyPageContent>(content);
  const [activeView, setActiveView] = useState<"edit" | "preview">("edit");

  // Keep draft updated when page selection changes
  useState(() => {
    setDraft(content);
  });

  const handleSave = () => {
    save(draft);
  };

  const handleAddSection = () => {
    const newSection: PolicySection = {
      id: `sec-${Date.now()}`,
      title: `${draft.sections.length + 1}. New Policy Section`,
      content: "Enter detailed terms and conditions or policy specifications here.",
    };
    setDraft({ ...draft, sections: [...draft.sections, newSection] });
  };

  const handleRemoveSection = (idx: number) => {
    setDraft({ ...draft, sections: draft.sections.filter((_, i) => i !== idx) });
  };

  const handleUpdateSection = (idx: number, field: keyof PolicySection, val: unknown) => {
    const sections = [...draft.sections];
    sections[idx] = { ...sections[idx], [field]: val };
    setDraft({ ...draft, sections });
  };

  const handleAddBullet = (secIdx: number) => {
    const sec = draft.sections[secIdx];
    const bullets = sec.bullets ? [...sec.bullets, "New policy point"] : ["New policy point"];
    handleUpdateSection(secIdx, "bullets", bullets);
  };

  const handleUpdateBullet = (secIdx: number, bIdx: number, text: string) => {
    const sec = draft.sections[secIdx];
    if (!sec.bullets) return;
    const bullets = [...sec.bullets];
    bullets[bIdx] = text;
    handleUpdateSection(secIdx, "bullets", bullets);
  };

  const handleRemoveBullet = (secIdx: number, bIdx: number) => {
    const sec = draft.sections[secIdx];
    if (!sec.bullets) return;
    handleUpdateSection(
      secIdx,
      "bullets",
      sec.bullets.filter((_, i) => i !== bIdx),
    );
  };

  return (
    <div className="rounded-3xl border border-border bg-card p-6 shadow-sm space-y-6">
      {/* Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h3 className="text-lg font-bold text-foreground">{pageConfig.title}</h3>
          <p className="text-xs text-muted-foreground">Path: {pageConfig.url}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveView(activeView === "edit" ? "preview" : "edit")}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-muted/40 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer"
          >
            <Eye className="size-3.5" /> {activeView === "edit" ? "Live Preview" : "Edit Fields"}
          </button>

          <button
            type="button"
            disabled={isResetting}
            onClick={() => {
              if (confirm(`Reset ${pageConfig.title} back to original default template?`)) {
                resetToDefault();
                setDraft(pageConfig.defaultContent);
              }
            }}
            className="flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition cursor-pointer"
            title="Reset to factory template"
          >
            <RotateCcw className="size-3.5" /> Reset
          </button>

          <button
            type="button"
            disabled={isSaving}
            onClick={handleSave}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition cursor-pointer active:scale-95 disabled:opacity-60"
          >
            <Save className="size-3.5" /> {isSaving ? "Saving…" : "Save to Database"}
          </button>
        </div>
      </div>

      {activeView === "edit" ? (
        <div className="space-y-5">
          {/* Main Title */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Page Main Heading (H1)
            </label>
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-base font-bold text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Last Updated */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
                Last Updated Date Display
              </label>
              <input
                type="text"
                value={draft.lastUpdated}
                onChange={(e) => setDraft({ ...draft, lastUpdated: e.target.value })}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
                Intro Highlight (Optional)
              </label>
              <input
                type="text"
                value={draft.intro || ""}
                onChange={(e) => setDraft({ ...draft, intro: e.target.value })}
                placeholder="Optional short introductory highlight text"
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* Policy Sections */}
          <div className="space-y-4 pt-3 border-t border-border">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                Policy Sections ({draft.sections.length})
              </h4>
              <button
                type="button"
                onClick={handleAddSection}
                className="flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary hover:bg-primary/20 transition cursor-pointer"
              >
                <Plus className="size-3.5" /> Add Section
              </button>
            </div>

            <div className="space-y-4">
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
                      placeholder="Section Title"
                      className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-bold text-foreground outline-none focus:border-primary"
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
                    placeholder="Section text and terms..."
                    className="w-full rounded-lg border border-border bg-background p-2.5 text-xs text-foreground outline-none focus:border-primary"
                  />

                  {/* Bullet points */}
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
                        + Add Bullet Point
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
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom Save Action */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSave}
              className="flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-xs font-bold text-primary-foreground shadow-md hover:bg-primary/90 transition cursor-pointer disabled:opacity-60"
            >
              <Check className="size-4" /> {isSaving ? "Saving to Database…" : "Save to Database"}
            </button>
          </div>
        </div>
      ) : (
        /* PREVIEW IN ADMIN */
        <div className="space-y-6 rounded-2xl border border-border bg-muted/10 p-6">
          <div className="border-b border-border pb-4">
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
              {draft.title}
            </h1>
            <p className="text-xs text-muted-foreground mt-1">Last updated: {draft.lastUpdated}</p>
            {draft.intro && (
              <p className="text-xs text-foreground/90 font-medium mt-2">{draft.intro}</p>
            )}
          </div>

          <div className="space-y-6 text-xs text-muted-foreground leading-relaxed">
            {draft.sections.map((sec) => (
              <div key={sec.id} className="space-y-2">
                <h3 className="text-sm font-bold text-foreground">{sec.title}</h3>
                <p className="whitespace-pre-line">{sec.content}</p>
                {sec.bullets && sec.bullets.length > 0 && (
                  <ul className="list-disc pl-5 space-y-1">
                    {sec.bullets.map((b, bi) => (
                      <li key={bi}>{b}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
