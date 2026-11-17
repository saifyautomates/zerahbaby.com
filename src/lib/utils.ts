import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Bulletproof string helpers that safely handle null, undefined, numbers, or objects
 * without throwing "toLowerCase is not a function" exceptions.
 */
export function safeLower(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "string") return val.toLowerCase().trim();
  if (typeof val === "number" || typeof val === "boolean") return String(val).toLowerCase().trim();
  if (typeof val === "object") {
    try {
      return JSON.stringify(val).toLowerCase();
    } catch {
      return "";
    }
  }
  return String(val).toLowerCase().trim();
}

export function safeUpper(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "string") return val.toUpperCase().trim();
  if (typeof val === "number" || typeof val === "boolean") return String(val).toUpperCase().trim();
  if (typeof val === "object") {
    try {
      return JSON.stringify(val).toUpperCase();
    } catch {
      return "";
    }
  }
  return String(val).toUpperCase().trim();
}

