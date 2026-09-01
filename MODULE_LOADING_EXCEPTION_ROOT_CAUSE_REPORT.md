# ZÉRAH BABY & KIDS — MODULE LOADING EXCEPTION ROOT CAUSE & PERMANENT REMEDIATION REPORT

**Application**: Zérah Baby & Kids (https://zerahkids.com)  
**Date**: September 02, 2026  
**Status**: RESOLVED & VERIFIED IN PRODUCTION BUILD

---

## 1. Executive Summary

When visiting `https://zerahkids.com/admin?tab=dashboard&subtab=pos`, the admin interface previously displayed a generic error box stating:
> *"Module Loading Exception / A temporary loading issue occurred in this component. Click below to refresh this section."*

A full investigation into TanStack Router route contextualization, dynamic lazy imports, error boundary boundaries, and unauthenticated redirects identified two interrelated root causes:

1. **Object Concatenation TypeError in `_authenticated/route.tsx` during Router Contextualization / Redirect Evaluation**:
   In TanStack Router v1, `location.search` is parsed as an object (`Record<string, unknown>`), not a string. Line 19 of `src/routes/_authenticated/route.tsx` performed string concatenation:
   ```ts
   // BEFORE (CRASH):
   const targetUrl = location.pathname + location.search;
   ```
   When search parameters were present (`?tab=dashboard&subtab=pos`), attempting to concatenate an object with a string threw `TypeError: Cannot convert object to primitive value`. This unhandled exception crashed TanStack Router's route evaluation before `beforeLoad` could complete cleanly.

2. **Generic Error Boundary & Unprotected Dynamic Lazy Imports**:
   - `ComponentErrorBoundary` previously caught all runtime exceptions and labeled them uniformly as "Module Loading Exception", hiding actual JavaScript errors and preventing intelligent recovery.
   - Dynamic `React.lazy()` imports were unprotected against post-deployment stale chunk 404s (e.g., when a new release replaces client chunk hashes).
   - In `admin.$.tsx`, empty splat matching on `/admin` could cause circular redirect loops if not guarded against empty path segments.
   - In `__root.tsx`, unhandled route errors triggered unconditional `window.location.reload()` timers that created redirect loops.

---

## 2. Root Cause Analysis

### Root Cause 1: `TypeError: Cannot convert object to primitive value` in `_authenticated/route.tsx`
- **Location**: `src/routes/_authenticated/route.tsx:19`
- **Trigger**: Opening `/admin?tab=dashboard&subtab=pos` when evaluating route context.
- **Mechanism**:
  - TanStack Router v1 provides `location.search` as a parsed parameter object.
  - Doing `location.pathname + location.search` coerced the object into a primitive string using `Object.prototype.toString`, which throws `TypeError` in strict object environments.
  - The thrown `TypeError` was caught by the root error boundary, initiating a failed redirect chain and displaying the loading exception.

### Root Cause 2: Stale Chunk Hashes & Unhandled `React.lazy` Rejections
- **Mechanism**:
  - When new Vite production builds are deployed, chunk hashes change (e.g. `DashboardTab-XXXX.js` $\rightarrow$ `DashboardTab-YYYY.js`).
  - If a user had an active session or cached HTML, dynamic imports for `DashboardTab` or sub-tabs rejected with `Failed to fetch dynamically imported module`.
  - `ComponentErrorBoundary` caught the rejection and rendered "Reload section", which simply re-triggered the cached rejected promise without reloading the updated manifest.

### Root Cause 3: Empty Splat Handling in `admin.$.tsx`
- When navigating to `/admin` directly, the splat route `admin.$.tsx` parsed `_splat` as `""`, but did not exit early, triggering a redundant redirect back to `/admin` with `tab=dashboard`.

---

## 3. Permanent Engineering Remediation

### 1. Robust Search String Extraction in Route Guards (`src/routes/_authenticated/route.tsx`)
Updated redirect target URL creation to extract string search representations safely without object coercion:
```ts
if (!session?.user) {
  const searchStr =
    location.searchStr ||
    (typeof location.search === "string"
      ? location.search
      : typeof window !== "undefined"
        ? window.location.search
        : "");
  const targetUrl =
    location.pathname +
    (searchStr ? (searchStr.startsWith("?") ? searchStr : `?${searchStr}`) : "");
  throw redirect({
    to: "/auth",
    search: targetUrl && targetUrl !== "/" ? { redirect: targetUrl } : undefined,
  });
}
```

### 2. Automated Single-Reload Chunk Recovery (`src/lib/safe-lazy.ts`)
Created `safeLazy` wrapper around `React.lazy()` with automated stale chunk recovery:
- Detects `ChunkLoadError`, `Failed to fetch dynamically imported module`, and related script fetch failures.
- Checks `sessionStorage` cooldown lock (`zerah_chunk_reload_lock`, 20s window) to ensure **at most ONE controlled reload** occurs.
- Completely prevents infinite reload loops.

### 3. Classified Error Boundary (`src/components/ui/ComponentErrorBoundary.tsx`)
Re-architected the error boundary to distinguish:
1. **App Update / Chunk Mismatch**: Prompts user to refresh for the latest release.
2. **Network / Connection Failures**: Prompts with "Connection Error" and a retry button.
3. **Session / Auth Failures**: Prompts with "Authentication Required".
4. **Render Errors**: Displays technical diagnostics with safe Retry and Return Home actions.

### 4. Splat Route Guarding (`src/routes/_authenticated/admin.$.tsx`)
Guarded against empty splats to prevent redundant internal redirect loops when accessing `/admin` directly.

### 5. Root Error Boundary Hardening (`src/routes/__root.tsx`)
Removed indiscriminate auto-reloads, ensuring that only verified chunk errors perform controlled reloads while route/network errors render clean recovery UI with "Try again" and "Return Home".

---

## 4. Verification Results

| Test / Check | Result | Details |
|---|---|---|
| `npx tsc --noEmit` | **PASS (0 errors)** | Complete static type check succeeded. |
| `npm run lint` | **PASS (0 errors)** | ESLint and Prettier rules passed cleanly. |
| `npm run build` | **PASS (0 errors)** | Production client & SSR bundles generated successfully. |
| Unauthenticated Deep-Link (`/admin?tab=dashboard&subtab=pos`) | **PASS** | Cleanly redirects to `/auth?redirect=...` with zero console errors or loops. |
| Authenticated Dashboard Load | **PASS** | Main Executive Dashboard & Offline Billing POS Terminal render with full charts, KPIs, and metrics. Zero exceptions. |
