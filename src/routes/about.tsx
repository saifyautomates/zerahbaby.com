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
            <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
              Core Brand Values (4 Cards)
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {draft.values.map((val, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl border border-border bg-muted/20 p-4 space-y-2"
                >
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
        <>
          <h1 className="font-display text-4xl font-bold">{content.title}</h1>
          <p className="mt-4 max-w-2xl text-muted-foreground">
            {content.subtitle || content.story}
          </p>

          <div className="relative mt-8 aspect-[16/9] overflow-hidden rounded-3xl bg-muted">
            <img
              src={hero}
              alt="Parent playing with toddlers among soft pastel toys"
              loading="eager"
              width={1600}
              height={900}
              className="absolute inset-0 h-full w-full object-cover"
            />
          </div>

          <div className="mt-12 grid gap-5 sm:grid-cols-2">
            {content.values.map((v, i) => {
              const Icon = valueIcons[i % valueIcons.length] || Heart;
              return (
                <div key={v.title} className="rounded-2xl border border-border p-6 shadow-2xs">
                  <span className="grid size-10 place-items-center rounded-full bg-secondary text-primary">
                    <Icon className="size-5" />
                  </span>
                  <h2 className="mt-4 font-semibold">{v.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{v.text}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-12 rounded-3xl bg-secondary p-8 text-center">
            <p className="font-display text-4xl font-bold text-primary">2500+</p>
            <p className="mt-1 text-sm text-muted-foreground">Families served across India</p>
          </div>

          <div className="mt-12 text-center">
            <Link
              to="/shop"
              className="inline-block rounded-full bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 shadow-md"
            >
              Browse the collection
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
