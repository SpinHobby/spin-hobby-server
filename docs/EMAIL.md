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
| Staging        | `RESEND_API_KEY`, `FROM_EMAIL`, `EMAIL_ALLOWLIST`          | Real email, but only to the allow-list plus `OWNER_EMAILS`/`STAFF_EMAILS`. Every other email is held back and logged. |
| Production     | `RESEND_API_KEY`, `FROM_EMAIL`                             | Real email to customers.                                                    |
| Anywhere       | `MAIL_TRANSPORT=off`, or no Resend key                     | Nothing is sent. Sign-up codes are printed in the server log, except in production. |

## On your computer: Mailpit (free)

1. Install it once:
   - Mac: `brew install mailpit`
   - Windows or Linux: see https://mailpit.axllent.org/docs/install/
2. Run `npm run dev:local` as usual. It starts Mailpit with the API (or uses one that's already running). The start-up message shows `Emails: http://localhost:8025`.
3. Open that address and you'll see every email: the sign-up code, an order confirmation after a test checkout, and the rest.

Even with a Resend key in `.env`, a local run never sends real email. Without Mailpit, emails are not delivered and sign-up codes are printed in the server window instead.

## Staging: Resend's free plan, team only

Staging holds copies of real customers' addresses. So real email there reaches only:

- the people on `EMAIL_ALLOWLIST`;
- `OWNER_EMAILS` and `STAFF_EMAILS`.

Anyone else's email is held back. The log shows `Held back "<subject>" to ha***@…: not on EMAIL_ALLOWLIST.` This applies whenever `APP_ENV=staging`, even if `EMAIL_ALLOWLIST` is empty.

To set it up:

1. In Resend (resend.com), create a second API key named `staging`, with sending access only, on the domain production already uses.
2. In Render, on the staging API service, set:
   - `RESEND_API_KEY` to the staging key;
   - `FROM_EMAIL` to the same address as production, e.g. `Spin Hobby <orders@spinhobby.com>`;
   - `EMAIL_ALLOWLIST` to the team: full addresses and/or whole domains, e.g. `aidi@example.com, @spinhobby.com`.
3. Redeploy. To check it, sign up on the staging site with an address on the list; the 6-digit code should arrive within a minute.

**Resend's free plan:** at the time of writing it allowed about 3,000 emails a month and 100 a day, on one domain. Check resend.com/pricing for the current limits. Staging traffic from the team is far below that, but production and staging share the limit if they use the same Resend account.

**Spam folders:** whether email lands in the inbox depends on the domain's SPF/DKIM records, which Resend shows under Domains. Staging uses the same domain, so it will show a spam problem before customers would.
