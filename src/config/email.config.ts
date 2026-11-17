import { env, envList, envNumber } from './env.js';

/** Resend API key and the From address. Email is skipped (not an error) when either is missing. */
export const resendApiKey = () => env('RESEND_API_KEY');
export const fromEmail = () => env('FROM_EMAIL');
/** Where shoppers' replies go (and the address in every email's footer): the shop's public support address. */
export const supportEmail = () => env('SUPPORT_EMAIL') || 'info@spinhobby.com';

/**
 * Where email goes:
 * - `resend`: real email (needs RESEND_API_KEY and FROM_EMAIL); the default when both are set;
 * - `mailpit`: a pretend inbox on this computer (MAILPIT_URL, default http://localhost:8025); nothing leaves the machine.
 *   The local start script (npm run dev:local) uses it;
 * - `off`: nothing is sent.
 */
export type MailTransport = 'resend' | 'mailpit' | 'off';
export const mailTransport = (): MailTransport => {
  const chosen = env('MAIL_TRANSPORT');
  if (chosen === 'mailpit' || chosen === 'off') return chosen;
  return resendApiKey() && fromEmail() ? 'resend' : 'off';
};
export const mailpitUrl = () => (env('MAILPIT_URL') || 'http://localhost:8025').replace(/\/$/, '');

/**
 * Optional: limit real email to these addresses or `@domain`s (comma separated), plus OWNER_EMAILS and STAFF_EMAILS; everyone else's
 * is held back and logged. Empty (the usual, staging included): everyone gets email. Staging has its own database with sample
 * data, so testers sign up with their real email; admin deletes the account so the same email can sign up again.
 */
export const emailAllowlist = () => envList('EMAIL_ALLOWLIST').map((e) => e.toLowerCase());
export const emailAllowlistOn = () => emailAllowlist().length > 0;

/**
 * Resend's plan limits (free plan at the time of writing: 100 a day, 3,000 a month). The API counts what it sends and, near a limit,
 * holds emails in a queue until the limit resets (UTC day / month). 0 = no limit (a paid plan). Staging and production count
 * separately, so if they share one Resend account, split the limits between them.
 */
export const resendDailyLimit = () => Math.max(0, envNumber('RESEND_DAILY_LIMIT', 100));
export const resendMonthlyLimit = () => Math.max(0, envNumber('RESEND_MONTHLY_LIMIT', 3000));
/** How often waiting emails are tried again (minutes; 0 = never, e.g. tests). */
export const emailQueueIntervalMinutes = () =>
  Math.max(0, envNumber('EMAIL_QUEUE_INTERVAL_MINUTES', 10));
