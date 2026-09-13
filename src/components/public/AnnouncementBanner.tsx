import { Link } from "@tanstack/react-router";
import { Sparkle, Truck } from "lucide-react";
import { useSettings } from "@/lib/store";

export function AnnouncementBanner() {
  const { settings, announcement } = useSettings();

  const enabled = settings["announcement_enabled"] !== "false";
  const text = announcement?.trim();
  const rawBg = settings["announcement_bg"]?.trim();
  const textColor = settings["announcement_text_color"] || "#FFFFFF";
  const link = settings["announcement_link"]?.trim();

  // If banner is disabled or empty, render nothing
  if (!enabled || !text) {
    return null;
  }

  // Treat default burgundy, empty, or explicit gradient as the signature Pink & Blue gradient
  const isPinkBlueGradient =
    !rawBg ||
    rawBg.toLowerCase() === "#8b2020" ||
    rawBg.toLowerCase() === "#7a2626" ||
    rawBg.toLowerCase() === "gradient" ||
    rawBg.includes("#e82a82") ||
    rawBg.includes("#d946ef");

  const effectiveBg = isPinkBlueGradient
    ? "linear-gradient(90deg, #E82A82 0%, #A855F7 50%, #00B4D8 100%)"
    : rawBg;

  const content = (
    <div className="relative z-[3] mx-auto flex w-full max-w-7xl items-center justify-between gap-2 px-2 py-0.5 sm:px-4 sm:py-1 min-h-[28px] sm:min-h-[32px]">
      {/* Desktop left trust badge */}
      <div className="hidden flex-1 items-center gap-2 lg:flex">
        <span className="announce-pill">
          <Truck className="size-3 announce-gold-text text-amber-300 shrink-0" aria-hidden="true" />
          Pan-India Shipping
        </span>
      </div>

      {/* Desktop Center Announcement (static, single line, perfectly centered) */}
      <div className="hidden lg:flex flex-1 items-center justify-center overflow-hidden">
        <div className="flex items-center justify-center gap-2 text-center">
          <Sparkle
            className="size-3 shrink-0 announce-gold-text text-amber-300 animate-pulse"
            aria-hidden="true"
          />
          <p className="font-display text-[11px] font-bold uppercase tracking-widest leading-none whitespace-nowrap text-white drop-shadow-xs">
            {text}
          </p>
          <Sparkle
            className="size-3 shrink-0 announce-gold-text text-amber-300 animate-pulse"
            aria-hidden="true"
          />
        </div>
      </div>

      {/* Mobile Ultra-Slim Marquee (Single line, smooth continuous horizontal scroll, 0 line wrapping) */}
      <div
        className="flex flex-1 items-center justify-center overflow-hidden lg:hidden"
        aria-label="Announcement"
      >
        <div className="group relative w-full overflow-hidden whitespace-nowrap">
          <div className="announce-marquee group-hover:announce-marquee-pause whitespace-nowrap flex items-center">
            <span className="inline-flex items-center gap-1.5 px-3 font-display text-[10px] font-bold uppercase tracking-wider whitespace-nowrap leading-none text-white">
              <Sparkle
                className="size-2.5 shrink-0 announce-gold-text text-amber-300"
                aria-hidden="true"
              />
              {text}
              <Sparkle
                className="size-2.5 shrink-0 announce-gold-text text-amber-300"
                aria-hidden="true"
              />
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 font-display text-[10px] font-bold uppercase tracking-wider whitespace-nowrap leading-none text-white">
              <Sparkle
                className="size-2.5 shrink-0 announce-gold-text text-amber-300"
                aria-hidden="true"
              />
              {text}
              <Sparkle
                className="size-2.5 shrink-0 announce-gold-text text-amber-300"
                aria-hidden="true"
              />
            </span>
          </div>
        </div>
      </div>

      {/* Right spacer for symmetrical centering */}
      <div className="hidden sm:flex flex-none lg:flex-1 items-center justify-end gap-2" />
    </div>
  );

  return (
    <div
      role="region"
      aria-label="Announcement"
      className="announce-bar w-full transition-all duration-300 relative overflow-hidden h-7 sm:h-8 flex items-center shadow-xs"
      style={{
        background: effectiveBg,
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
