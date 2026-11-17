# Email

Every email the shop sends goes through `EmailService.send()` (`src/integrations/email/email.service.ts`). This includes:

- order confirmations;
- shipped and refund notices;
- sign-up codes;
- restock alerts;
- cart reminders;
- pre-order news.

Where it goes depends on `MAIL_TRANSPORT`:

| Where          | Setting                                                    | What happens                                                                 |
| -------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Your computer  | `npm run dev:local` sets `MAIL_TRANSPORT=mailpit` for you  | Emails land in Mailpit, a pretend inbox at http://localhost:8025. Nothing leaves the machine. |
| Staging        | `RESEND_API_KEY`, `FROM_EMAIL`, `STOREFRONT_URL`           | Real email to everyone who signs up or orders there (testers use their real email). |
| Production     | `RESEND_API_KEY`, `FROM_EMAIL`                             | Real email to customers.                                                    |
| Anywhere       | `MAIL_TRANSPORT=off`, or no Resend key                     | Nothing is sent. Sign-up codes are printed in the server log, except in production. |

## On your computer: Mailpit (free)

1. Install it once:
   - Mac: `brew install mailpit`
   - Windows or Linux: see https://mailpit.axllent.org/docs/install/
2. Run `npm run dev:local` as usual. It starts Mailpit with the API (or uses one that's already running). The start-up message shows `Emails: http://localhost:8025`.
3. Open that address and you'll see every email: the sign-up code, an order confirmation after a test checkout, and the rest.

Even with a Resend key in `.env`, a local run never sends real email. Without Mailpit, emails are not delivered and sign-up codes are printed in the server window instead.

## Staging: real email for testers

Staging has its own database with sample data, not copies of real customers. So testers sign up with their own real email and get
everything a customer would: the sign-up code, the welcome email, order emails. To test sign-up again with the same email, an
owner deletes that account in Admin > Accounts, and the email can sign up fresh.

Two kinds of address never get real email, anywhere:

- made-up sample addresses (`@spinhobby.test` and other reserved endings: `.example`, `.invalid`, `.localhost`): they can't receive mail, and sending to
  them would only bounce and hurt the shop's sender reputation;
- anyone not on `EMAIL_ALLOWLIST`, **only if** that list is set. It is optional and normally left empty. Set it (addresses
  and/or `@domain`s; `OWNER_EMAILS` and `STAFF_EMAILS` always pass) only to limit email on purpose, for example while trying
  something risky.

The log shows `Held back "<subject>" to ha***@…` for each one.

To set it up:

1. In Resend (resend.com), create a second API key named `staging`, with sending access only, on the domain production already uses.
2. In Render, on the staging API service, set:
   - `RESEND_API_KEY` to the staging key;
   - `FROM_EMAIL` to the same address as production, e.g. `Spin Hobby <orders@spinhobby.com>`;
   - `STOREFRONT_URL` to `https://spin-hobby-staging.netlify.app`, so links and pictures in the emails open staging, not the live shop.
3. Redeploy. To check it, sign up on the staging site with your email; the 6-digit code should arrive within a minute.

## Resend's limits: counted, and queued when reached

Resend's free plan allows about 100 emails a day and 3,000 a month (check resend.com/pricing). The API counts every email it sends
(`email_usage`, per UTC day) and, near a limit, keeps emails in a queue (`email_queue`) instead of losing them:

- news and reminders (restock alerts, cart reminders, pre-order news) stop at 80% of the limit, leaving the rest for what matters;
- sign-up codes and order emails (receipts, shipped, refunds) keep going until the limit itself;
- anything Resend turns away with 429 is queued too;
- every 10 minutes (`EMAIL_QUEUE_INTERVAL_MINUTES`) waiting emails go out while there is room: codes first, then orders, welcome
  emails, news; oldest first within each.

A sign-up code that has to wait lasts 2 days instead of 30 minutes (its email says so), and the website tells the new customer
their code is in line and they can shop meanwhile.

**Admin > Dashboard > Email** shows today's and this month's count against the limits, a warning from 70%, and what is waiting.

Settings: `RESEND_DAILY_LIMIT` (default 100) and `RESEND_MONTHLY_LIMIT` (default 3000); `0` means no limit (a paid plan). Staging
and production count separately: if they share one Resend account, split the limits between them, e.g. production 80 / 2,500 and
staging 20 / 500.

**Spam folders:** whether email lands in the inbox depends on the domain's SPF/DKIM records, which Resend shows under Domains. Staging uses the same domain, so it will show a spam problem before customers would.
