import { Link } from "@tanstack/react-router";
import { Sparkle, Truck } from "lucide-react";
import { useSettings } from "@/lib/store";

export function AnnouncementBanner() {
  const { settings, announcement } = useSettings();

  const enabled = settings["announcement_enabled"] !== "false";
  const text = announcement?.trim();
  const bgColor = settings["announcement_bg"] || "#8B2020";
  const textColor = settings["announcement_text_color"] || "#FFFFFF";
  const link = settings["announcement_link"]?.trim();

  // If banner is disabled or empty, render nothing
  if (!enabled || !text) {
    return null;
  }

  const isPinkBlueGradient =
    bgColor.toLowerCase() === "#8b2020" ||
    bgColor === "gradient" ||
    bgColor.includes("#e82a82") ||
    bgColor.includes("#d946ef") ||
    !bgColor;

  const content = (
    <div className="relative z-[3] mx-auto flex w-full max-w-7xl items-center justify-center gap-2 px-2 py-0.5 sm:px-4 sm:py-1 min-h-[26px] sm:min-h-[30px]">
      <div className="flex items-center justify-center gap-2 text-center overflow-hidden">
        <Truck className="size-3 sm:size-3.5 shrink-0 text-white" aria-hidden="true" />
        <p
          className="font-display text-[9.5px] sm:text-[11px] font-bold uppercase tracking-[0.14em] leading-none whitespace-nowrap text-white drop-shadow-2xs"
        >
          {text}
        </p>
        <span className="text-[10px] text-white/90 shrink-0 font-display">✦</span>
      </div>
    </div>
  );

  return (
    <div
      role="region"
      aria-label="Announcement"
      className="announce-bar w-full transition-all duration-300 relative overflow-hidden h-7 sm:h-8 flex items-center shadow-2xs"
      style={{
        background: isPinkBlueGradient
          ? "linear-gradient(90deg, #E82A82 0%, #A855F7 50%, #00B4D8 100%)"
          : bgColor,
        color: textColor,
      }}
    >
      <span className="announce-sheen" aria-hidden="true" />
      {link ? (
        /^https?:\/\//i.test(link) || link.startsWith("tel:") || link.startsWith("mailto:") ? (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full transition-opacity hover:opacity-95"
          >
            {content}
          </a>
        ) : (
          <Link
            to={(link.startsWith("/") ? link : `/${link}`) as any}
            className="block w-full transition-opacity hover:opacity-95"
          >
            {content}
          </Link>
        )
      ) : (
        <div className="w-full">{content}</div>
      )}
    </div>
  );
}
