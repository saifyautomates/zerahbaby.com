import { supabase } from "@/integrations/supabase/client";

const BUCKET = "product-images";

/** Safe MIME types allowed for upload */
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

const ALLOWED_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "avif",
  "mp4",
  "webm",
  "mov",
]);

/** Uploads any media file (image or video) to storage and returns a public URL. */
export async function uploadMedia(file: File, pathPrefix?: string): Promise<string> {
  // Validate MIME type
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new Error(
      `File type "${file.type}" is not allowed. Use JPEG, PNG, WebP, GIF, MP4, or WebM.`,
    );
  }

  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();

  // Validate extension
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`File extension ".${ext}" is not allowed.`);
  }

  // Cap file size at 10MB
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("File size must be under 10 MB.");
  }

  const filename = `${crypto.randomUUID()}.${ext}`;
  const path = pathPrefix ? `${pathPrefix}/${filename}` : filename;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: "31536000",
    upsert: false,
    contentType: file.type,
  });
  if (error) throw error;

  // Use public URL since bucket is public — no expiry issues
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
