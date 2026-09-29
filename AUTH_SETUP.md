# Staff & customer sign-in (Supabase Auth)

The storefront and `/admin` show only the sign-in methods that are switched on in
Supabase Auth. Email sign-in links work out of the box; Google needs the steps below.

## 1. Make yourself an owner

Set the owner list as an edge-function secret, then redeploy `store-api`:

```sh
supabase secrets set OWNER_EMAILS="tingjayj@gmail.com" --project-ref zmlltsytckexrmybvnof
# optional: STAFF_EMAILS="helper1@example.com,helper2@example.com"
supabase functions deploy store-api --project-ref zmlltsytckexrmybvnof
```

Running the NestJS server instead? Set `OWNER_EMAILS` (and `STAFF_EMAILS`) in that host's
environment — it applies the same rule.

The first time a listed email signs in, its profile is promoted automatically.
Roles set by hand are never downgraded. Without redeploying, the SQL editor works too:

```sql
update public.profiles set role = 'owner' where email = 'tingjayj@gmail.com';
```

(The profile row exists after that email has signed in once.)

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
