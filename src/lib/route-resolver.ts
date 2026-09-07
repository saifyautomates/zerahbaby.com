// Canonical URL resolver to permanently eliminate 404 errors across Zérah Baby & Kids
// Handles trailing slashes, route aliases, category paths, product paths, admin tabs, and keywords.

export interface ResolvedRoute {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, unknown>;
  replace?: boolean;
}

export function resolveUrlPath(
  pathname: string,
  searchParams?: Record<string, unknown>,
): ResolvedRoute | null {
  if (!pathname) return { to: "/" };

  // Normalize slashes & trim
  let clean = pathname.trim().replace(/\/+/g, "/");
  if (clean.length > 1 && clean.endsWith("/")) {
    clean = clean.slice(0, -1);
  }

  const lower = clean.toLowerCase();

  // 1. Root
  if (!lower || lower === "/") {
    if (pathname !== "/") {
      return { to: "/", search: searchParams };
    }
    return null;
  }

  // 2. Static canonical routes
  const staticCanonical: Record<string, string> = {
    "/shop": "/shop",
    "/cart": "/cart",
    "/checkout": "/checkout",
    "/categories": "/categories",
    "/about": "/about",
    "/contact": "/contact",
    "/orders": "/orders",
    "/profile": "/profile",
    "/wishlist": "/wishlist",
    "/auth": "/auth",
    "/admin": "/admin",
    "/privacy-policy": "/privacy-policy",
    "/terms-conditions": "/terms-conditions",
    "/cancellation-refund": "/cancellation-refund",
    "/shipping-delivery": "/shipping-delivery",
    "/returns": "/returns",
  };

  // If the path is a canonical static route but had trailing slashes (e.g. /shop/)
  if (staticCanonical[lower]) {
    if (pathname.endsWith("/") && pathname.length > 1) {
      return { to: staticCanonical[lower], search: searchParams };
    }
    // If it's already an exact canonical route without trailing slash, no redirect needed from splat
    return null;
  }

  // 3. Known Top-Level Route Aliases
  const routeAliases: Record<string, string> = {
    // Shop & Catalog
    "/products": "/shop",
    "/product": "/shop",
    "/store": "/shop",
    "/catalog": "/shop",
    "/all": "/shop",
    "/items": "/shop",
    "/shop-all": "/shop",
    "/collections/all": "/shop",

    // Categories
    "/category": "/categories",
    "/collection": "/categories",
    "/collections": "/categories",

    // Cart & Checkout
    "/bag": "/cart",
    "/basket": "/cart",
    "/my-cart": "/cart",

    // Orders & Tracking
    "/order": "/orders",
    "/track": "/orders",
    "/tracking": "/orders",
    "/my-orders": "/orders",

    // Auth & Profile
    "/login": "/auth",
    "/signin": "/auth",
    "/signup": "/auth",
    "/register": "/auth",
    "/account": "/profile",
    "/my-account": "/profile",
    "/user": "/profile",
    "/me": "/profile",

    // Wishlist
    "/saved": "/wishlist",
    "/favorites": "/wishlist",

    // Admin & POS
    "/dashboard": "/admin",
    "/pos": "/admin",
    "/billing": "/admin",

    // Legal / Policy
    "/privacy": "/privacy-policy",
    "/privacy_policy": "/privacy-policy",
    "/policy": "/privacy-policy",
    "/terms": "/terms-conditions",
    "/terms_and_conditions": "/terms-conditions",
    "/terms-and-conditions": "/terms-conditions",
    "/tnc": "/terms-conditions",
    "/refund": "/cancellation-refund",
    "/refunds": "/cancellation-refund",
    "/cancellation": "/cancellation-refund",
    "/cancellations": "/cancellation-refund",
    "/shipping": "/shipping-delivery",
    "/delivery": "/shipping-delivery",
    "/dispatch": "/shipping-delivery",
    "/return": "/returns",
    "/exchange": "/returns",
    "/returns-exchange": "/returns",
    "/returns-and-exchange": "/returns",

    // Help & Support
    "/help": "/contact",
    "/support": "/contact",
    "/faq": "/contact",
    "/faqs": "/contact",
    "/contact-us": "/contact",
    "/contactus": "/contact",
    "/about-us": "/about",
    "/aboutus": "/about",
    "/story": "/about",
  };

  if (routeAliases[lower]) {
    const target = routeAliases[lower];
    if (target === "/admin" && (lower === "/pos" || lower === "/billing")) {
      return { to: "/admin", search: { ...searchParams, tab: "billing" } };
    }
    return { to: target, search: searchParams };
  }

  // 4. Segmented prefix routing
  const segments = clean.split("/").filter(Boolean);
  const rootSegment = segments[0]?.toLowerCase();
  const subSegment = segments[1];

  // A. Product prefix: /product/:id or /products/:id or /item/:id
  if (
    rootSegment === "product" ||
    rootSegment === "products" ||
    rootSegment === "item" ||
    rootSegment === "items" ||
    rootSegment === "p"
  ) {
    if (subSegment) {
      return { to: "/product/$id", params: { id: subSegment } };
    }
    return { to: "/shop", search: searchParams };
  }

  // B. Categories / Collections prefix: /category/:slug or /collection/:slug
  if (
    rootSegment === "category" ||
    rootSegment === "categories" ||
    rootSegment === "collection" ||
    rootSegment === "collections" ||
    rootSegment === "c"
  ) {
    if (subSegment) {
      return { to: "/shop", search: { ...searchParams, category: subSegment } };
    }
    return { to: "/categories" };
  }

  // C. Admin tabs: /admin/:tab
  if (rootSegment === "admin" && subSegment) {
    return { to: "/admin", search: { ...searchParams, tab: subSegment.toLowerCase() } };
  }

  // D. Order tracking: /order/:id or /orders/:id or /track/:id
  if (rootSegment === "order" || rootSegment === "orders" || rootSegment === "track") {
    if (subSegment) {
      return { to: "/orders", search: { ...searchParams, orderId: subSegment } };
    }
    return { to: "/orders", search: searchParams };
  }

  // 5. Single segment category or search keyword
  if (segments.length === 1 && rootSegment) {
    const knownCategories = [
      "clothing",
      "clothes",
      "toys",
      "toy",
      "nursery",
      "nursery-care",
      "care",
      "gear",
      "travel-gear",
      "travel",
      "accessories",
      "feeding",
      "bath",
      "footwear",
      "shoes",
      "bedding",
      "gifting",
      "baby-care",
      "baby-clothes",
      "baby-toys",
      "strollers",
      "diapers",
      "rompers",
      "onesies",
    ];

    if (knownCategories.includes(rootSegment)) {
      let categorySlug = rootSegment;
      if (
        rootSegment === "clothes" ||
        rootSegment === "baby-clothes" ||
        rootSegment === "rompers" ||
        rootSegment === "onesies"
      ) {
        categorySlug = "clothing";
      } else if (rootSegment === "toy" || rootSegment === "baby-toys") {
        categorySlug = "toys";
      } else if (rootSegment === "nursery" || rootSegment === "care") {
        categorySlug = "nursery-care";
      } else if (rootSegment === "travel" || rootSegment === "strollers") {
        categorySlug = "travel-gear";
      } else if (rootSegment === "shoes") {
        categorySlug = "footwear";
      }
      return { to: "/shop", search: { ...searchParams, category: categorySlug } };
    }

    // If it's an unrecognized alphanumeric/hyphenated slug without file extension, route to search
    if (!rootSegment.includes(".")) {
      const searchTerm = rootSegment.replace(/[-_]+/g, " ").trim();
      if (searchTerm.length >= 2) {
        return { to: "/shop", search: { ...searchParams, q: searchTerm } };
      }
    }
  }

  return null;
}
