/**
 * homepage-themes.ts
 *
 * Professional Theme & Visual Styling Engine for Zérah Baby & Kids Dynamic Homepage CMS.
 * Provides curated theme presets, safe color validation, decorative SVG patterns,
 * festival/campaign templates, and card treatment resolvers.
 */

export type ThemePresetId =
  | "DEFAULT"
  | "SOFT_CREAM"
  | "BLUSH"
  | "PASTEL"
  | "MINT"
  | "LAVENDER"
  | "FESTIVE"
  | "DARK_FESTIVE"
  | "SALE"
  | "PREMIUM"
  | "MINIMAL";

export type CardStyle = "default" | "minimal" | "premium" | "festive";

export type PatternOverlay = "none" | "sparkles" | "dots" | "stars" | "mandala" | "confetti";

export type SpacingVariant = "compact" | "normal" | "spacious";

export interface ThemeConfig {
  bg_color?: string;
  bg_gradient?: string;
  heading_color?: string;
  text_color?: string;
  accent_color?: string;
  border_color?: string;
  cta_bg?: string;
  cta_text?: string;
  badge_bg?: string;
  badge_text_color?: string;
  card_style?: CardStyle;
  pattern_overlay?: PatternOverlay;
  background_image_url?: string;
  background_image_opacity?: number; // 0.05 to 1.0
}

export interface ThemePresetDefinition {
  id: ThemePresetId;
  name: string;
  description: string;
  isDark?: boolean;
  defaults: {
    bg_color: string;
    bg_gradient?: string;
    heading_color: string;
    text_color: string;
    accent_color: string;
    border_color: string;
    cta_bg: string;
    cta_text: string;
    badge_bg: string;
    badge_text_color: string;
    card_style: CardStyle;
    pattern_overlay: PatternOverlay;
  };
}

export const THEME_PRESETS: Record<ThemePresetId, ThemePresetDefinition> = {
  DEFAULT: {
    id: "DEFAULT",
    name: "Classic Zérah",
    description: "Clean organic storefront aesthetic with natural tones",
    defaults: {
      bg_color: "#FAFAF9",
      heading_color: "#1C1917",
      text_color: "#78716C",
      accent_color: "#993B22",
      border_color: "#E7E5E4",
      cta_bg: "#993B22",
      cta_text: "#FFFFFF",
      badge_bg: "#F5F5F4",
      badge_text_color: "#78716C",
      card_style: "default",
      pattern_overlay: "none",
    },
  },
  SOFT_CREAM: {
    id: "SOFT_CREAM",
    name: "Warm Almond Cream",
    description: "Gentle cozy warmth inspired by organic cotton and nursery linen",
    defaults: {
      bg_color: "#FDFBF7",
      heading_color: "#451A03",
      text_color: "#78350F",
      accent_color: "#D97706",
      border_color: "#FDE68A",
      cta_bg: "#78350F",
      cta_text: "#FFFFFF",
      badge_bg: "#FEF3C7",
      badge_text_color: "#92400E",
      card_style: "default",
      pattern_overlay: "dots",
    },
  },
  BLUSH: {
    id: "BLUSH",
    name: "Rose Blush",
    description: "Soft playful rose garden tones for infant clothing & dresses",
    defaults: {
      bg_color: "#FFF5F5",
      heading_color: "#881337",
      text_color: "#9F1239",
      accent_color: "#E11D48",
      border_color: "#FECDD3",
      cta_bg: "#E11D48",
      cta_text: "#FFFFFF",
      badge_bg: "#FFE4E6",
      badge_text_color: "#9F1239",
      card_style: "premium",
      pattern_overlay: "sparkles",
    },
  },
  PASTEL: {
    id: "PASTEL",
    name: "Airy Pastel Cloud",
    description: "Soothing gradient of lavender and soft peach for dreamy essentials",
    defaults: {
      bg_color: "#FAF5FF",
      bg_gradient: "linear-gradient(135deg, #FAF5FF 0%, #FFF7ED 100%)",
      heading_color: "#581C87",
      text_color: "#6B21A8",
      accent_color: "#C026D3",
      border_color: "#E9D5FF",
      cta_bg: "#7E22CE",
      cta_text: "#FFFFFF",
      badge_bg: "#F3E8FF",
      badge_text_color: "#6B21A8",
      card_style: "default",
      pattern_overlay: "sparkles",
    },
  },
  MINT: {
    id: "MINT",
    name: "Fresh Eucalyptus & Sage",
    description: "Invigorating nature-inspired botanical palette for bath & care",
    defaults: {
      bg_color: "#F0FDF4",
      heading_color: "#064E3B",
      text_color: "#065F46",
      accent_color: "#059669",
      border_color: "#A7F3D0",
      cta_bg: "#059669",
      cta_text: "#FFFFFF",
      badge_bg: "#DCFCE7",
      badge_text_color: "#065F46",
      card_style: "default",
      pattern_overlay: "dots",
    },
  },
  LAVENDER: {
    id: "LAVENDER",
    name: "Gentle Lilac",
    description: "Calming sweet dreams palette for bedtimewear and nursery comfort",
    defaults: {
      bg_color: "#F5F3FF",
      heading_color: "#3B0764",
      text_color: "#581C87",
      accent_color: "#7C3AED",
      border_color: "#DDD6FE",
      cta_bg: "#7C3AED",
      cta_text: "#FFFFFF",
      badge_bg: "#EDE9FE",
      badge_text_color: "#581C87",
      card_style: "premium",
      pattern_overlay: "stars",
    },
  },
  FESTIVE: {
    id: "FESTIVE",
    name: "Royal Festive Gold",
    description: "Glorious golden radiance for Diwali, weddings, and celebratory moments",
    defaults: {
      bg_color: "#FFFBEB",
      bg_gradient: "linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 50%, #FFFBEB 100%)",
      heading_color: "#78350F",
      text_color: "#92400E",
      accent_color: "#D97706",
      border_color: "#FCD34D",
      cta_bg: "#B45309",
      cta_text: "#FFFFFF",
      badge_bg: "#FDE68A",
      badge_text_color: "#78350F",
      card_style: "festive",
      pattern_overlay: "mandala",
    },
  },
  DARK_FESTIVE: {
    id: "DARK_FESTIVE",
    name: "Midnight Festive Gala",
    description: "Sleek royal navy with sparkling golden highlights for Diwali & New Year",
    isDark: true,
    defaults: {
      bg_color: "#0B132B",
      bg_gradient: "linear-gradient(135deg, #0B132B 0%, #1C2541 100%)",
      heading_color: "#FEF08A",
      text_color: "#E2E8F0",
      accent_color: "#F59E0B",
      border_color: "rgba(252, 211, 77, 0.25)",
      cta_bg: "#F59E0B",
      cta_text: "#0F172A",
      badge_bg: "rgba(245, 158, 11, 0.2)",
      badge_text_color: "#FDE68A",
      card_style: "festive",
      pattern_overlay: "sparkles",
    },
  },
  SALE: {
    id: "SALE",
    name: "High-Energy Red Sale",
    description: "Attention-grabbing promotional theme for end-of-season clearance",
    defaults: {
      bg_color: "#FEF2F2",
      heading_color: "#991B1B",
      text_color: "#B91C1C",
      accent_color: "#EF4444",
      border_color: "#FECACA",
      cta_bg: "#DC2626",
      cta_text: "#FFFFFF",
      badge_bg: "#FEE2E2",
      badge_text_color: "#991B1B",
      card_style: "default",
      pattern_overlay: "confetti",
    },
  },
  PREMIUM: {
    id: "PREMIUM",
    name: "Editorial Champagne",
    description: "Quiet luxury aesthetic for high-end wooden toys and imported apparel",
    defaults: {
      bg_color: "#FBFBFA",
      heading_color: "#1C1917",
      text_color: "#44403C",
      accent_color: "#B45309",
      border_color: "#E7E5E4",
      cta_bg: "#1C1917",
      cta_text: "#FFFFFF",
      badge_bg: "#F5F5F4",
      badge_text_color: "#1C1917",
      card_style: "premium",
      pattern_overlay: "none",
    },
  },
  MINIMAL: {
    id: "MINIMAL",
    name: "Studio Monochrome",
    description: "High-contrast architectural simplicity focusing 100% on product photography",
    defaults: {
      bg_color: "#FFFFFF",
      heading_color: "#09090B",
      text_color: "#52525B",
      accent_color: "#18181B",
      border_color: "#E4E4E7",
      cta_bg: "#09090B",
      cta_text: "#FFFFFF",
      badge_bg: "#F4F4F5",
      badge_text_color: "#09090B",
      card_style: "minimal",
      pattern_overlay: "none",
    },
  },
};

/**
 * Festival & Campaign Quick Presets
 */
export interface CampaignPreset {
  id: string;
  name: string;
  suggestedTitle: string;
  suggestedSubtitle: string;
  badge: string;
  themePreset: ThemePresetId;
  cardStyle: CardStyle;
  pattern: PatternOverlay;
  ctaLabel: string;
}

export const CAMPAIGN_PRESETS: CampaignPreset[] = [
  {
    id: "diwali",
    name: "Diwali Specials",
    suggestedTitle: "Diwali Specials",
    suggestedSubtitle: "Celebrate the festival of lights with royal festive picks",
    badge: "✨ DIWALI SPECIAL",
    themePreset: "FESTIVE",
    cardStyle: "festive",
    pattern: "mandala",
    ctaLabel: "Shop Festive Picks",
  },
  {
    id: "eid",
    name: "Eid Collection",
    suggestedTitle: "Eid Celebrations",
    suggestedSubtitle: "Pure, elegant styles handpicked for joyful festive moments",
    badge: "🌙 EID SPECIAL",
    themePreset: "MINT",
    cardStyle: "premium",
    pattern: "stars",
    ctaLabel: "Explore Eid Wear",
  },
  {
    id: "christmas",
    name: "Christmas Magic",
    suggestedTitle: "Holiday Magic",
    suggestedSubtitle: "Cozy knits, wooden toys, and festive cheer for little ones",
    badge: "🎄 HOLIDAY SPECIAL",
    themePreset: "SALE",
    cardStyle: "festive",
    pattern: "sparkles",
    ctaLabel: "Shop Holiday Gifts",
  },
  {
    id: "new_year",
    name: "New Year Gala",
    suggestedTitle: "New Year, Fresh Starts",
    suggestedSubtitle: "Ring in the season with dazzling styles and nursery refreshes",
    badge: "🎉 2026 CELEBRATION",
    themePreset: "DARK_FESTIVE",
    cardStyle: "festive",
    pattern: "confetti",
    ctaLabel: "Ring In The New Year",
  },
  {
    id: "summer",
    name: "Sunny Days",
    suggestedTitle: "Sunny Day Picks",
    suggestedSubtitle: "Breathable 100% organic cottons to keep baby light and cool",
    badge: "☀️ SUMMER SPECIAL",
    themePreset: "SOFT_CREAM",
    cardStyle: "default",
    pattern: "dots",
    ctaLabel: "Shop Summer Styles",
  },
  {
    id: "winter",
    name: "Cozy Winter",
    suggestedTitle: "Cozy Winter Snuggles",
    suggestedSubtitle: "Layered warmth, thermal rompers, and plush nursery blankets",
    badge: "❄️ WINTER SNUGGLES",
    themePreset: "LAVENDER",
    cardStyle: "premium",
    pattern: "stars",
    ctaLabel: "Wrap In Warmth",
  },
  {
    id: "clearance",
    name: "Clearance Sale",
    suggestedTitle: "Clearance & Mega Deals",
    suggestedSubtitle:
      "Unbeatable prices on last-chance favorites — grab them before they are gone",
    badge: "🔥 FLAT 40% OFF",
    themePreset: "SALE",
    cardStyle: "default",
    pattern: "confetti",
    ctaLabel: "Grab Clearance Deals",
  },
];

/**
 * Validates a color value strictly against HEX, RGB, RGBA, and HSL to avoid arbitrary CSS injection.
 */
export function isValidSafeColor(val: string | undefined): boolean {
  if (!val) return false;
  const trimmed = val.trim();
  // Hex color
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) {
    return true;
  }
  // RGB or RGBA
  if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)$/i.test(trimmed)) {
    return true;
  }
  // HSL or HSLA
  if (/^hsla?\(\s*\d+\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(?:,\s*[\d.]+\s*)?\)$/i.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * Resolves complete computed styles and visual attributes for a homepage section.
 */
export function resolveSectionTheme(
  presetId?: ThemePresetId | null,
  customConfig?: ThemeConfig | null,
) {
  const presetKey = presetId && THEME_PRESETS[presetId] ? presetId : "DEFAULT";
  const preset = THEME_PRESETS[presetKey];
  const conf = customConfig || {};

  const bgColor = isValidSafeColor(conf.bg_color) ? conf.bg_color! : preset.defaults.bg_color;
  const bgGradient = conf.bg_gradient || preset.defaults.bg_gradient || "";
  const headingColor = isValidSafeColor(conf.heading_color)
    ? conf.heading_color!
    : preset.defaults.heading_color;
  const textColor = isValidSafeColor(conf.text_color)
    ? conf.text_color!
    : preset.defaults.text_color;
  const accentColor = isValidSafeColor(conf.accent_color)
    ? conf.accent_color!
    : preset.defaults.accent_color;
  const borderColor = isValidSafeColor(conf.border_color)
    ? conf.border_color!
    : preset.defaults.border_color;
  const ctaBg = isValidSafeColor(conf.cta_bg) ? conf.cta_bg! : preset.defaults.cta_bg;
  const ctaText = isValidSafeColor(conf.cta_text) ? conf.cta_text! : preset.defaults.cta_text;
  const badgeBg = isValidSafeColor(conf.badge_bg) ? conf.badge_bg! : preset.defaults.badge_bg;
  const badgeTextColor = isValidSafeColor(conf.badge_text_color)
    ? conf.badge_text_color!
    : preset.defaults.badge_text_color;
  const cardStyle = conf.card_style || preset.defaults.card_style;
  const patternOverlay = conf.pattern_overlay || preset.defaults.pattern_overlay;

  const containerStyle: React.CSSProperties = {
    backgroundColor: bgColor,
    ...(bgGradient ? { backgroundImage: bgGradient } : {}),
    color: textColor,
    borderColor: borderColor,
  };

  return {
    preset,
    isDark: Boolean(preset.isDark),
    bgColor,
    bgGradient,
    headingColor,
    textColor,
    accentColor,
    borderColor,
    ctaBg,
    ctaText,
    badgeBg,
    badgeTextColor,
    cardStyle,
    patternOverlay,
    backgroundImageUrl: conf.background_image_url || "",
    backgroundImageOpacity: conf.background_image_opacity ?? 0.15,
    containerStyle,
  };
}

/**
 * Returns the SVG decorative background pattern class or inline SVG background data URL.
 */
export function getPatternSvgDataUrl(pattern: PatternOverlay, accentColor: string): string | null {
  if (pattern === "none") return null;

  const color = encodeURIComponent(accentColor || "#D97706");

  switch (pattern) {
    case "sparkles":
      return `data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='${color}' fill-opacity='0.08' fill-rule='evenodd'%3E%3Cpath d='M30 10l2 6 6 2-6 2-2 6-2-6-6-2 6-2zM10 40l1 3 3 1-3 1-1 3-1-3-3-1 3-1zM50 45l1 2 2 1-2 1-1 2-1-2-2-1 2-1z'/%3E%3C/g%3E%3C/svg%3E`;
    case "dots":
      return `data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='12' cy='12' r='1.5' fill='${color}' fill-opacity='0.08'/%3E%3C/svg%3E`;
    case "stars":
      return `data:image/svg+xml,%3Csvg width='48' height='48' viewBox='0 0 48 48' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='${color}' fill-opacity='0.07'%3E%3Cpolygon points='24 4 27 18 41 21 27 24 24 38 21 24 7 21 21 18'/%3E%3C/g%3E%3C/svg%3E`;
    case "mandala":
      return `data:image/svg+xml,%3Csvg width='80' height='80' viewBox='0 0 80 80' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='${color}' fill-opacity='0.06' stroke='${color}' stroke-opacity='0.06' stroke-width='1'%3E%3Ccircle cx='40' cy='40' r='12' fill='none'/%3E%3Ccircle cx='40' cy='40' r='24' fill='none' stroke-dasharray='2,4'/%3E%3Cpath d='M40 0 L40 80 M0 40 L80 40'/%3E%3C/g%3E%3C/svg%3E`;
    case "confetti":
      return `data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='${color}' fill-opacity='0.08'%3E%3Crect x='6' y='6' width='3' height='6' rx='1' transform='rotate(25 7.5 9)'/%3E%3Ccircle cx='28' cy='12' r='2'/%3E%3Crect x='22' y='28' width='6' height='3' rx='1' transform='rotate(45 25 29.5)'/%3E%3Cpolygon points='10 32 13 36 7 36'/%3E%3C/g%3E%3C/svg%3E`;
    default:
      return null;
  }
}
