import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, ImagePlus, Loader2, Search, Trash2, Video, X } from "lucide-react";
import { toast } from "sonner";
import {
  collectTags,
  makeAsset,
  useMediaLibrary,
  useSaveMediaLibrary,
  useUploadToLibrary,
  type MediaAsset,
} from "@/lib/media-library";
import { normaliseMediaUrl } from "@/lib/hero-media";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";

type Filter = "all" | "image" | "video";

/** Thumbnail preview for a library asset. */
function Thumb({ asset }: { asset: MediaAsset }) {
  const media = normaliseMediaUrl(asset.url);
  if (asset.type === "video") {
    return media.embed ? (
      <div className="grid size-full place-items-center bg-muted text-muted-foreground">
        <Video className="size-7" />
      </div>
    ) : (
      <video
        src={media.url}
        muted
        playsInline
        preload="metadata"
        className="size-full object-cover"
      />
    );
  }
  return (
    <img
      src={media.url}
      alt={asset.name}
      loading="lazy"
      decoding="async"
      className="size-full object-cover"
      onError={(e) => {
        (e.target as HTMLImageElement).style.opacity = "0";
      }}
    />
  );
}

export type MediaLibraryProps = {
  /** When set, the grid becomes a picker and calls back with the chosen assets. */
  onSelect?: ((assets: MediaAsset[]) => void) | undefined;
  selectMode?: "single" | "multiple" | undefined;
  accept?: Filter | undefined;
  onClose?: (() => void) | undefined;
};

/**
 * Shared media library: upload, tag, search and reuse photos/videos anywhere in the store.
 * Everything is persisted in the backend so all admins and pages share one set of assets.
 */
export function MediaLibrary({
  onSelect,
  selectMode = "multiple",
  accept = "all",
  onClose,
}: MediaLibraryProps) {
  const { data, isLoading } = useMediaLibrary();
  const save = useSaveMediaLibrary();
  const upload = useUploadToLibrary();

  const [uploading, setUploading] = useState(false);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<Filter>(accept);
  const [tag, setTag] = useState<string>("");
  const [selected, setSelected] = useState<string[]>([]);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkType, setLinkType] = useState<"image" | "video">("image");
  const [pendingDelete, setPendingDelete] = useState<MediaAsset | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const assets = useMemo(() => data ?? [], [data]);
  const tags = useMemo(() => collectTags(assets), [assets]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets
      .filter((a) => (accept === "all" ? true : a.type === accept))
      .filter((a) => (type === "all" ? true : a.type === type))
      .filter((a) => (tag ? a.tags.includes(tag) : true))
      .filter((a) => (q ? `${a.name} ${a.tags.join(" ")}`.toLowerCase().includes(q) : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [assets, accept, type, tag, query]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const added = await upload(Array.from(files));
      toast.success(`${added.length} file(s) added to the library`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function addLink() {
    const url = linkUrl.trim();
    if (!url) return;
    save.mutate(
      [...assets, makeAsset({ url, type: linkType, name: url.split("/").pop() ?? "Linked media" })],
      {
        onSuccess: () => {
          setLinkUrl("");
          toast.success("Link added to the library");
        },
      },
    );
  }

  function patch(id: string, changes: Partial<MediaAsset>) {
    save.mutate(assets.map((a) => (a.id === id ? { ...a, ...changes } : a)));
  }

  function toggle(id: string) {
    if (!onSelect) return;
    setSelected((s) =>
      selectMode === "single"
        ? s[0] === id
          ? []
          : [id]
        : s.includes(id)
          ? s.filter((x) => x !== id)
          : [...s, id],
    );
  }

  const chosen = assets.filter((a) => selected.includes(a.id));

  return (
    <div className="space-y-5">
      {/* Add media */}
      <div className="rounded-2xl border border-dashed border-primary/50 bg-secondary/40 p-4">
        <p className="text-sm font-semibold">Add to the library</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Upload photos or videos, or paste a link (YouTube, Vimeo or a direct file URL). Assets
          here can be reused on any page.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
            className="focus-ring inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ImagePlus className="size-4" />
            )}
            {uploading ? "Uploading…" : "Upload photos / videos"}
          </button>
          <input
            ref={fileInput}
            type="file"
            disabled={uploading}
            accept={
              accept === "image" ? "image/*" : accept === "video" ? "video/*" : "image/*,video/*"
            }
            multiple
            className="sr-only"
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <select
            value={linkType}
            onChange={(e) => setLinkType(e.target.value as "image" | "video")}
            aria-label="Type of the pasted link"
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
            className="focus-ring min-w-[200px] flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm"
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

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or tag"
            aria-label="Search media"
            className="focus-ring w-full rounded-full border border-border bg-background py-2 pl-9 pr-4 text-sm"
          />
        </div>
        {accept === "all" && (
          <select
            value={type}
            onChange={(e) => setType(e.target.value as Filter)}
            aria-label="Filter by media type"
            className="focus-ring rounded-full border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="all">All media</option>
            <option value="image">Photos</option>
            <option value="video">Videos</option>
          </select>
        )}
        <select
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          aria-label="Filter by tag"
          className="focus-ring rounded-full border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {/* Grid */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading media library…</p>
      ) : visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Nothing here yet — upload a photo or video to start your library.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((asset) => {
            const isSelected = selected.includes(asset.id);
            return (
              <li
                key={asset.id}
                className={`overflow-hidden rounded-2xl border bg-card transition ${
                  isSelected ? "border-primary ring-2 ring-primary/40" : "border-border"
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggle(asset.id)}
                  disabled={!onSelect}
                  aria-pressed={onSelect ? isSelected : undefined}
                  className="focus-ring relative block aspect-video w-full bg-muted disabled:cursor-default"
                >
                  <Thumb asset={asset} />
                  <span className="absolute left-2 top-2 rounded-full bg-foreground/70 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-background">
                    {asset.type}
                  </span>
                  {isSelected && (
                    <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-4" />
                    </span>
                  )}
                </button>
                <div className="space-y-2 p-3">
                  <input
                    defaultValue={asset.name}
                    onBlur={(e) =>
                      e.target.value !== asset.name && patch(asset.id, { name: e.target.value })
                    }
                    placeholder="Name / description"
                    aria-label="Media name"
                    className="focus-ring w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs"
                  />
                  <input
                    defaultValue={asset.tags.join(", ")}
                    onBlur={(e) => {
                      const next = e.target.value
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean);
                      if (next.join(",") !== asset.tags.join(",")) patch(asset.id, { tags: next });
                    }}
                    placeholder="Tags, comma separated"
                    aria-label="Media tags"
                    className="focus-ring w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs"
                  />
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard?.writeText(asset.url);
                        toast.success("Link copied");
                      }}
                      aria-label={`Copy link for ${asset.name || "media"}`}
                      className="focus-ring rounded-lg border border-border p-1.5 transition hover:bg-muted"
                    >
                      <Copy className="size-4" />
                    </button>
                    {onSelect && (
                      <button
                        type="button"
                        onClick={() => onSelect([asset])}
                        className="focus-ring rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold transition hover:bg-muted"
                      >
                        Use
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setPendingDelete(asset)}
                      aria-label={`Delete ${asset.name || "media"}`}
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

      {(onSelect || onClose) && (
        <div className="sticky bottom-0 z-10 -mx-6 -mb-6 mt-6 border-t border-border bg-background p-6 flex flex-wrap items-center gap-3">
          {onSelect && (
            <button
              type="button"
              disabled={chosen.length === 0}
              onClick={() => onSelect(chosen)}
              className="focus-ring rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
            >
              Use {chosen.length || ""} selected
            </button>
          )}
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
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Remove from library?"
          message="Pages already using this media keep their copy of the link, but it won't be selectable here anymore."
          confirmLabel="Remove"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            save.mutate(assets.filter((a) => a.id !== pendingDelete.id));
            setPendingDelete(null);
          }}
        />
      )}
    </div>
  );
}

/** Modal wrapper used anywhere an admin needs to pick existing media. */
export function MediaLibraryPicker({
  onSelect,
  onClose,
  selectMode = "multiple",
  accept = "all",
  title = "Media library",
}: MediaLibraryProps & { title?: string }) {
  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-foreground/50 p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="flex flex-col w-full max-w-5xl max-h-full rounded-3xl bg-background shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-border p-6">
          <h2 className="font-display text-xl font-bold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Reuse any photo or video you've already uploaded.
          </p>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          <MediaLibrary
            onSelect={(assets) => {
              onSelect?.(assets);
              onClose?.();
            }}
            selectMode={selectMode}
            accept={accept}
            onClose={onClose}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
