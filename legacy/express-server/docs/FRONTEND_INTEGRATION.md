# Frontend integration

The existing Storefront and Admin API clients can retain their `/api` method and route shapes. Point their API base at the Supabase Edge Function:

```ts
const API_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/store-api`;
```

For endpoints that use a session, obtain the access token from the Supabase client and pass it through. The Edge Function reads that token to authorize wishlist, orders, and staff actions.

```ts
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);

export async function api(path: string, init: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`);
  const result = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const body = await result.json();
  if (!result.ok || body.success === false) throw new Error(body.error ?? 'Request failed.');
  return body;
}
```

For example:

```ts
const catalog = await api('/products?category=Figures&status=in,pre&sort=release');
const quote = await api('/cart/quote', {
  method: 'POST',
  body: JSON.stringify({
    items: [{ variationId, quantity: 1 }],
    shippingMethod: 'standard',
    country: 'CA',
    province: 'AB',
  }),
});
```

## Authentication

Replace the former server session calls with Supabase Auth. Google and Discord are configured as providers in the Supabase dashboard. The frontend starts the provider flow directly:

```ts
await supabase.auth.signInWithOAuth({
  provider: 'google', // or 'discord'
  options: { redirectTo: `${window.location.origin}/auth/callback` },
});
```

`/auth/me` and `/auth/logout` remain available in `store-api` for compatibility. Customer, staff, and owner permissions come from `public.profiles.role`, never user-editable auth metadata.

## Checkout

1. Call `/cart/quote` every time cart quantities or the shipping address changes.
2. Call `/checkout/intent` with the quote input, email, billing, and shipping address.
3. For PayPal, hand `paypalOrderId` to the PayPal client SDK and call `/paypal/capture` after approval.
4. For Square, tokenize with the Square Web Payments SDK and send `orderId`, `email`, `sourceId`, and the optional buyer verification token to `/square/payments`.

The server recomputes every price and validates availability before it creates the payment request. Do not use product prices or totals stored in Redux as payment amounts.

## Deploy-time configuration

`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are the only Supabase values in browser code. Add all other values from `.env.example` to Edge Function secrets. The admin needs its first owner assigned after their initial login:

```sql
update public.profiles
set role = 'owner'
where email = 'your-owner-email@example.com';
```

The migration intentionally leaves US tax rates disabled. Configure them in Admin Settings after confirming the store's collection obligations.
