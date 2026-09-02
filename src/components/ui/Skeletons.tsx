/**
 * Skeletons — Comprehensive, structure-matching Skeleton Design System for Zérah Baby & Kids.
 *
 * Implements zero-CLS, theme-aware shimmer skeletons for every screen:
 * - Product Cards & Grids (Shop & Homepage)
 * - Product Detail Page (Gallery, Variants, Prices, CTAs)
 * - Cart & Bag (Items list + Summary Box)
 * - Wishlist (Saved items + Quick Actions)
 * - Orders & Order Tracking (Order Cards, Invoices, Status Badges)
 * - User Profile & Address Manager
 * - Admin Dashboard (KPIs, Charts, Live Activity, Watchlist)
 * - POS Terminal & Billing Hub
 * - Admin Tables (Products, Orders, Customers, Coupons, Reviews, SMS)
 */
import React from "react";

/** Core Base Skeleton Atom */
export function Skeleton({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`animate-pulse rounded-xl bg-muted/60 dark:bg-muted/40 ${className}`}
      style={style}
      aria-hidden="true"
    />
  );
}

/** 1. Product Card Skeleton */
export function ProductCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-3xl border border-border/60 bg-card p-3 shadow-2xs">
      {/* Image box with identical aspect-square */}
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-muted/50 animate-pulse">
        <div className="absolute top-2.5 left-2.5 h-4 w-12 rounded-full bg-muted/80" />
        <div className="absolute top-2.5 right-2.5 size-7 rounded-full bg-muted/80" />
      </div>

      {/* Product info lines */}
      <div className="mt-3.5 flex flex-col space-y-2 px-1 pb-1 flex-1 justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-5/6" />
        </div>

        <div className="pt-2 flex items-center justify-between gap-2 border-t border-border/40">
          <div className="space-y-1">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-2.5 w-12" />
          </div>
          <Skeleton className="h-8 w-20 rounded-full" />
        </div>
      </div>
    </div>
  );
}

/** Product Grid Skeleton (Shop & Home) */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** 2. Product Detail Skeleton */
export function ProductDetailSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:py-12">
      {/* Breadcrumb skeleton */}
      <div className="mb-6 flex items-center gap-2">
        <Skeleton className="h-3.5 w-12" />
        <span className="text-muted-foreground/40">/</span>
        <Skeleton className="h-3.5 w-20" />
        <span className="text-muted-foreground/40">/</span>
        <Skeleton className="h-3.5 w-32" />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-12">
        {/* Left Column: Gallery */}
        <div className="lg:col-span-7 flex flex-col-reverse md:flex-row gap-4">
          {/* Vertical Thumbnail Strip */}
          <div className="flex md:flex-col gap-3 overflow-x-auto shrink-0">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="size-16 sm:size-20 rounded-2xl shrink-0" />
            ))}
          </div>

          {/* Main Hero Image Box */}
          <div className="flex-1 aspect-square rounded-3xl border border-border/60 bg-muted/40 animate-pulse overflow-hidden p-6 flex items-center justify-center">
            <div className="size-24 rounded-full bg-muted/80" />
          </div>
        </div>

        {/* Right Column: Details & Actions */}
        <div className="lg:col-span-5 flex flex-col space-y-5">
          {/* Brand & Title */}
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-7 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>

          {/* Ratings & Reviews */}
          <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-4 w-28" />
          </div>

          {/* Price & MRP */}
          <div className="flex items-baseline gap-3 pt-2">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>

          {/* Color Selector */}
          <div className="space-y-2 pt-2">
            <Skeleton className="h-4 w-20" />
            <div className="flex gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="size-8 rounded-full" />
              ))}
            </div>
          </div>

          {/* Size Selector */}
          <div className="space-y-2 pt-2">
            <Skeleton className="h-4 w-20" />
            <div className="flex gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-16 rounded-xl" />
              ))}
            </div>
          </div>

          {/* Quantity & CTA Buttons */}
          <div className="space-y-3 pt-4 border-t border-border/60">
            <div className="flex gap-3">
              <Skeleton className="h-12 w-28 rounded-2xl" />
              <Skeleton className="h-12 flex-1 rounded-2xl" />
            </div>
            <Skeleton className="h-12 w-full rounded-2xl" />
          </div>

          {/* Delivery & Assurance Box */}
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

/** 3. Cart Page Skeleton */
export function CartPageSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 pb-32 sm:pb-10">
      <Skeleton className="h-8 w-40 mb-8" />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Cart items list */}
        <div className="lg:col-span-8 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 rounded-3xl border border-border/60 bg-card p-4 shadow-2xs"
            >
              <Skeleton className="size-20 sm:size-24 rounded-2xl shrink-0" />
              <div className="flex-1 min-w-0 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-5 w-20" />
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <Skeleton className="h-8 w-24 rounded-xl" />
                <Skeleton className="size-8 rounded-xl" />
              </div>
            </div>
          ))}
        </div>

        {/* Order Summary Box */}
        <div className="lg:col-span-4">
          <div className="rounded-3xl border border-border/60 bg-card p-6 shadow-2xs space-y-4">
            <Skeleton className="h-5 w-32" />
            <div className="space-y-2 pt-2 border-t border-border/60">
              <div className="flex justify-between">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-16" />
              </div>
              <div className="flex justify-between">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-16" />
              </div>
              <div className="flex justify-between">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-16" />
              </div>
            </div>
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-2xl" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** 4. Wishlist Skeleton */
export function WishlistSkeleton() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <Skeleton className="h-8 w-44 mb-2" />
      <Skeleton className="h-4 w-28 mb-8" />

      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 rounded-2xl border border-border/60 bg-card p-4 shadow-2xs"
          >
            <Skeleton className="size-20 sm:size-24 rounded-xl shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-5 w-24" />
              <div className="flex gap-2 pt-1">
                <Skeleton className="h-8 w-28 rounded-full" />
                <Skeleton className="size-8 rounded-full" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 5. Orders Page Skeleton */
export function OrdersSkeleton() {
  return (
    <div className="container mx-auto max-w-4xl px-4 py-10">
      <div className="flex items-center justify-between mb-8">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>

      <div className="space-y-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-3xl border border-border/60 bg-card p-6 shadow-2xs space-y-4"
          >
            {/* Header: ID, Date, Status */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
              <div className="space-y-1">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>

            {/* Items */}
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, j) => (
                <div key={j} className="flex items-center gap-3">
                  <Skeleton className="size-14 rounded-xl shrink-0" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-4 w-3/5" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-border/60">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-8 w-28 rounded-xl" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 6. Profile Page Skeleton */
export function ProfileSkeleton() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      {/* Avatar & Header */}
      <div className="flex items-center justify-between border-b border-border/60 pb-6">
        <div className="space-y-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="size-20 sm:size-24 rounded-full shrink-0" />
      </div>

      {/* Form Fields Grid */}
      <div className="rounded-3xl border border-border/60 bg-card p-6 shadow-2xs space-y-4">
        <Skeleton className="h-5 w-32 mb-2" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Skeleton className="h-11 w-full rounded-xl" />
          <Skeleton className="h-11 w-full rounded-xl" />
          <Skeleton className="h-11 w-full rounded-xl sm:col-span-2" />
          <Skeleton className="h-11 w-full rounded-xl" />
          <Skeleton className="h-11 w-full rounded-xl" />
          <Skeleton className="h-11 w-full rounded-xl sm:col-span-2" />
        </div>
        <Skeleton className="h-11 w-32 rounded-xl mt-4" />
      </div>
    </div>
  );
}

/** 7. Admin Dashboard Skeleton */
export function AdminDashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Top Header bar with Date Range */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="space-y-1">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-3.5 w-64" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-32 rounded-xl" />
          <Skeleton className="h-9 w-28 rounded-xl" />
        </div>
      </div>

      {/* 4 KPI Metric Cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-3xl border border-border/60 bg-card p-4 sm:p-5 shadow-2xs space-y-3"
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="size-8 rounded-xl" />
            </div>
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>

      {/* Main Chart Box */}
      <div className="rounded-3xl border border-border/60 bg-card p-6 shadow-2xs space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-48 rounded-xl" />
        </div>
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>

      {/* Bottom 2-Col: Recent Activity & Low Stock */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-border/60 bg-card p-6 shadow-2xs space-y-3">
          <Skeleton className="h-5 w-36 mb-4" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-2 border-b border-border/40"
            >
              <div className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-xl" />
                <div className="space-y-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-2.5 w-20" />
                </div>
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>

        <div className="rounded-3xl border border-border/60 bg-card p-6 shadow-2xs space-y-3">
          <Skeleton className="h-5 w-36 mb-4" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-2 border-b border-border/40"
            >
              <div className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-xl" />
                <div className="space-y-1">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-2.5 w-24" />
                </div>
              </div>
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 8. POS Terminal Skeleton */
export function POSTerminalSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 h-full">
      {/* Left 8-col: Scanner & Products */}
      <div className="lg:col-span-8 flex flex-col space-y-4">
        {/* Scanner Bar */}
        <Skeleton className="h-12 w-full rounded-2xl" />

        {/* Category Filter Pills */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-full shrink-0" />
          ))}
        </div>

        {/* Product Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 flex-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col rounded-2xl border border-border/60 bg-card p-3 shadow-2xs space-y-2"
            >
              <Skeleton className="aspect-square w-full rounded-xl" />
              <Skeleton className="h-3.5 w-4/5" />
              <div className="flex justify-between items-center pt-1">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-3 w-10" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right 4-col: Cart Column */}
      <div className="lg:col-span-4">
        <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-2xs space-y-4 h-full flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
            <Skeleton className="h-10 w-full rounded-xl" />
            <div className="space-y-2 pt-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between py-2">
                  <div className="space-y-1">
                    <Skeleton className="h-3.5 w-28" />
                    <Skeleton className="h-2.5 w-16" />
                  </div>
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3 pt-4 border-t border-border/60">
            <div className="flex justify-between">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="flex justify-between">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-6 w-24" />
            </div>
            <Skeleton className="h-12 w-full rounded-2xl" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** 9. Admin Table Skeleton (Products, Orders, Customers, Coupons, etc.) */
export function AdminTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="rounded-3xl border border-border/60 bg-card shadow-2xs overflow-hidden space-y-4 p-5">
      {/* Search & Filter Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <div className="flex gap-2">
          <Skeleton className="h-10 w-28 rounded-xl" />
          <Skeleton className="h-10 w-28 rounded-xl" />
        </div>
      </div>

      {/* Table rows */}
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between p-3 rounded-2xl bg-muted/20 border border-border/40"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-xl shrink-0" />
              <div className="space-y-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="size-8 rounded-xl" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 10. Admin Customer Hub Skeleton */
export function AdminCustomerHubSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-3xl border border-border/60 bg-card p-4 shadow-2xs space-y-2"
          >
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-32" />
          </div>
        ))}
      </div>
      <AdminTableSkeleton rows={7} />
    </div>
  );
}
