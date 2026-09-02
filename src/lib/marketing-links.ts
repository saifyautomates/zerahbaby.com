/**
 * Authoritative Validation, Sanitization & Normalization Engine for
 * Marketing, Social Profiles & Customer Chat Links (Zérah Baby & Kids).
 */

export interface ValidationResult {
  isValid: boolean;
  normalizedUrl: string;
  error?: string;
}

/**
 * Check for dangerous or unsafe protocols
 */
export function containsDangerousProtocol(raw: string): boolean {
  if (!raw) return false;
  const lower = raw.trim().toLowerCase();
  // Strip whitespace and control chars that attackers use to bypass checks
  const sanitized = lower.replace(/[\u0000-\u001F\u007F-\u009F\s]/g, "");
  return (
    sanitized.startsWith("javascript:") ||
    sanitized.startsWith("data:") ||
    sanitized.startsWith("file:") ||
    sanitized.startsWith("vbscript:") ||
    sanitized.startsWith("blob:") ||
    sanitized.includes("javascript:")
  );
}

/**
 * Validate and Normalize Instagram Profile URL or Handle
 * Accepts:
 * - Handle: "zerah_kids", "@zerah_kids"
 * - Domain: "instagram.com/zerah_kids", "www.instagram.com/zerah_kids"
 * - Full URL: "https://www.instagram.com/zerah_kids/"
 */
export function validateAndNormalizeInstagram(raw: string): ValidationResult {
  const trimmed = (raw || "").trim();
  if (!trimmed) {
    return { isValid: true, normalizedUrl: "" };
  }

  if (containsDangerousProtocol(trimmed)) {
    return {
      isValid: false,
      normalizedUrl: "",
      error: "Unsafe protocol detected (javascript:, data:, etc. are forbidden)",
    };
  }

  // Handle format: "@zerah_kids" or "zerah_kids"
  const handleMatch = trimmed.match(/^@?([a-zA-Z0-9._]{1,30})$/);
  if (handleMatch) {
    const handle = handleMatch[1];
    return {
      isValid: true,
      normalizedUrl: `https://www.instagram.com/${handle}/`,
    };
  }

  // URL format
  let urlToParse = trimmed;
  if (!urlToParse.startsWith("http://") && !urlToParse.startsWith("https://")) {
    urlToParse = `https://${urlToParse}`;
  }

  try {
    const parsed = new URL(urlToParse);
    const host = parsed.hostname.toLowerCase();
    const isInstagramHost =
      host === "instagram.com" ||
      host === "www.instagram.com" ||
      host === "instagr.am" ||
      host === "www.instagr.am";

    if (!isInstagramHost) {
      return {
        isValid: false,
        normalizedUrl: "",
        error: "Must be an official Instagram link (instagram.com/username) or handle (@username)",
      };
    }

    // Path check: must have a profile path
    const path = parsed.pathname.replace(/^\/+|\/+$/g, "");
    if (!path) {
      return {
        isValid: false,
        normalizedUrl: "",
        error: "Instagram link must include a profile username (e.g. https://instagram.com/zerah_kids)",
      };
    }

    // Force https and www.instagram.com
    return {
      isValid: true,
      normalizedUrl: `https://www.instagram.com/${path}/${parsed.search}${parsed.hash}`,
    };
  } catch {
    return {
      isValid: false,
      normalizedUrl: "",
      error: "Invalid Instagram URL format",
    };
  }
}

/**
 * Validate and Normalize Facebook Page URL or Handle
 * Accepts:
 * - Handle: "zerahbaby", "@zerahbaby"
 * - Domain: "facebook.com/zerahbaby", "fb.com/zerahbaby"
 * - Full URL: "https://www.facebook.com/zerahbaby/"
 */
export function validateAndNormalizeFacebook(raw: string): ValidationResult {
  const trimmed = (raw || "").trim();
  if (!trimmed) {
    return { isValid: true, normalizedUrl: "" };
  }

  if (containsDangerousProtocol(trimmed)) {
    return {
      isValid: false,
      normalizedUrl: "",
      error: "Unsafe protocol detected (javascript:, data:, etc. are forbidden)",
    };
  }

  // Handle format: "@zerahbaby" or "zerahbaby" (must not contain slash or dots like domains)
  if (!trimmed.includes("/") && !trimmed.includes(".")) {
    const handleMatch = trimmed.match(/^@?([a-zA-Z0-9.]{1,50})$/);
    if (handleMatch) {
      const handle = handleMatch[1];
      return {
        isValid: true,
        normalizedUrl: `https://www.facebook.com/${handle}`,
      };
    }
  }

  // URL format
  let urlToParse = trimmed;
  if (!urlToParse.startsWith("http://") && !urlToParse.startsWith("https://")) {
    urlToParse = `https://${urlToParse}`;
  }

  try {
    const parsed = new URL(urlToParse);
    const host = parsed.hostname.toLowerCase();
    const isFacebookHost =
      host === "facebook.com" ||
      host === "www.facebook.com" ||
      host === "m.facebook.com" ||
      host === "fb.com" ||
      host === "www.fb.com" ||
      host === "fb.me";

    if (!isFacebookHost) {
      return {
        isValid: false,
        normalizedUrl: "",
        error: "Must be an official Facebook page URL (facebook.com/page) or page username",
      };
    }

    const path = parsed.pathname.replace(/^\/+|\/+$/g, "");
    if (!path) {
      return {
        isValid: false,
        normalizedUrl: "",
        error: "Facebook link must include a page or profile identifier",
      };
    }

    return {
      isValid: true,
      normalizedUrl: `https://www.facebook.com/${path}${parsed.search}${parsed.hash}`,
    };
  } catch {
    return {
      isValid: false,
      normalizedUrl: "",
      error: "Invalid Facebook URL format",
    };
  }
}

/**
 * Validate and Normalize WhatsApp Link or Phone Number
 * Accepts:
 * - 10-digit Indian Mobile: "9057074777", "+91 90570 74777", "09057074777", "919057074777"
 * - International E.164: "+1 555 234 5678"
 * - wa.me link: "https://wa.me/919057074777", "wa.me/919057074777"
 * - api.whatsapp.com link: "https://api.whatsapp.com/send?phone=919057074777"
 * - chat.whatsapp.com group link: "https://chat.whatsapp.com/ABC123xyz"
 */
export function validateAndNormalizeWhatsApp(raw: string): ValidationResult {
  const trimmed = (raw || "").trim();
  if (!trimmed) {
    return { isValid: true, normalizedUrl: "" };
  }

  if (containsDangerousProtocol(trimmed)) {
    return {
      isValid: false,
      normalizedUrl: "",
      error: "Unsafe protocol detected (javascript:, data:, etc. are forbidden)",
    };
  }

  // 1. Check if raw input is a pure phone number
  const cleanDigits = trimmed.replace(/[^0-9]/g, "");
  const isPhoneFormat = /^[+0-9\s-()]+$/.test(trimmed) && cleanDigits.length >= 10;

  if (isPhoneFormat) {
    // Check 10-digit Indian mobile (starts with 6-9, or prefixed with 0 or 91)
    if (cleanDigits.length === 10) {
      return {
        isValid: true,
        normalizedUrl: `https://wa.me/91${cleanDigits}`,
      };
    }
    if (cleanDigits.length === 11 && cleanDigits.startsWith("0")) {
      return {
        isValid: true,
        normalizedUrl: `https://wa.me/91${cleanDigits.slice(1)}`,
      };
    }
    if (cleanDigits.length === 12 && cleanDigits.startsWith("91")) {
      return {
        isValid: true,
        normalizedUrl: `https://wa.me/${cleanDigits}`,
      };
    }
    // Generic international phone (10-15 digits)
    if (cleanDigits.length >= 10 && cleanDigits.length <= 15) {
      return {
        isValid: true,
        normalizedUrl: `https://wa.me/${cleanDigits}`,
      };
    }
    return {
      isValid: false,
      normalizedUrl: "",
      error: "Invalid phone number length. Indian mobile numbers must be 10 digits.",
    };
  }

  // 2. Check if URL format
  let urlToParse = trimmed;
  if (!urlToParse.startsWith("http://") && !urlToParse.startsWith("https://")) {
    urlToParse = `https://${urlToParse}`;
  }

  try {
    const parsed = new URL(urlToParse);
    const host = parsed.hostname.toLowerCase();
    const isWhatsAppHost =
      host === "wa.me" ||
      host === "api.whatsapp.com" ||
      host === "chat.whatsapp.com" ||
      host === "web.whatsapp.com";

    if (!isWhatsAppHost) {
      return {
        isValid: false,
        normalizedUrl: "",
        error: "Must be a valid WhatsApp link (wa.me/number) or direct 10-digit mobile number",
      };
    }

    if (host === "wa.me") {
      const cleanPath = parsed.pathname.replace(/^\/+|\/+$/g, "");
      const digitsOnly = cleanPath.replace(/[^0-9]/g, "");
      if (digitsOnly.length === 10) {
        return {
          isValid: true,
          normalizedUrl: `https://wa.me/91${digitsOnly}${parsed.search}`,
        };
      }
      if (digitsOnly.length >= 10 && digitsOnly.length <= 15) {
        return {
          isValid: true,
          normalizedUrl: `https://wa.me/${digitsOnly}${parsed.search}`,
        };
      }
      return {
        isValid: false,
        normalizedUrl: "",
        error: "wa.me link must include a valid phone number (e.g. https://wa.me/919057074777)",
      };
    }

    // api.whatsapp.com or chat.whatsapp.com
    return {
      isValid: true,
      normalizedUrl: `https://${host}${parsed.pathname}${parsed.search}${parsed.hash}`,
    };
  } catch {
    return {
      isValid: false,
      normalizedUrl: "",
      error: "Invalid WhatsApp link or phone number format",
    };
  }
}

/**
 * Validate announcement clickable target link
 * Accepts:
 * - Internal route: "/shop", "/product/abc", "/contact"
 * - External link: "https://..."
 */
export function validateAndNormalizeAnnouncementLink(raw: string): ValidationResult {
  const trimmed = (raw || "").trim();
  if (!trimmed) {
    return { isValid: true, normalizedUrl: "" };
  }

  if (containsDangerousProtocol(trimmed)) {
    return {
      isValid: false,
      normalizedUrl: "",
      error: "Unsafe protocol detected (javascript:, data:, etc. are forbidden)",
    };
  }

  // Internal route
  if (trimmed.startsWith("/")) {
    return {
      isValid: true,
      normalizedUrl: trimmed,
    };
  }

  // Full URL
  let urlToParse = trimmed;
  if (!urlToParse.startsWith("http://") && !urlToParse.startsWith("https://")) {
    urlToParse = `https://${urlToParse}`;
  }

  try {
    const parsed = new URL(urlToParse);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        isValid: false,
        normalizedUrl: "",
        error: "Only HTTP or HTTPS protocols are allowed for target link",
      };
    }
    return {
      isValid: true,
      normalizedUrl: urlToParse,
    };
  } catch {
    return {
      isValid: false,
      normalizedUrl: "",
      error: "Invalid target link format (use /path or https://...)",
    };
  }
}
