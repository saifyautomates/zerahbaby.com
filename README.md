# Zérah Baby & Kids

Official full-stack e-commerce and POS platform for **Zérah Baby & Kids** (Kota, Rajasthan, India).

## 🚀 Features

- **Storefront**: Mobile-first, responsive customer catalog, search, wishlist, coupons, and secure checkout.
- **Unified POS**: In-store billing, hardware barcode scanner support, A4 & 80mm thermal receipts, offline synchronization with conflict resolution.
- **Backend & Database**: Supabase PostgreSQL with Row Level Security (RLS) & server-side validation RPCs.
- **Payments**: Razorpay gateway integration with webhook signatures & server-side integrity checks.
- **Logistics & Notifications**: ShipRocket shipping rate calculator & transactional SMS via MSG91.

## 🛠️ Development

```sh
# Install dependencies
npm install

# Start local dev server
npm run dev

# Run type check
npx tsc --noEmit

# Production build
npm run build
```
