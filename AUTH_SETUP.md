# Staff & customer sign-in (Supabase Auth)

The storefront and `/admin` show only the sign-in methods that are switched on in
Supabase Auth. Email sign-in links work out of the box; Google needs the steps below.

## 1. Make yourself an owner

Set the owner list as an environment variable on the API host (Render: the service's
**Environment** tab), then let the service restart:

```
OWNER_EMAILS=tingjayj@gmail.com
# optional, comma separated: STAFF_EMAILS=helper1@example.com,helper2@example.com
```

The first time a listed email signs in, its profile is promoted automatically. Roles set by hand
are never downgraded. Without restarting, the Supabase SQL editor works too:

```sql
update public.profiles set role = 'owner' where email = 'tingjayj@gmail.com';
```

(The profile row exists after that email has signed in once.) Running locally with
`npm run dev:local` needs none of this: it has built-in `owner@spinhobby.test` and
`staff@spinhobby.test` accounts.

## 2. Allow redirects back to the site

Supabase Dashboard → Authentication → URL Configuration

- **Site URL:** `https://spinhobby.com`
- **Redirect URLs:** `https://spinhobby.com/**`, `https://www.spinhobby.com/**`, `http://localhost:5173/**`

Without these, sign-in links fall back to the Site URL instead of returning to `/admin`.

## 3. Turn on Google

1. Google Cloud Console → APIs & Services → **OAuth consent screen**: External, app name
   "Spin Hobby", support email, add `spinhobby.com` as an authorised domain. Publish it.
2. **Credentials → Create credentials → OAuth client ID** → Web application.
   - Authorised JavaScript origins: `https://spinhobby.com`
   - Authorised redirect URI: `https://zmlltsytckexrmybvnof.supabase.co/auth/v1/callback`
3. Supabase Dashboard → Authentication → **Providers → Google**: enable, paste the client ID
   and secret, save.

The "Continue with Google" button appears automatically once the provider is on.

## 4. (Optional) Discord

Same idea: create an app at discord.com/developers, add the redirect
`https://zmlltsytckexrmybvnof.supabase.co/auth/v1/callback`, then enable Discord under
Authentication → Providers.

## Email notes

Supabase's built-in mailer is rate-limited (a few emails per hour). For launch, add SMTP
under Authentication → SMTP Settings (the storefront already uses Resend for restock
emails, and Resend provides SMTP credentials).

## Password reset

"Forgot your password?" on the sign-in form calls `POST /auth/reset`, which asks Supabase Auth to
email a reset link. The link opens `/reset-password` on the storefront, signed in, where a new
password is chosen (`POST /auth/password`).

For the link to point at the real site rather than `localhost`, set these in the Supabase dashboard
under **Authentication > URL Configuration** (for each project: production and staging):

- **Site URL**: `https://spinhobby.com` (staging: `https://spin-hobby-staging.netlify.app`)
- **Redirect URLs**: `https://spinhobby.com/reset-password`, `https://www.spinhobby.com/reset-password`
  (staging: `https://spin-hobby-staging.netlify.app/reset-password`). Local development can add
  `http://localhost:5173/reset-password`.

If a link still lands on the home page, the storefront forwards it to `/reset-password` itself. Supabase's
built-in mailer allows only a few emails per hour; for anything beyond occasional use, configure custom SMTP
under **Authentication > Emails > SMTP Settings** (Resend works and the API already has a `RESEND_API_KEY`).
