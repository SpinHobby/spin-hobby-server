# Contributing

How we work on this repo. It's short on purpose.

## The flow

```
your branch ──► pull request into `staging` ──► test on the staging site ──► merge `staging` into `production`
```

- **`production` is the live site**: real customers and real money. Only the owner merges into it, and the owner
  deploys it by hand (see [Releasing](#releasing-to-the-live-site-owner-only)).
- **`staging`** deploys automatically to the staging site (fake payments, sample data), so merged work can be tried there.
- Anything you push to a branch is visible to the team.

### Step by step

1. **Start from the latest `staging`:**
   ```sh
   git checkout staging && git pull
   git checkout -b your-name/short-description     # e.g. aki/order-counts-endpoint
   ```
2. **Make a small change.** One pull request should do one thing. Small changes get reviewed fast.
3. **Check it** (see below) and try it in `npm run dev:local`.
4. **Commit** with a message that says what the change does (see below).
5. **Push your branch and open a pull request into `staging`:**
   ```sh
   git push -u origin your-name/short-description
   ```
   GitHub then shows a **Compare & pull request** button. Check the base is **`staging`** (it is by default), and fill in
   the template: what changed, how you checked it, and the checklist.
6. **Ask for a review.** Reply to every comment and push fixes to the same branch: the pull request updates itself.
7. **The owner merges it** into `staging`. Don't merge your own pull request, even though GitHub shows you the button.
8. After it's merged, open the staging site and check your change works there, then delete your branch (GitHub offers a
   button on the pull request).
9. The owner releases `staging` to the live site when it looks good.

If `staging` moved on while you worked and GitHub reports conflicts:

```sh
git fetch origin
git merge origin/staging     # fix the conflicts, commit
git push                     # the pull request updates
```

## Branches: what you may and may not do

You can push to this repo, so these rules are what keep everyone's work safe:

- **Do** work on your own branch (`your-name/...`), push it as often as you like, and open pull requests into `staging`.
- **Never** push, merge or open a pull request into **`production`**.
- **Never** push directly to **`staging`**: changes reach it only through a reviewed pull request.
- **Never** force-push (`git push --force`) to `staging`, `production` or anyone else's branch. It deletes other
  people's work. On your own branch it is fine.
- **Never** delete a branch that isn't yours.
- Made a mistake on one of these? Say so straight away. It is easy to put right when we know quickly.

## Before you push

Run this. Your pull request must pass the same checks in CI (GitHub runs them automatically):

```sh
npm run format
npm run typecheck && npm run lint && npm run format:check && npm test && npm run test:e2e
```

Run `npm run format` twice if it changed files the first time. If a check fails, fix it
before asking for review. Don't skip or disable checks.

### The pre-commit check

`npm install` also switches on a small check that runs every time you `git commit`. It lints and format-checks
just the files you are committing, and stops the commit with a message if something is off. Fix it with
`npm run lint:fix && npm run format`, `git add` the files, and commit again. (CI still runs the full set.)

If you use VS Code, open the folder and accept the suggested extensions (ESLint, Prettier). Files then format
and fix themselves when you save, using the settings in `.vscode/`.

## Commit messages

Write one short line in the present tense that says what the commit does, starting with a capital:

```
Add order counts to the ops page
Fix refund total when an order has a shipping charge
Split the checkout tests into smaller files
```

If the reason isn't obvious, add a blank line and a few sentences explaining *why*. Don't put
secrets, passwords or API keys in a commit or a message.

## Pull request checklist

The template asks for these. In short:

- [ ] Typecheck, lint, format check, unit and e2e tests pass.
- [ ] A new or changed endpoint has a **DTO**, a **test**, and an **`@Access(...)`** level.
- [ ] No SQL or business rules in a controller.
- [ ] A long (15+ lines) or reused query is in the feature's `*.sql.ts` file; short ones stay in the service.
- [ ] No `process.env` reads outside `src/config`.
- [ ] Database changes are a **new migration file**, never an edit to an old one.
- [ ] If you changed a route on purpose, you updated `test/e2e/routes.e2e-spec.ts`.
- [ ] Docs are updated if behaviour or setup changed (README, `docs/`, `.env.example`).

## Things that need extra care

Ask for a second pair of eyes before changing any of these. They involve money or can't be undone:

- **Payments and refunds** (`modules/payments`, `modules/checkout`, `integrations/paypal`, `integrations/square`)
- **Prices, tax and shipping** (`modules/orders/quote.service.ts`, `quote-math.ts`)
- **Stock and holds** (`modules/orders`, `modules/square-sync`)
- **Database migrations** (`supabase/migrations`): they run on real data when the server starts
- **Who may do what** (`@Access(...)` levels, `modules/auth`)

## Rules that never bend

- **Never edit an existing migration.** Add a new one.
- **Never commit real secrets.** Keys go in `.env` (git ignores it) and in Render's environment page.
  Use obviously fake values in tests.
- **Don't change a response's shape casually.** The website reads it. Add fields rather than
  renaming or removing them, and mention it in the pull request.
- **Keep production safe.** Never point `DATABASE_URL` in your `.env` at the production database.
  `npm run dev:local` needs no database settings at all.

## Style (the tools do it for you)

- Formatting is automatic: `npm run format`. Don't argue about it in reviews.
- Lint rules catch real bugs (a missing `await`, an `any`, a stray `console.log`).
- Names: files are `kebab-case` with a role suffix (`ops.service.ts`, `order-counts.query.ts`),
  classes are `PascalCase`, functions and variables are `camelCase`.
- Comments explain **why**, not what. A `/** comment */` above a class, method or DTO field is
  welcome: DTO comments become the descriptions on the `/docs` page.

## Releasing to the live site (owner only)

The live site never updates by itself: Netlify and Render are set to deploy `production` only when the owner presses
deploy, so a mistaken push to `production` changes nothing for customers.

**One-time setup:**

- Netlify (website): **Deploys → Stop auto publishing**. New production builds still run but wait, unpublished.
- Render (the live API, the service at `spin-hobby-server.onrender.com`): **Settings → Auto-Deploy → Off**. Staging keeps deploying automatically.
- GitHub: interns get the **Write** role on both repos (Settings → Collaborators and teams).

**Each release** (the server first when it changed, because the website depends on it):

1. Check the change on the staging site.
2. Move `staging` onto `production` and check GitHub has what you expect:
   ```sh
   git switch production && git pull
   git merge origin/staging
   git push origin production
   git fetch && git log origin/production -1      # the commit you meant to release
   ```
3. Server: Render → the live API service → **Manual Deploy → Deploy latest commit**. When it says Live, open
   `https://spin-hobby-server.onrender.com/health`.
4. Website: the same steps in `spin-hobby`, then Netlify → **Deploys** → the newest production deploy → **Publish deploy**.
5. Open the live site and try what changed.

**If something is wrong:**

- *Someone pushed to `production` by mistake* (nothing went live): put your good copy back,
  `git push --force origin <good-commit>:production`, then tell them.
- *A release broke the live site:* Netlify → **Deploys** → the previous deploy → **Publish deploy**; Render → **Events** →
  the previous deploy → **Rollback**. Then fix it on `staging` as usual.

## Where to read more

- How the code is organised: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Build an endpoint step by step: [`docs/ADD-AN-ENDPOINT.md`](docs/ADD-AN-ENDPOINT.md)
- The staging site: [`STAGING.md`](STAGING.md)
