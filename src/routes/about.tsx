import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Heart,
  Leaf,
  ShieldCheck,
  Users,
  Pencil,
  Check,
  X,
  Save,
  Sparkles,
  RotateCcw,
  Plus,
  Trash2,
} from "lucide-react";
import { useState, useEffect } from "react";
import hero from "@/assets/hero-baby.jpg";
import { useAdminMode } from "@/lib/admin-mode";
import { usePageContent, DEFAULT_ABOUT_CONTENT, type AboutPageContent } from "@/lib/pages-content";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About Zerah Baby And Kid's — Gentle Essentials for Little Ones" },
      {
        name: "description",
        content:
          "Zerah Baby And Kid's is a parent-run baby store curating organic clothing, safe toys and trusted nursery gear. Learn how we test and choose every product.",
      },
      {
        property: "og:title",
        content: "About Zerah Baby And Kid's — Gentle Essentials for Little Ones",
      },
      {
        property: "og:description",
        content: "How a parent-run baby store curates and safety-tests every product.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AboutPage,
});

const valueIcons = [Leaf, ShieldCheck, Heart, Users];

function AboutPage() {
  const { adminMode } = useAdminMode();
  const { content, save, isSaving, resetToDefault } = usePageContent<AboutPageContent>(
    "page_about",
    DEFAULT_ABOUT_CONTENT,
  );

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<AboutPageContent>(content);

  useEffect(() => {
    setDraft(content);
  }, [content]);

  const handleSave = () => {
    save(draft, {
      onSuccess: () => setIsEditing(false),
    });
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      {/* Admin Mode Bar */}
      {adminMode && (
        <div className="mb-8 rounded-2xl border-2 border-primary/40 bg-primary/5 p-4 shadow-sm backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs">
                <Sparkles className="size-4" />
              </span>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-primary">
                  Admin About Us Page Editor
                </p>
                <p className="text-xs text-muted-foreground">
                  Edit story, mission, and brand values. All changes sync straight to the database.
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
                  className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm hover:bg-primary/90 cursor-pointer"
                >
                  <Pencil className="size-3.5" /> Edit Page Content
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={handleSave}
                    className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 cursor-pointer disabled:opacity-50"
                  >
                    <Save className="size-3.5" /> {isSaving ? "Saving…" : "Save Changes"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(content);
                      setIsEditing(false);
                    }}
                    className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted cursor-pointer"
                  >
                    <X className="size-3.5" /> Cancel
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {isEditing ? (
        <div className="space-y-6 rounded-3xl border border-primary/30 bg-card p-6 shadow-xl animate-in fade-in duration-200">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Headline (H1)
            </label>
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-xl font-bold text-foreground outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Subtitle / Tagline
            </label>
            <textarea
              rows={2}
              value={draft.subtitle}
              onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
              className="w-full rounded-xl border border-border bg-background p-3 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Our Story
            </label>
            <textarea
              rows={4}
              value={draft.story}
              onChange={(e) => setDraft({ ...draft, story: e.target.value })}
              className="w-full rounded-xl border border-border bg-background p-3 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
                Core Brand Values
              </h3>
              <button
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    values: [...draft.values, { title: "", text: "" }],
                  })
                }
                className="flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary hover:text-primary-foreground"
              >
                <Plus className="size-3.5" /> Add Card
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {draft.values.map((val, idx) => (
                <div
                  key={idx}
                  className="relative rounded-2xl border border-border bg-muted/20 p-4 space-y-2 group"
                >
                  <button
                    type="button"
                    onClick={() => {
                      const updated = draft.values.filter((_, i) => i !== idx);
                      setDraft({ ...draft, values: updated });
                    }}
                    className="absolute -right-2 -top-2 flex size-7 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10 text-destructive opacity-0 transition-opacity hover:bg-destructive hover:text-destructive-foreground group-hover:opacity-100"
                    title="Remove Card"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                  <input
                    type="text"
                    value={val.title}
                    onChange={(e) => {
                      const updated = [...draft.values];
                      updated[idx] = { ...updated[idx], title: e.target.value };
                      setDraft({ ...draft, values: updated });
                    }}
                    placeholder="Value Title"
                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-bold text-foreground outline-none focus:border-primary"
                  />
                  <textarea
                    rows={2}
                    value={val.text}
                    onChange={(e) => {
                      const updated = [...draft.values];
                      updated[idx] = { ...updated[idx], text: e.target.value };
                      setDraft({ ...draft, values: updated });
                    }}
                    placeholder="Value Description"
                    className="w-full rounded-lg border border-border bg-background p-2 text-xs text-foreground outline-none focus:border-primary"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
            <button
              type="button"
              onClick={() => {
                if (confirm("Reset About page to default template?")) {
                  resetToDefault();
                  setIsEditing(false);
                }
              }}
              className="flex items-center gap-1 text-xs font-semibold text-amber-700 hover:underline mr-auto"
            >
              <RotateCcw className="size-3.5" /> Reset Template
            </button>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="rounded-full border border-border px-5 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSave}
              className="flex items-center gap-2 rounded-full bg-primary px-6 py-2 text-sm font-bold text-primary-foreground shadow-md hover:bg-primary/90"
            >
              <Check className="size-4" /> {isSaving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      ) : (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
          {/* Premium Hero Section */}
          <div className="relative isolate overflow-hidden rounded-[2.5rem] bg-gradient-to-b from-primary/5 to-transparent px-6 py-16 sm:py-24 lg:px-16 flex flex-col lg:flex-row items-center gap-12 border border-primary/10 shadow-sm">
            {/* Background blur orbs */}
            <div className="absolute -top-24 -left-24 size-96 rounded-full bg-primary/20 blur-[100px] pointer-events-none" />
            <div className="absolute -bottom-24 -right-24 size-96 rounded-full bg-emerald-500/10 blur-[100px] pointer-events-none" />

            <div className="lg:w-1/2 relative z-10 text-center lg:text-left">
              <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 mb-6 text-sm font-semibold text-primary">
                <Sparkles className="size-4" />
                <span>Our Story</span>
              </div>
              <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-foreground leading-[1.1]">
                {content.title}
              </h1>
              <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto lg:mx-0">
                {content.subtitle || content.story}
              </p>

              <div className="mt-10">
                <Link
                  to="/shop"
                  className="inline-block rounded-full bg-primary px-8 py-4 text-sm font-bold text-primary-foreground transition-all hover:bg-primary/90 hover:scale-105 hover:shadow-xl shadow-primary/25"
                >
                  Browse the collection
                </Link>
              </div>
            </div>

            <div className="lg:w-1/2 relative z-10 w-full">
              <div className="aspect-[4/3] sm:aspect-[16/9] lg:aspect-square overflow-hidden rounded-3xl shadow-2xl ring-1 ring-black/5 relative group">
                <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent z-10" />
                <img
                  src={hero}
                  alt="Parent playing with toddlers among soft pastel toys"
                  loading="eager"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-1000 group-hover:scale-105"
                />
              </div>
            </div>
          </div>

          {/* Premium Values Grid */}
          {content.values.length > 0 && (
            <div className="mt-24">
              <div className="text-center mb-12">
                <h2 className="font-display text-3xl font-bold tracking-tight">
                  Our Promise to You
                </h2>
                <p className="mt-2 text-muted-foreground">
                  The values that guide every product we choose.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-6 max-w-4xl mx-auto">
                {content.values.map((v, i) => {
                  const Icon = valueIcons[i % valueIcons.length] || Heart;
                  return (
                    <div
                      key={v.title}
                      className="w-full sm:w-[calc(50%-12px)] group relative overflow-hidden rounded-3xl border border-border bg-card p-8 shadow-sm transition-all hover:shadow-lg hover:-translate-y-1"
                    >
                      <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-primary to-primary/20 opacity-0 transition-opacity group-hover:opacity-100" />
                      <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-6 transition-transform group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground">
                        <Icon className="size-6" />
                      </span>
                      <h3 className="text-xl font-bold tracking-tight">{v.title}</h3>
                      <p className="mt-3 text-muted-foreground leading-relaxed">{v.text}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
