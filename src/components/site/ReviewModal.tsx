import { useState, useRef } from "react";
import {
  Star,
  X,
  Upload,
  CheckCircle2,
  ShieldCheck,
  Image as ImageIcon,
  Loader2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { uploadMedia } from "@/lib/uploads";
import { useSubmitReview, type Review } from "@/lib/reviews";

const RATING_LEVELS: Record<number, { label: string; color: string; desc: string }> = {
  1: { label: "Terrible", color: "text-red-500", desc: "Very poor quality or defective" },
  2: { label: "Poor", color: "text-orange-500", desc: "Didn't meet expectations" },
  3: { label: "Average", color: "text-amber-500", desc: "Acceptable / It's okay" },
  4: { label: "Very Good", color: "text-emerald-500", desc: "High quality, liked it" },
  5: { label: "Excellent", color: "text-[#388E3C]", desc: "Loved it! Highly recommended" },
};

const MAX_PHOTOS = 5;

export function ReviewModal({
  product,
  user,
  orderId,
  existingReview,
  onClose,
}: {
  product: { id: string; uuid: string; name: string; image?: string; brand?: string };
  user: { id: string; email?: string } | null;
  orderId?: string | null;
  existingReview?: Review | null;
  onClose: () => void;
}) {
  const submitReview = useSubmitReview();
  const [rating, setRating] = useState<number>(existingReview?.rating ?? 5);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [title, setTitle] = useState(existingReview?.title ?? "");
  const [comment, setComment] = useState(existingReview?.comment ?? "");
  const [images, setImages] = useState<string[]>(existingReview?.images ?? []);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeLevel = RATING_LEVELS[hoverRating || rating] || RATING_LEVELS[5];

  const handlePhotoUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const availableSlots = MAX_PHOTOS - images.length;
    if (availableSlots <= 0) {
      toast.error(`You can attach up to ${MAX_PHOTOS} photos.`);
      return;
    }

    const selectedFiles = Array.from(files).slice(0, availableSlots);
    setIsUploading(true);

    try {
      const uploadedUrls: string[] = [];
      for (const file of selectedFiles) {
        if (!file.type.startsWith("image/")) {
          toast.error(`File "${file.name}" is not an image.`);
          continue;
        }
        if (file.size > 8 * 1024 * 1024) {
          toast.error(`Image "${file.name}" exceeds 8MB limit.`);
          continue;
        }
        const url = await uploadMedia(file);
        uploadedUrls.push(url);
      }

      setImages((prev) => [...prev, ...uploadedUrls].slice(0, MAX_PHOTOS));
      if (uploadedUrls.length > 0) {
        toast.success(`Uploaded ${uploadedUrls.length} photo${uploadedUrls.length > 1 ? "s" : ""}`);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to upload photo. Please try again.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removePhoto = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      toast.error("Please sign in to submit a review.");
      return;
    }
    if (!comment.trim()) {
      toast.error("Please write a few words about your experience.");
      return;
    }

    try {
      await submitReview.mutateAsync({
        product_id: product.uuid,
        user_id: user.id,
        order_id: orderId ?? null,
        rating,
        title: title.trim(),
        comment: comment.trim(),
        images,
        review_id: existingReview?.id,
      });

      setIsSubmitted(true);
    } catch {
      // Error handled by hook toast
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitReview.isPending && !isUploading) {
          onClose();
        }
      }}
    >
      <div className="relative w-full max-w-xl max-h-[90vh] flex flex-col bg-card rounded-3xl shadow-2xl border border-gray-100 overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-muted/50">
          <div className="flex items-center gap-3 min-w-0">
            {product.image && (
              <img
                src={product.image}
                alt={product.name}
                loading="lazy"
                decoding="async"
                className="size-11 rounded-xl object-cover border border-border shrink-0"
              />
            )}
            <div className="min-w-0">
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#2e7d32] bg-green-50 border border-green-200 px-2 py-0.5 rounded-md">
                <ShieldCheck className="size-3" /> Certified Buyer
              </span>
              <h2 className="text-sm font-bold text-foreground truncate mt-0.5">{product.name}</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close review dialog"
            className="p-2 text-gray-400 hover:text-muted-foreground rounded-full hover:bg-muted transition cursor-pointer"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isSubmitted ? (
            <div className="py-8 text-center space-y-4">
              <div className="mx-auto size-16 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 shadow-xs animate-in zoom-in-50 duration-300">
                <CheckCircle2 className="size-9" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-foreground">Review Submitted!</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto mt-1.5">
                  Thank you for helping other parents make great choices for their little ones! Your
                  verified review is being processed and will appear shortly.
                </p>
              </div>

              <div className="p-4 bg-amber-50/60 rounded-2xl border border-amber-200 text-left flex items-start gap-3">
                <Sparkles className="size-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-900 leading-relaxed">
                  <p className="font-bold">Share your love on Google?</p>
                  <p className="mt-0.5 text-amber-800">
                    If you love our organic clothing and Kota boutique, please consider leaving us a
                    quick Google review!
                  </p>
                  <a
                    href="https://maps.app.goo.gl/79nYYFUSWre5ymHT6"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 mt-2 text-xs font-bold text-[#1a73e8] hover:underline"
                  >
                    Review Zerah on Google Maps →
                  </a>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-full py-3 bg-[#8B2020] text-white font-bold rounded-2xl shadow-sm hover:bg-[#7a1c1c] transition cursor-pointer"
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Star Rating Selector */}
              <div className="rounded-2xl border border-gray-100 bg-muted/50 p-5 text-center">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Rate this product
                </p>
                <div className="flex items-center justify-center gap-2 mt-3">
                  {[1, 2, 3, 4, 5].map((star) => {
                    const isFilled = (hoverRating !== null ? hoverRating : rating) >= star;
                    return (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRating(star)}
                        onMouseEnter={() => setHoverRating(star)}
                        onMouseLeave={() => setHoverRating(null)}
                        aria-label={`${star} star`}
                        className="p-1 transition-transform hover:scale-125 focus:outline-hidden cursor-pointer"
                      >
                        <Star
                          className={`size-9 transition-colors ${
                            isFilled
                              ? "fill-[#f59e0b] text-[#f59e0b]"
                              : "text-gray-300 hover:text-[#f59e0b]"
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 min-h-6">
                  <span className={`text-sm font-bold ${activeLevel.color}`}>
                    {activeLevel.label}
                  </span>
                  <span className="text-xs text-muted-foreground ml-1.5">({activeLevel.desc})</span>
                </div>
              </div>

              {/* Review Title */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Review Headline <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  maxLength={100}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Super soft fabric, fits perfectly!"
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-card text-sm outline-hidden focus:border-[#8B2020] focus:ring-2 focus:ring-red-100 transition"
                />
              </div>

              {/* Review Comment */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Detailed Review <span className="text-red-500">*</span>
                  </label>
                  <span className="text-[11px] text-gray-400">{comment.length}/1000</span>
                </div>
                <textarea
                  required
                  rows={4}
                  maxLength={1000}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Tell us about the fabric quality, comfort, fit, stitching, and why you love or disliked it..."
                  className="w-full px-4 py-3 rounded-xl border border-border bg-card text-sm outline-hidden focus:border-[#8B2020] focus:ring-2 focus:ring-red-100 transition"
                />
              </div>

              {/* Photo Upload Section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Add Photos{" "}
                    <span className="text-gray-400 font-normal">
                      ({images.length}/{MAX_PHOTOS})
                    </span>
                  </label>
                  <span className="text-[11px] text-gray-400">
                    Helps other parents see real quality
                  </span>
                </div>

                <div className="grid grid-cols-5 gap-2.5">
                  {images.map((img, idx) => (
                    <div
                      key={idx}
                      className="group relative aspect-square rounded-xl border border-border overflow-hidden bg-muted"
                    >
                      <img
                        src={img}
                        alt={`Upload ${idx + 1}`}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removePhoto(idx)}
                        className="absolute top-1 right-1 p-1 rounded-full bg-black/70 text-white opacity-0 group-hover:opacity-100 transition hover:bg-black cursor-pointer"
                        title="Remove photo"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}

                  {images.length < MAX_PHOTOS && (
                    <label
                      className={`aspect-square rounded-xl border-2 border-dashed border-border hover:border-[#8B2020] hover:bg-red-50/20 flex flex-col items-center justify-center p-2 text-center transition cursor-pointer ${isUploading ? "opacity-60 pointer-events-none" : ""}`}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/avif"
                        multiple
                        className="hidden"
                        onChange={(e) => handlePhotoUpload(e.target.files)}
                      />
                      {isUploading ? (
                        <Loader2 className="size-5 text-[#8B2020] animate-spin" />
                      ) : (
                        <>
                          <ImageIcon className="size-5 text-gray-400 group-hover:text-[#8B2020]" />
                          <span className="text-[10px] font-bold text-muted-foreground mt-1">
                            + Photo
                          </span>
                        </>
                      )}
                    </label>
                  )}
                </div>
              </div>

              {/* Submit / Cancel Buttons */}
              <div className="flex items-center gap-3 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:bg-muted transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitReview.isPending || isUploading || !comment.trim()}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#8B2020] text-white text-sm font-bold shadow-xs hover:bg-[#7a1c1c] transition disabled:opacity-50 cursor-pointer"
                >
                  {submitReview.isPending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      <span>Submitting...</span>
                    </>
                  ) : (
                    <span>{existingReview ? "Update Review" : "Submit Verified Review"}</span>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
