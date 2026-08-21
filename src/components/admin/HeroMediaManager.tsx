import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, FolderOpen, ImagePlus, Loader2, Trash2, Video, X } from "lucide-react";
import { toast } from "sonner";
import {
  useHeroMedia,
  useSaveHeroMedia,
  normaliseMediaUrl,
  type HeroSlide,
} from "@/lib/hero-media";
import { MediaLibraryPicker } from "@/components/admin/MediaLibrary";
import {
  useUploadToLibrary,
  useSaveMediaLibrary,
  useMediaLibrary,
  makeAsset,
} from "@/lib/media-library";

const uid = () => globalThis.crypto?.randomUUID?.() ?? String(Date.now() + Math.random());

/** Admin UI to add, reorder and remove the photos/videos shown in the homepage hero. */
export function HeroMediaManager({ onClose }: { onClose?: () => void }) {
  const { data, isLoading } = useHeroMedia();
  const save = useSaveHeroMedia();
  const [slides, setSlides] = useState<HeroSlide[]>([]);
  const [uploading, setUploading] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkType, setLinkType] = useState<"image" | "video">("image");
  const [picker, setPicker] = useState(false);
  const uploadToLibrary = useUploadToLibrary();
  const { data: libraryAssets } = useMediaLibrary();
  const saveLibrary = useSaveMediaLibrary();

  useEffect(() => {
    if (data) setSlides(data);
  }, [data]);

  const move = (i: number, dir: -1 | 1) => {
    const next = [...slides];
    const target = i + dir;
    if (target < 0 || target >= next.length) return;
    const a = next[i]!;
    const b = next[target]!;
    next[i] = b;
    next[target] = a;
    setSlides(next);
  };

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const assets = await uploadToLibrary(Array.from(files));
      const added: HeroSlide[] = assets.map((a) => ({
        id: uid(),
        type: a.type,
        url: a.url,
        alt: a.name,
      }));
      setSlides((s) => [...s, ...added]);
      toast.success(`${added.length} file(s) uploaded — remember to save`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function addLink() {
    const url = linkUrl.trim();
    if (!url) return;

    // Add to library as well so it's not lost
    const newAsset = makeAsset({ url, type: linkType, name: "Linked Media" });
    saveLibrary.mutate([...(libraryAssets ?? []), newAsset]);

    setSlides((s) => [...s, { id: uid(), type: linkType, url, alt: "" }]);
    setLinkUrl("");
  }

  return (
    <div className="space-y-6">
      {picker && (
        <MediaLibraryPicker
          title="Pick hero media"
          onClose={() => setPicker(false)}
          onSelect={(assets) =>
            setSlides((s) => [
              ...s,
              ...assets.map((a) => ({ id: uid(), type: a.type, url: a.url, alt: a.name })),
            ])
          }
        />
      )}
      <div className="rounded-2xl border border-dashed border-primary/50 bg-secondary/40 p-4">
        <p className="text-sm font-semibold">Add hero media</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Upload photos or videos, or paste a link (YouTube, Vimeo or a direct file URL). Everything
          is saved to your store backend and shows for all visitors.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="focus-ring inline-flex cursor-pointer items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90">
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ImagePlus className="size-4" />
            )}
            {uploading ? "Uploading…" : "Upload photos / videos"}
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              className="sr-only"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </label>
          <button
            type="button"
            onClick={() => setPicker(true)}
            className="focus-ring inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm font-semibold transition hover:bg-muted"
          >
            <FolderOpen className="size-4" /> Choose from library
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select
            value={linkType}
            onChange={(e) => setLinkType(e.target.value as "image" | "video")}
            aria-label="Media type for the pasted link"
            className="focus-ring rounded-full border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="image">Photo link</option>
            <option value="video">Video link</option>
          </select>
          <input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://…"
            aria-label="Media URL"
            className="focus-ring min-w-[220px] flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm"
          />
          <button
            type="button"
            onClick={addLink}
            className="focus-ring rounded-full border border-border px-4 py-2 text-sm font-semibold transition hover:bg-muted"
          >
            Add link
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading current hero media…</p>
      ) : slides.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hero media yet — the homepage is using the default background.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {slides.map((slide, i) => {
            const media = normaliseMediaUrl(slide.url);
            return (
              <li
                key={slide.id}
                className="overflow-hidden rounded-2xl border border-border bg-card"
              >
                <div className="relative aspect-video bg-muted">
                  {slide.type === "video" ? (
                    media.embed ? (
                      <div className="grid size-full place-items-center text-muted-foreground">
                        <Video className="size-8" />
                      </div>
                    ) : (
                      <video src={media.url} muted playsInline className="size-full object-cover" />
                    )
                  ) : (
                    <img
                      src={media.url}
                      alt={slide.alt}
                      loading="lazy"
                      decoding="async"
                      className="size-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.opacity = "0";
                      }}
                    />
                  )}
                  <span className="absolute left-2 top-2 rounded-full bg-foreground/70 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-background">
                    {slide.type}
                  </span>
                </div>
                <div className="space-y-2 p-3">
                  <input
                    value={slide.alt}
                    onChange={(e) =>
                      setSlides((s) =>
                        s.map((x) => (x.id === slide.id ? { ...x, alt: e.target.value } : x)),
                      )
                    }
                    placeholder="Describe this media (for accessibility)"
                    aria-label="Media description"
                    className="focus-ring w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs"
                  />
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      aria-label="Move earlier"
                      className="focus-ring rounded-lg border border-border p-1.5 transition hover:bg-muted"
                    >
                      <ArrowUp className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      aria-label="Move later"
                      className="focus-ring rounded-lg border border-border p-1.5 transition hover:bg-muted"
                    >
                      <ArrowDown className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSlides((s) => s.filter((x) => x.id !== slide.id))}
                      aria-label="Remove media"
                      className="focus-ring ml-auto rounded-lg border border-border p-1.5 text-destructive transition hover:bg-destructive hover:text-destructive-foreground"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="sticky bottom-0 z-10 -mx-6 -mb-6 mt-6 border-t border-border bg-background p-6 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate(slides, { onSuccess: () => onClose?.() })}
          className="focus-ring inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
        >
          {save.isPending && <Loader2 className="size-4 animate-spin" />} Save hero media
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="focus-ring inline-flex items-center gap-2 rounded-full border border-border px-6 py-2.5 text-sm font-semibold transition hover:bg-muted"
          >
            <X className="size-4" /> Close
          </button>
        )}
      </div>
    </div>
  );
}

/** Floating "Edit hero media" entry point rendered on the homepage in admin mode. */
export function HeroMediaDialog({ onClose }: { onClose: () => void }) {
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground/50 p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Manage hero media"
    >
      <div className="flex flex-col w-full max-w-4xl max-h-full rounded-3xl bg-background shadow-2xl overflow-hidden">
        <div className="shrink-0 border-b border-border p-6">
          <h2 className="font-display text-xl font-bold">Homepage hero media</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Photos and videos shown behind the homepage headline.
          </p>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          <HeroMediaManager onClose={onClose} />
        </div>
      </div>
    </div>,
    document.body
  );
}
