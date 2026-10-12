# Staging

A full copy of the stack for testing before anything reaches spinhobby.com.

| | Production | Staging |
|---|---|---|
| Git branch (both repos) | `main` | `staging` |
| Storefront (Netlify) | https://spinhobby.com | https://spin-hobby-staging.netlify.app |
| API (Render) | https://spin-hobby-server.onrender.com | https://spin-hobby-server-staging.onrender.com |
| Database / auth / photos (Supabase) | project `zmlltsytckexrmybvnof` | its own project (`spin-hobby-staging`) |
| Payments | per Admin → Settings | sandbox only |

The staging site shows a yellow **STAGING** badge on every page, is kept out of search engines,
and never talks to the production API or database. Netlify pull-request previews also use the
staging API. The staging API allows those Netlify origins whenever `APP_ENV=staging`, so no
`ALLOWED_ORIGINS` entry is needed for them.

## Everyday workflow

```sh
git checkout staging && git merge main     # or merge your feature branch into staging
git push                                   # Netlify + Render deploy staging automatically
# test on https://staging--spinhobby.netlify.app
git checkout main && git merge staging && git push   # go live
```

Do this in both repos when a change touches both. Push the API first when the frontend depends
on a new API route.

## One-time setup

1. **Supabase**: create a new project named `spin-hobby-staging` (same organization as production;
   the free plan allows two active projects). Save the database password. Nothing else to do:
   the staging API creates the schema, storage bucket and policies on its first start.
   Optional: Authentication → URL Configuration → Site URL = `https://staging--spinhobby.netlify.app`.
2. **Render**: New → Blueprint → this repo, **Blueprint path `render.staging.yaml`**. Fill in the
   prompted values from the *staging* Supabase project:
   - `SUPABASE_URL`: `https://<staging-ref>.supabase.co`
   - `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SERVICE_ROLE_KEY`: Project Settings → API Keys
   - `DATABASE_URL`: Connect → Session pooler → URI (with the staging DB password)
   - PayPal / Square: sandbox credentials, or leave blank.

   If Render names the URL differently from `spin-hobby-server-staging.onrender.com`, update
   `VITE_API_URL` in the storefront's `netlify.toml`.
3. **Netlify**: Site configuration → Build & deploy → Branches and deploy contexts →
   Branch deploys → *Let me add individual branches* → `staging`.
4. **Check it**: `https://spin-hobby-server-staging.onrender.com/health` should say
   `"environment":"staging"` with every check `ok`.
5. **Sample data**: nothing to do. The first time the staging API starts against an empty catalog it
   loads the sample set from `src/modules/sample` (about 110 products across every category and status, with
   pictures the API draws itself at `/sample-images/...`, homepage banners and a month of orders).
   `SAMPLE_DATA=false` on the service turns this off. To reload after changing the sample data:
   ```sh
   STAGING_DATABASE_URL='<staging session pooler URI>' npm run seed:staging -- --replace
   ```
   It refuses to run against production.
6. **Sign in**: create an account on the staging site. `OWNER_EMAILS` makes you the owner there too.

## Admin sign-in on staging

Staging has a fixed owner login so anyone testing can open `/admin` without an account. On the
sign-in form, type the username in the email box:

| | |
|---|---|
| Username | `SpinHobby` |
| Password | ask the owner (it is in the Render service's Environment tab) |

The username is set by `STAGING_ADMIN_USERNAME` in `render.staging.yaml`. The password,
`STAGING_ADMIN_PASSWORD`, is only ever set in the service's Environment tab on Render, never in git. The first sign-in creates a real owner account in the
staging Supabase project (`spinhobby@staging.spinhobby.com`, no email is ever sent), so sessions,
refresh and sign-out behave like any other account. Changing the password in the environment
updates the account on the next sign-in.

The login only works when `APP_ENV=staging`, and never against the production Supabase project,
so these variables have no effect if they are ever copied to production. Leaving
`STAGING_ADMIN_PASSWORD` empty turns the login off.

Free-plan notes: the staging API sleeps after ~15 minutes idle (first request takes ~1 minute),
and Supabase pauses a free project after a week without activity (restore it from the dashboard).
