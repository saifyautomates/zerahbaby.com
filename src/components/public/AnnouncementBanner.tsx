import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkle, Truck, X } from "lucide-react";
import { useSettings } from "@/lib/store";
import { useAdminMode } from "@/lib/admin-mode";

export function AnnouncementBanner() {
  const { settings, announcement } = useSettings();
  const { isAdmin } = useAdminMode();
  const [dismissed, setDismissed] = useState(false);

  const enabled = settings["announcement_enabled"] !== "false";
  const text = announcement?.trim();
  const bgColor = settings["announcement_bg"] || "#8B2020";
  const textColor = settings["announcement_text_color"] || "#FFFFFF";
  const link = settings["announcement_link"]?.trim();

  // If banner is disabled, empty, or dismissed, collapse completely (render nothing)
  if (!enabled || !text || dismissed) {
    return null;
  }

  const isDefaultBurgundy = bgColor.toLowerCase() === "#8b2020";

  const content = (
    <div className="relative z-[3] mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-1.5 sm:px-4">
      {/* Desktop left trust badge */}
      <div className="hidden flex-1 items-center gap-2 lg:flex">
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 bg-black/15 text-[10px] font-semibold uppercase tracking-wider border border-white/10">
          <Truck className="size-3 announce-gold-text shrink-0" aria-hidden="true" />
          Pan-India Shipping
        </span>
      </div>

      {/* Center announcement with signature stars */}
      <div className="flex flex-1 items-center justify-center overflow-hidden">
        <div className="flex items-center justify-center gap-2 text-center sm:gap-2.5">
          <Sparkle className="size-3 shrink-0 announce-gold-text animate-pulse" aria-hidden="true" />
          <p
            className="font-display text-[11px] sm:text-xs font-semibold uppercase tracking-widest leading-normal text-center"
            style={{ color: textColor }}
          >
            {text}
          </p>
          <Sparkle className="size-3 shrink-0 announce-gold-text animate-pulse" aria-hidden="true" />
        </div>
      </div>

      {/* Right spacer / Admin Dismiss button */}
      <div className="flex flex-1 items-center justify-end gap-2">
        {isAdmin && (
          <button
            type="button"
            aria-label="Dismiss announcement temporarily"
            title="Dismiss announcement (Admin only)"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setDismissed(true);
            }}
            className="flex size-5 shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-75 cursor-pointer bg-black/15 text-white/90 hover:text-white"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div
      role="region"
      aria-label="Announcement"
      className="announce-bar w-full transition-all duration-300 relative overflow-hidden"
      style={{
        backgroundColor: bgColor,
        color: textColor,
      }}
    >
      {isDefaultBurgundy && <span className="announce-sheen" aria-hidden="true" />}
      {link ? (
        <Link to={link} className="block transition-opacity hover:opacity-95">
          {content}
        </Link>
      ) : (
        content
      )}
    </div>
  );
}
