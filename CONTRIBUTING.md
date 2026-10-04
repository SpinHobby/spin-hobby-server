# Contributing

How we work on this repo. It's short on purpose.

## The flow

```
your branch ──► pull request into `staging` ──► test on the staging site ──► merge `staging` into `main`
```

- **`main` is production**: real customers and real money. Nobody pushes to it directly.
- **`staging`** auto-deploys to the staging site (fake payments, sample data) so we can test there first.
- Anything you push to a branch is visible to the team. Anything merged into `staging` or `main`
  is **deployed automatically**.

### Step by step

1. **Start from the latest `staging`:**
   ```sh
   git checkout staging && git pull
   git checkout -b your-name/short-description     # e.g. aki/order-counts-endpoint
   ```
2. **Make a small change.** One pull request should do one thing. Small changes get reviewed fast.
3. **Check it** (see below) and try it in `npm run dev:local`.
4. **Commit** with a message that says what the change does (see below).
5. **Push and open a pull request into `staging`.** Fill in the template: what changed, how you
   checked it, and the checklist.
6. **Ask for a review.** Reply to every comment, push fixes as new commits.
7. After it's merged, open the staging site and check your change works there.
8. Someone with release rights merges `staging` into `main` when staging looks good.

## Before you push

Run this. Your pull request must pass the same checks in CI (GitHub runs them automatically):

```sh
npm run format
npm run typecheck && npm run lint && npm run format:check && npm test && npm run test:e2e
```

Run `npm run format` twice if it changed files the first time. If a check fails, fix it
before asking for review. Don't skip or disable checks.

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

## Where to read more

- How the code is organised: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Build an endpoint step by step: [`docs/ADD-AN-ENDPOINT.md`](docs/ADD-AN-ENDPOINT.md)
- The staging site: [`STAGING.md`](STAGING.md)
