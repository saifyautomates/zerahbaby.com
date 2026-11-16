import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function safeLower(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val).trim().toLowerCase();
}

export function safeUpper(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val).trim().toUpperCase();
}

