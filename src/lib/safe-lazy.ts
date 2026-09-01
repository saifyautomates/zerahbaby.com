import { lazy, type ComponentType, type LazyExoticComponent } from "react";

const RELOAD_FLAG_KEY = "zerah_chunk_reload_lock";
const RELOAD_TIMEOUT_MS = 20_000; // 20 seconds cooldown to prevent any reload loops

/**
 * Detects whether an error is caused by a failed dynamic module / chunk fetch,
 * which typically occurs when a new production deployment replaces JS chunk hashes.
 */
export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const message =
    typeof err === "string"
      ? err
      : err instanceof Error
        ? `${err.name}: ${err.message} ${err.stack || ""}`
        : String(err);

  const lower = message.toLowerCase();
  return (
    lower.includes("chunkloaderror") ||
    lower.includes("failed to fetch dynamically imported module") ||
    lower.includes("importing a module script failed") ||
    lower.includes("error loading dynamically imported module") ||
    lower.includes("failed to load module script") ||
    lower.includes("unable to preload css") ||
    lower.includes("loading chunk") ||
    lower.includes("dynamically imported module")
  );
}

/**
 * Wraps dynamic React.lazy imports with automated deployment chunk recovery.
 * If a chunk fails to load due to a stale client asset hash, it triggers at most
 * ONE controlled full-page refresh to fetch the latest manifest, without ever infinite-looping.
 */
export function safeLazy<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T } | T>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const module = await factory();
      return "default" in module ? module : { default: module };
    } catch (err: unknown) {
      if (typeof window !== "undefined" && isChunkLoadError(err)) {
        const lastReload = sessionStorage.getItem(RELOAD_FLAG_KEY);
        const now = Date.now();

        if (!lastReload || now - Number(lastReload) > RELOAD_TIMEOUT_MS) {
          sessionStorage.setItem(RELOAD_FLAG_KEY, String(now));
          console.warn(
            "[safeLazy] Detected stale chunk hash. Refreshing page for latest release...",
          );
          window.location.reload();
          // Return an unresolved promise while the page reloads
          return new Promise<{ default: T }>(() => {});
        }
      }

      console.error("[safeLazy] Module failed to load:", err);
      throw err;
    }
  });
}
