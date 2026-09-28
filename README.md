# Spin Hobby Supabase backend

This repository contains the Supabase backend for the Spin Hobby storefront and staff admin handoffs.

## What is included

- A PostgreSQL schema for Square catalog snapshots, product metadata, inventory, storefront content, customers, orders, alerts, and audit records.
- Supabase Auth profiles with customer, staff, and owner roles.
- RLS and explicit API grants for every customer-facing table.
- `store-api`, an Edge Function that supplies catalog, wishlist, alert, quote, checkout, order, and admin routes.
- `square-sync`, an owner-only Edge Function that mirrors Square catalog and stock records into Supabase.

Square remains the source of truth for catalog and inventory. Supabase stores the queryable mirror and Spin Hobby-specific merchandising details, so storefront filters, badges, rankings, and the admin panel do not depend on live Square calls.

## Route mapping

The existing clients can use the Edge Function base URL as their API origin:

`https://<project-ref>.supabase.co/functions/v1/store-api`

| Existing route | Edge Function route |
| --- | --- |
| `/api/products` | `/functions/v1/store-api/products` |
| `/api/products/facets` | `/functions/v1/store-api/products/facets` |
| `/api/products/preorders` | `/functions/v1/store-api/products/preorders` |
| `/api/homepage` | `/functions/v1/store-api/homepage` |
| `/api/wishlist` | `/functions/v1/store-api/wishlist` |
| `/api/alerts` | `/functions/v1/store-api/alerts` |
| `/api/cart/quote` | `/functions/v1/store-api/cart/quote` |
| `/api/checkout/intent` | `/functions/v1/store-api/checkout/intent` |
| `/api/admin/*` | `/functions/v1/store-api/admin/*` |

The function accepts an optional Supabase bearer token. Public catalog, alerts, cart quotes, guest orders, payment callbacks, and payment webhooks are deliberate unauthenticated routes; each request is authorized inside the function where required.

## Deployment sequence

1. Create a Supabase project and apply the migration.
2. Configure Google and Discord providers in Supabase Auth, with the storefront and admin callback URLs.
3. Set the Edge Function secrets from `.env.example`.
4. Deploy `store-api` and `square-sync`.
5. Promote the first profile to `owner` in the dashboard SQL editor.
6. Run a Square sync. Configure its inventory/catalog webhooks to call `store-api/webhooks/square`.
7. Set the checkout provider in Admin Settings, then configure PayPal or Square secret values and complete their sandbox checkout.

## Important operational notes

- The migration seeds current Canadian GST/HST and PST rates. US rates deliberately start at zero because collection depends on the store's nexus and registration status. Set them in Admin Settings only after confirming the policy with an accountant.
- The payment function never accepts browser-supplied prices. It recalculates products, inventory, purchase limits, shipping, and tax from Supabase on every quote and checkout request.
- `SQUARE_ACCESS_TOKEN`, payment secrets, and Supabase service/secret keys are Edge Function secrets. They never belong in a Vite environment variable.
