## What and why

<!-- One or two sentences: what changes, and what problem it solves. -->

## How I checked it

<!-- e.g. new/updated tests, or what you clicked through in `npm run dev:local`. -->

## Checklist

- [ ] `npm run typecheck && npm run lint && npm run format:check && npm test && npm run test:e2e` pass locally
- [ ] New or changed endpoints have a DTO, a test, and an `@Access(...)` level
- [ ] No SQL or business logic in a controller (it belongs in the service)
- [ ] No new `process.env` / `env()` reads outside `src/config`
- [ ] Database changes are a new migration in `supabase/migrations`, never an edit to an old one
- [ ] Docs updated if behaviour or setup changed
