# Staging

A full copy of the stack for testing before anything reaches spinhobby.com.

| | Production | Staging |
|---|---|---|
| Git branch (both repos) | `main` | `staging` |
| Storefront (Netlify) | https://spinhobby.com | https://staging--spinhobby.netlify.app |
| API (Render) | https://spin-hobby-server.onrender.com | https://spin-hobby-api-staging.onrender.com |
| Database / auth / photos (Supabase) | project `zmlltsytckexrmybvnof` | its own project (`spin-hobby-staging`) |
| Payments | per Admin → Settings | sandbox only |

The staging site shows a yellow **STAGING** badge on every page, is kept out of search engines,
and never talks to the production API or database. Netlify pull-request previews also use the
staging API.

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

   If Render names the URL differently from `spin-hobby-api-staging.onrender.com`, update
   `VITE_API_URL` in the storefront's `netlify.toml`.
3. **Netlify**: Site configuration → Build & deploy → Branches and deploy contexts →
   Branch deploys → *Let me add individual branches* → `staging`.
4. **Check it**: `https://spin-hobby-api-staging.onrender.com/health` should say
   `"environment":"staging"` with every check `ok`.
5. **Sample data** (optional): load ~17 products, a category tree and a few orders:
   ```sh
   STAGING_DATABASE_URL='<staging session pooler URI>' npm run seed:staging
   ```
   It refuses to run against production or a database that already has products.
6. **Sign in**: create an account on the staging site. `OWNER_EMAILS` makes you the owner there too.

Free-plan notes: the staging API sleeps after ~15 minutes idle (first request takes ~1 minute),
and Supabase pauses a free project after a week without activity (restore it from the dashboard).
