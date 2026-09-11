import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { type Product } from "@/lib/store";
import { toast } from "sonner";

export type HomepageSectionType = "PRODUCT_GRID" | "PRODUCT_CAROUSEL";
export type HomepageSectionSource =
  | "MANUAL"
  | "BESTSELLERS"
  | "NEW_ARRIVALS"
  | "DISCOUNTED"
  | "CATEGORY";
export type HomepageSectionStatus = "published" | "draft" | "archived";

export interface SectionDisplaySettings {
  max_products?: number;
  show_subtitle?: boolean;
  show_cta?: boolean;
  cta_label?: string;
  cta_link?: string;
}

export interface HomepageSectionItem {
  id: string;
  section_id: string;
  product_id: string;
  sort_order: number;
  is_visible: boolean;
  created_at?: string;
  updated_at?: string;
  product?: Product;
}

export interface HomepageSection {
  id: string;
  title: string;
  subtitle: string;
  slug: string;
  section_type: HomepageSectionType;
  source_type: HomepageSectionSource;
  category_slug?: string | null;
  status: HomepageSectionStatus;
  is_visible: boolean;
  sort_order: number;
  display_settings: SectionDisplaySettings;
  created_at?: string;
  updated_at?: string;
  items?: HomepageSectionItem[];
}

export interface SectionUpsertInput {
  id?: string;
  title: string;
  subtitle?: string;
  slug?: string;
  section_type: HomepageSectionType;
  source_type: HomepageSectionSource;
  category_slug?: string | null;
  status?: HomepageSectionStatus;
  is_visible?: boolean;
  sort_order?: number;
  display_settings?: SectionDisplaySettings;
  product_ids?: string[]; // ordered list of product IDs for MANUAL sections
}

/**
 * Fetch all sections from the database.
 * If isAdmin is false, filters to only published and visible sections.
 */
export async function fetchHomepageSections(isAdmin = false): Promise<HomepageSection[]> {
  let query = supabase
    .from("homepage_sections")
    .select(
      `
      id,
      title,
      subtitle,
      slug,
      section_type,
      source_type,
      category_slug,
      status,
      is_visible,
      sort_order,
      display_settings,
      created_at,
      updated_at,
      homepage_section_items (
        id,
        section_id,
        product_id,
        sort_order,
        is_visible
      )
    `,
    )
    .order("sort_order", { ascending: true });

  if (!isAdmin) {
    query = query.eq("is_visible", true).eq("status", "published");
  }

  const { data, error } = await query;
  if (error) {
    console.error("[homepage-sections] Error fetching sections:", error);
    throw error;
  }

  return (data || []).map((row: any) => {
    const rawItems = row.homepage_section_items || [];
    const sortedItems = [...rawItems].sort((a, b) => a.sort_order - b.sort_order);

    return {
      id: row.id,
      title: row.title,
      subtitle: row.subtitle || "",
      slug: row.slug,
      section_type: (row.section_type as HomepageSectionType) || "PRODUCT_GRID",
      source_type: (row.source_type as HomepageSectionSource) || "MANUAL",
      category_slug: row.category_slug,
      status: (row.status as HomepageSectionStatus) || "published",
      is_visible: row.is_visible !== false,
      sort_order: row.sort_order ?? 0,
      display_settings: {
        max_products: row.display_settings?.max_products ?? 8,
        show_subtitle: row.display_settings?.show_subtitle !== false,
        show_cta: row.display_settings?.show_cta !== false,
        cta_label: row.display_settings?.cta_label || "View all",
        cta_link: row.display_settings?.cta_link || "/shop",
      },
      created_at: row.created_at,
      updated_at: row.updated_at,
      items: sortedItems,
    };
  });
}

/**
 * Resolves the products for a section based on its source type and settings.
 */
export function resolveSectionProducts(
  section: HomepageSection,
  allProducts: Product[],
): Product[] {
  const max = section.display_settings?.max_products ?? 8;

  if (section.source_type === "MANUAL") {
    if (!section.items || section.items.length === 0) {
      return [];
    }

    const productMap = new Map<string, Product>();
    for (const p of allProducts) {
      productMap.set(p.uuid, p);
      productMap.set(p.id, p);
    }

    const manualList: Product[] = [];
    for (const item of section.items) {
      if (item.is_visible === false) continue;
      const found = productMap.get(item.product_id);
      if (found) {
        manualList.push(found);
      }
    }
    return manualList.slice(0, max);
  }

  if (section.source_type === "BESTSELLERS") {
    return [...allProducts]
      .sort((a, b) => (b.reviews || 0) - (a.reviews || 0))
      .slice(0, max);
  }

  if (section.source_type === "NEW_ARRIVALS") {
    return [...allProducts]
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .slice(0, max);
  }

  if (section.source_type === "DISCOUNTED") {
    return [...allProducts]
      .sort((a, b) => {
        const discA = a.mrp && a.mrp > a.price ? (a.mrp - a.price) / a.mrp : 0;
        const discB = b.mrp && b.mrp > b.price ? (b.mrp - b.price) / b.mrp : 0;
        return discB - discA;
      })
      .slice(0, max);
  }

  if (section.source_type === "CATEGORY" && section.category_slug) {
    return allProducts
      .filter((p) => p.category.toLowerCase() === section.category_slug?.toLowerCase())
      .slice(0, max);
  }

  return allProducts.slice(0, max);
}

/**
 * Hook to query homepage sections.
 */
export function useHomepageSections(isAdmin = false) {
  return useQuery({
    queryKey: ["homepage-sections", isAdmin],
    queryFn: () => fetchHomepageSections(isAdmin),
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
}

/**
 * Hook to create or update a homepage section.
 */
export function useSaveSection() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: SectionUpsertInput) => {
      const isEditing = Boolean(input.id);
      const generatedSlug =
        input.slug ||
        input.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");

      const displaySettings = {
        max_products: input.display_settings?.max_products ?? 8,
        show_subtitle: input.display_settings?.show_subtitle !== false,
        show_cta: input.display_settings?.show_cta !== false,
        cta_label: input.display_settings?.cta_label || "View all",
        cta_link: input.display_settings?.cta_link || "/shop",
      };

      // Try canonical Security Definer RPC first
      try {
        const { data: rpcData, error: rpcErr } = await (supabase.rpc as any)(
          "admin_save_homepage_section",
          {
            p_id: input.id || null,
            p_title: input.title.trim(),
            p_subtitle: input.subtitle?.trim() || "",
            p_slug: generatedSlug,
            p_section_type: input.section_type,
            p_source_type: input.source_type,
            p_category_slug: input.source_type === "CATEGORY" ? input.category_slug : null,
            p_status: input.status || "published",
            p_is_visible: input.is_visible !== false,
            p_sort_order: input.sort_order ?? 0,
            p_display_settings: displaySettings,
            p_product_ids: input.product_ids || [],
          },
        );

        if (!rpcErr && rpcData) {
          return { success: true, id: rpcData.id };
        }
        if (rpcErr && rpcErr.message?.includes("Access denied")) {
          throw rpcErr;
        }
      } catch (err: any) {
        if (err?.message?.includes("Access denied")) throw err;
        // Continue to table fallback
      }

      // Fallback: Direct table operations
      const sectionPayload: Record<string, any> = {
        title: input.title.trim(),
        subtitle: input.subtitle?.trim() || "",
        slug: generatedSlug,
        section_type: input.section_type,
        source_type: input.source_type,
        category_slug: input.source_type === "CATEGORY" ? input.category_slug : null,
        status: input.status || "published",
        is_visible: input.is_visible !== false,
        display_settings: displaySettings,
        updated_at: new Date().toISOString(),
      };

      if (typeof input.sort_order === "number") {
        sectionPayload.sort_order = input.sort_order;
      }

      let sectionId = input.id;

      if (isEditing) {
        const { error } = await supabase
          .from("homepage_sections")
          .update(sectionPayload as any)
          .eq("id", input.id!);

        if (error) throw error;
      } else {
        if (sectionPayload.sort_order === undefined) {
          const { data: maxRow } = await supabase
            .from("homepage_sections")
            .select("sort_order")
            .order("sort_order", { ascending: false })
            .limit(1)
            .maybeSingle();
          sectionPayload.sort_order = ((maxRow as any)?.sort_order ?? 0) + 1;
        }

        const { data: newSec, error } = await supabase
          .from("homepage_sections")
          .insert(sectionPayload as any)
          .select("id")
          .single();

        if (error) throw error;
        sectionId = (newSec as any)?.id;
      }

      // Sync curated items if manual
      if (input.source_type === "MANUAL" && sectionId) {
        await supabase
          .from("homepage_section_items")
          .delete()
          .eq("section_id", sectionId);

        if (input.product_ids && input.product_ids.length > 0) {
          const itemsPayload = input.product_ids.map((prodId, idx) => ({
            section_id: sectionId,
            product_id: prodId,
            sort_order: idx + 1,
            is_visible: true,
          }));

          const { error: itemErr } = await supabase
            .from("homepage_section_items")
            .insert(itemsPayload as any);

          if (itemErr) {
            console.error("[homepage-sections] Error inserting items:", itemErr);
            throw itemErr;
          }
        }
      }

      return { success: true, id: sectionId };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["homepage-sections"] });
      toast.success("Homepage section saved successfully");
    },
    onError: (err: any) => {
      console.error("[useSaveSection] error:", err);
      toast.error(err.message || "Failed to save homepage section");
    },
  });
}

/**
 * Hook to fast toggle visibility of a section.
 */
export function useToggleSectionVisibility() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, is_visible }: { id: string; is_visible: boolean }) => {
      // Try canonical RPC first
      try {
        const { error: rpcErr } = await (supabase.rpc as any)(
          "admin_toggle_homepage_section_visibility",
          {
            p_section_id: id,
            p_is_visible: is_visible,
          },
        );
        if (!rpcErr) return { id, is_visible };
        if (rpcErr.message?.includes("Access denied")) throw rpcErr;
      } catch (err: any) {
        if (err?.message?.includes("Access denied")) throw err;
      }

      // Fallback
      const { error } = await supabase
        .from("homepage_sections")
        .update({ is_visible, updated_at: new Date().toISOString() } as any)
        .eq("id", id);
      if (error) throw error;
      return { id, is_visible };
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["homepage-sections"] });
      toast.success(vars.is_visible ? "Section published to homepage" : "Section hidden from storefront");
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to update section visibility");
    },
  });
}

/**
 * Hook to reorder sections.
 */
export function useReorderSections() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (orderedSections: { id: string; sort_order: number }[]) => {
      // Try canonical RPC first
      try {
        const { error: rpcErr } = await (supabase.rpc as any)(
          "admin_reorder_homepage_sections",
          {
            p_section_ids: orderedSections.map((s) => s.id),
          },
        );
        if (!rpcErr) return true;
        if (rpcErr.message?.includes("Access denied")) throw rpcErr;
      } catch (err: any) {
        if (err?.message?.includes("Access denied")) throw err;
      }

      // Fallback: Update each section's sort order
      for (const item of orderedSections) {
        const { error } = await supabase
          .from("homepage_sections")
          .update({ sort_order: item.sort_order, updated_at: new Date().toISOString() } as any)
          .eq("id", item.id);
        if (error) throw error;
      }
      return true;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["homepage-sections"] });
      toast.success("Homepage sections reordered");
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to reorder sections");
    },
  });
}

/**
 * Hook to duplicate a section.
 */
export function useDuplicateSection() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (section: HomepageSection) => {
      // Try canonical RPC first
      try {
        const { data: dupData, error: rpcErr } = await (supabase.rpc as any)(
          "admin_duplicate_homepage_section",
          {
            p_section_id: section.id,
          },
        );
        if (!rpcErr && dupData) return dupData;
        if (rpcErr?.message?.includes("Access denied")) throw rpcErr;
      } catch (err: any) {
        if (err?.message?.includes("Access denied")) throw err;
      }

      // Fallback
      const newSlug = `${section.slug}-copy-${Date.now().toString().slice(-4)}`;
      const { data: newSec, error: secErr } = await supabase
        .from("homepage_sections")
        .insert({
          title: `${section.title} (Copy)`,
          subtitle: section.subtitle,
          slug: newSlug,
          section_type: section.section_type,
          source_type: section.source_type,
          category_slug: section.category_slug,
          status: section.status,
          is_visible: section.is_visible,
          sort_order: section.sort_order + 1,
          display_settings: section.display_settings as any,
        } as any)
        .select("id")
        .single();

      if (secErr) throw secErr;

      // Duplicate curated items if manual
      if (section.source_type === "MANUAL" && section.items && section.items.length > 0) {
        const itemsPayload = section.items.map((it) => ({
          section_id: (newSec as any)?.id,
          product_id: it.product_id,
          sort_order: it.sort_order,
          is_visible: it.is_visible,
        }));

        const { error: itemsErr } = await supabase
          .from("homepage_section_items")
          .insert(itemsPayload as any);

        if (itemsErr) throw itemsErr;
      }

      return newSec;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["homepage-sections"] });
      toast.success("Section duplicated successfully");
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to duplicate section");
    },
  });
}

/**
 * Hook to delete a section.
 */
export function useDeleteSection() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (sectionId: string) => {
      // Try canonical RPC first
      try {
        const { error: rpcErr } = await (supabase.rpc as any)(
          "admin_delete_homepage_section",
          {
            p_section_id: sectionId,
          },
        );
        if (!rpcErr) return sectionId;
        if (rpcErr.message?.includes("Access denied")) throw rpcErr;
      } catch (err: any) {
        if (err?.message?.includes("Access denied")) throw err;
      }

      // Fallback
      const { error } = await supabase
        .from("homepage_sections")
        .delete()
        .eq("id", sectionId);
      if (error) throw error;
      return sectionId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["homepage-sections"] });
      toast.success("Section removed from homepage");
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to delete section");
    },
  });
}
