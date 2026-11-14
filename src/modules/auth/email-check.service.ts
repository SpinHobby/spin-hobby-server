import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../common/errors.js';
import { isProduction } from '../../config/app.config.js';
import { Db } from '../../database/db.service.js';
import { EmailService } from '../../integrations/email/email.service.js';
import type { AppUser } from './auth.service.js';

/** How long a code works. */
export const CODE_MINUTES = 30;
/** Wrong guesses before the code stops working (a new one must be sent). */
export const CODE_TRIES = 5;
/** The shortest wait between two codes. */
const RESEND_SECONDS = 60;

const hash = (userId: string, code: string) =>
  createHash('sha256').update(`${userId}:${code}`).digest('hex');

/**
 * Confirms that a customer owns their email with a 6-digit code sent through the shop's own mailer (Resend), not Supabase's
 * rate-limited one. Unconfirmed accounts can still shop; only using points, linking apps and buying limited items wait for it.
 * Locally, with no mailer set up, the code is written to the server log instead.
 */
@Injectable()
export class EmailCheckService {
  private readonly logger = new Logger(EmailCheckService.name);

  constructor(
    private readonly db: Db,
    private readonly email: EmailService,
  ) {}

  /** Sends a fresh code (the old one stops working). */
  async send(user: Pick<AppUser, 'id' | 'email' | 'firstName' | 'emailVerified'>) {
    if (user.emailVerified) return { success: true as const, verified: true, sent: false };
    const last = await this.db.one<{ wait: number }>(
      `select ceil(extract(epoch from (sent_at + make_interval(secs => $2) - now())))::int as wait
         from public.email_codes where user_id = $1`,
      [user.id, RESEND_SECONDS],
    );
    if (last && last.wait > 0)
      throw new AppError(
        `Wait ${last.wait} seconds before asking for another code.`,
        429,
        'CODE_WAIT',
      );
    if (!this.email.configured && isProduction())
      throw new AppError("Email is not set up yet, so codes can't be sent. Try again later.", 503);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.db.exec(
      `insert into public.email_codes (user_id, code_hash, expires_at, attempts, sent_at)
       values ($1, $2, now() + make_interval(mins => $3), 0, now())
       on conflict (user_id) do update
         set code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, sent_at = now()`,
      [user.id, hash(user.id, code), CODE_MINUTES],
    );
    if (this.email.configured) {
      const ok = await this.email.send(
        user.email,
        `${code} is your Spin Hobby code`,
        this.email.emailCodeHtml(code, user.firstName, CODE_MINUTES),
      );
      if (!ok && isProduction())
        throw new AppError('The email could not be sent. Try again in a minute.', 502);
      if (!ok)
        this.logger.log(`Email code for ${user.email}: ${code} (the local inbox didn't take it)`);
    } else {
      this.logger.log(`Email code for ${user.email}: ${code} (no mailer set up; local only)`);
    }
    return { success: true as const, verified: false, sent: true };
  }

  /** Checks a code; the right one confirms the email. */
  async confirm(user: Pick<AppUser, 'id' | 'emailVerified'>, code: string) {
    if (user.emailVerified) return { success: true as const, verified: true };
    const row = await this.db.one<{ code_hash: string; attempts: number; expired: boolean }>(
      'select code_hash, attempts, expires_at <= now() as expired from public.email_codes where user_id = $1',
      [user.id],
    );
    if (!row || row.expired)
      throw new AppError('That code has expired. Send a new one.', 400, 'CODE_EXPIRED');
    if (row.attempts >= CODE_TRIES)
      throw new AppError('Too many tries. Send a new code.', 429, 'CODE_TRIES');
    const given = Buffer.from(hash(user.id, code));
    if (!timingSafeEqual(given, Buffer.from(row.code_hash))) {
      await this.db.exec(
        'update public.email_codes set attempts = attempts + 1 where user_id = $1',
        [user.id],
      );
      throw new AppError(
        "That code isn't right. Check the email and try again.",
        400,
        'CODE_WRONG',
      );
    }
    await this.db.transaction(async (tx) => {
      await this.db.exec(
        'update public.profiles set email_verified_at = coalesce(email_verified_at, now()) where id = $1',
        [user.id],
        tx,
      );
      await this.db.exec('delete from public.email_codes where user_id = $1', [user.id], tx);
    });
    return { success: true as const, verified: true };
  }
}
