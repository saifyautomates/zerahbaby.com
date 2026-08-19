import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const HERO_MEDIA_KEY = "hero_media";

export type HeroSlide = {
  id: string;
  type: "image" | "video";
  url: string;
  alt: string;
  poster?: string;
};

/** Turns any admin-provided link into something an <img>/<video> can render. */
export function normaliseMediaUrl(url: string): { url: string; embed: boolean } {
  const trimmed = url.trim();
  const yt = trimmed.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  if (yt?.[1]) {
    return {
      url: `https://www.youtube.com/embed/${yt[1]}?autoplay=1&mute=1&loop=1&controls=0&playsinline=1&playlist=${yt[1]}`,
      embed: true,
    };
  }
  const vimeo = trimmed.match(/vimeo\.com\/(\d+)/);
  if (vimeo?.[1]) {
    return {
      url: `https://player.vimeo.com/video/${vimeo[1]}?autoplay=1&muted=1&loop=1&background=1`,
      embed: true,
    };
  }
  return { url: trimmed, embed: false };
}

export function parseHeroMedia(raw: string | undefined | null): HeroSlide[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is HeroSlide => Boolean(s && typeof s.url === "string" && s.url.trim()))
      .map((s, i) => ({
        id: s.id || `slide-${i}`,
        type: s.type === "video" ? "video" : "image",
        url: s.url,
        alt: s.alt ?? "",
        ...(s.poster ? { poster: s.poster } : {}),
      }));
  } catch {
    return [];
  }
}

async function fetchHeroMedia(): Promise<HeroSlide[]> {
  const { data, error } = await supabase
    .from("site_settings")
    .select("value")
    .eq("key", HERO_MEDIA_KEY)
    .maybeSingle();
  if (error) throw error;
  return parseHeroMedia(data?.value);
}

export const heroMediaQueryOptions = () => ({
  queryKey: ["hero-media"] as const,
  queryFn: fetchHeroMedia,
  staleTime: 60_000,
});

export function useHeroMedia() {
  return useQuery(heroMediaQueryOptions());
}

/** Saves the whole hero playlist back to site_settings so every visitor sees it. */
export function useSaveHeroMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slides: HeroSlide[]) => {
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key: HERO_MEDIA_KEY, value: JSON.stringify(slides) }, { onConflict: "key" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Hero media updated on the live site");
      qc.invalidateQueries({ queryKey: ["hero-media"] });
      qc.invalidateQueries({ queryKey: ["site_settings"] });
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
