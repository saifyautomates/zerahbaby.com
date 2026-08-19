import { supabase } from "@/integrations/supabase/client";

const BUCKET = "product-images";
const TEN_YEARS = 60 * 60 * 24 * 365 * 10;

/** Uploads any media file (image or video) to storage and returns a long-lived URL. */
export async function uploadMedia(file: File): Promise<string> {
  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
  const path = `${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: "31536000",
    upsert: false,
    contentType: file.type || "application/octet-stream",
  });
  if (error) throw error;

  const { data, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, TEN_YEARS);
  if (signError || !data) throw signError ?? new Error("Could not create media URL");
  return data.signedUrl;
}

/** Uploads an image to the product image library and returns a long-lived URL. */
export async function uploadProductImage(file: File): Promise<string> {
  return uploadMedia(file);
}
