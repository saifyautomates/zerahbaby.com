import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { uploadMedia } from "@/lib/uploads";

export const MEDIA_LIBRARY_KEY = "media_library";

export type MediaAsset = {
  id: string;
  type: "image" | "video";
  url: string;
  name: string;
  tags: string[];
  createdAt: string;
};

const uid = () => globalThis.crypto?.randomUUID?.() ?? String(Date.now() + Math.random());

export function parseMediaLibrary(raw: string | undefined | null): MediaAsset[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((a): a is MediaAsset => Boolean(a && typeof a.url === "string" && a.url.trim()))
      .map((a, i) => ({
        id: a.id || `asset-${i}`,
        type: a.type === "video" ? "video" : "image",
        url: a.url,
        name: a.name ?? "",
        tags: Array.isArray(a.tags) ? a.tags.filter((t) => typeof t === "string") : [],
        createdAt: a.createdAt ?? new Date(0).toISOString(),
      }));
  } catch {
    return [];
  }
}

async function fetchMediaLibrary(): Promise<MediaAsset[]> {
  const { data, error } = await supabase
    .from("site_settings")
    .select("value")
    .eq("key", MEDIA_LIBRARY_KEY)
    .maybeSingle();
  if (error) throw error;
  return parseMediaLibrary(data?.value);
}

async function persist(assets: MediaAsset[]) {
  const { error } = await supabase
    .from("site_settings")
    .upsert({ key: MEDIA_LIBRARY_KEY, value: JSON.stringify(assets) }, { onConflict: "key" });
  if (error) throw error;
  return assets;
}

export const mediaLibraryQueryOptions = () => ({
  queryKey: ["media-library"] as const,
  queryFn: fetchMediaLibrary,
  staleTime: 30_000,
});

export function useMediaLibrary() {
  return useQuery(mediaLibraryQueryOptions());
}

/** Writes the whole library back to the backend so every admin sees the same assets. */
export function useSaveMediaLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: persist,
    onSuccess: (assets) => {
      qc.setQueryData(["media-library"], assets);
      qc.invalidateQueries({ queryKey: ["media-library"] });
      qc.invalidateQueries({ queryKey: ["site_settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function makeAsset(input: {
  url: string;
  type: "image" | "video";
  name?: string;
  tags?: string[];
}): MediaAsset {
  return {
    id: uid(),
    type: input.type,
    url: input.url,
    name: input.name ?? "",
    tags: input.tags ?? [],
    createdAt: new Date().toISOString(),
  };
}

/** Uploads files to storage and appends them to the shared library. */
export function useUploadToLibrary() {
  const { data } = useMediaLibrary();
  const save = useSaveMediaLibrary();
  return async (files: File[]): Promise<MediaAsset[]> => {
    const added: MediaAsset[] = [];
    for (const file of files) {
      const url = await uploadMedia(file);
      added.push(
        makeAsset({
          url,
          type: file.type.startsWith("video") ? "video" : "image",
          name: file.name.replace(/\.[^.]+$/, ""),
        }),
      );
    }
    if (added.length) await save.mutateAsync([...(data ?? []), ...added]);
    return added;
  };
}

/** All tags currently in use, sorted alphabetically. */
export function collectTags(assets: MediaAsset[]): string[] {
  return [...new Set(assets.flatMap((a) => a.tags))].sort((a, b) => a.localeCompare(b));
}
