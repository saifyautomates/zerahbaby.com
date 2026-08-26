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

async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") {
    return file; // Do not compress videos or gifs
  }

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);

      const MAX_DIMENSION = 1200;
      let { width, height } = img;

      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      } else if (file.size < 500 * 1024 && file.type === "image/webp") {
        return resolve(file); // Already small and webp
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(file); // fallback

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) return resolve(file); // fallback
          const newName = file.name.replace(/\.[^/.]+$/, "") + ".webp";
          resolve(new File([blob], newName, { type: "image/webp" }));
        },
        "image/webp",
        0.8,
      );
    };
    img.onerror = () => resolve(file); // fallback
    img.src = url;
  });
}

/** Uploads any media file (image or video) to storage and returns a public URL. */
export async function uploadMedia(rawFile: File, pathPrefix?: string): Promise<string> {
  // Validate MIME type
  if (!ALLOWED_MIME_TYPES.has(rawFile.type)) {
    throw new Error(
      `File type "${rawFile.type}" is not allowed. Use JPEG, PNG, WebP, GIF, MP4, or WebM.`,
    );
  }

  // Compress image to make upload "snap of a finger" fast
  const file = await compressImage(rawFile);

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
