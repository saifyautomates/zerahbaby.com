import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles, X } from "lucide-react";
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

  const content = (
    <div className="relative z-[3] mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-1.5 sm:px-4">
      <div className="flex flex-1 items-center justify-center gap-2 text-center">
        <Sparkles className="size-3 shrink-0 opacity-80" aria-hidden="true" />
        <p
          className="font-display text-[11px] sm:text-xs font-semibold uppercase tracking-widest leading-normal"
          style={{ color: textColor }}
        >
          {text}
        </p>
        <Sparkles className="size-3 shrink-0 opacity-80" aria-hidden="true" />
      </div>

      {isAdmin && (
        <button
          type="button"
          aria-label="Dismiss announcement temporarily"
          title="Dismiss announcement (Admin only)"
          onClick={(e) => {
            e.stopPropagation();
            setDismissed(true);
          }}
          className="flex size-5 shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-75 cursor-pointer"
          style={{ color: textColor }}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );

  return (
    <div
      role="region"
      aria-label="Announcement"
      className="w-full transition-all duration-300 relative overflow-hidden"
      style={{
        backgroundColor: bgColor,
        color: textColor,
      }}
    >
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
