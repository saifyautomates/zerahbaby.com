# ZÉRAH BABY & KIDS — Repository Guidelines & Architecture

## Overview

This repository contains the complete production full-stack application for **Zérah Baby & Kids** (https://zerahkids.com).

### Core Stack

- **Framework**: TanStack Start / React 19 / TypeScript / Vite / Tailwind CSS v4
- **Backend & Database**: Supabase (PostgreSQL with RLS, Security Definer RPCs, Edge Functions)
- **State Management**: TanStack React Query + LocalStorage for offline POS / cart resiliency
- **Payments**: Razorpay (HMAC verified, webhook driven)
- **Logistics**: ShipRocket API integration

## Production Guidelines

1. **Branch Protection**: Keep `main` branch always buildable, fully type-checked (`tsc --noEmit`), and production-ready.
2. **Database Migrations**: Add all schema changes as forward SQL migrations under `supabase/migrations/`.
3. **Data Integrity**: Financial totals, shipping thresholds, and coupons must always be strictly verified server-side through canonical RPCs (`place_order`, `place_offline_sale`).
