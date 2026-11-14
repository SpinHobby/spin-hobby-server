import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { AppError } from '../../common/errors.js';
import { Db } from '../../database/db.service.js';
import type { SignupDto } from './dto/signup.dto.js';
import { SessionService, type Session } from './session.service.js';
import { devLoginFlag } from '../../config/auth.config.js';
import { devLoginPassword, devLoginUsers } from '../../config/auth.config.js';
import { supabaseJwtSecret, supabaseUrl } from '../../config/supabase.config.js';

/**
 * Local development only: sign in as a seeded account without Supabase (see scripts/dev-local.mjs).
 * Switched on by AUTH_DEV_LOGIN=true, never in production. The token it issues is a normal Supabase-style
 * JWT signed with SUPABASE_JWT_SECRET, so the rest of the API can't tell the difference.
 */
/** Accounts made through local sign-up and their passwords (gone when the server restarts, like the local database). */
const signedUp = new Map<string, string>();

@Injectable()
export class DevLogin {
  constructor(
    private readonly db: Db,
    private readonly sessions: SessionService,
  ) {}

  enabled() {
    return devLoginFlag() && Boolean(supabaseJwtSecret());
  }

  /** The shared password for every dev account. */
  password() {
    return devLoginPassword();
  }

  /** The password an account signs in with: its own if it was made through local sign-up. */
  passwordFor(email: string) {
    return signedUp.get(email) ?? this.password();
  }

  /** Local sign-up, so the sign-up and welcome steps can be tried without Supabase. Their passwords live only in memory. */
  async signup(dto: SignupDto): Promise<Session> {
    const email = dto.email.toLowerCase();
    if (await this.db.one('select 1 from public.profiles where email = $1', [email]))
      throw new AppError(
        'An account with this email already exists. Sign in instead.',
        409,
        'email_exists',
      );
    await this.db.exec(
      'insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)',
      [
        randomUUID(),
        email,
        JSON.stringify({
          ...(dto.firstName && { first_name: dto.firstName }),
          ...(dto.lastName && { last_name: dto.lastName }),
        }),
      ],
    );
    signedUp.set(email, dto.password);
    return this.login(email, dto.password);
  }

  async login(email: string, password: string): Promise<Session> {
    const profile = await this.db.one<{ id: string }>(
      'select id from public.profiles where email = $1',
      [email],
    );
    const own = signedUp.get(email);
    const allowed =
      own !== undefined ||
      devLoginUsers()
        .map((e) => e.split(':')[0])
        .includes(email);
    if (!profile || password !== (own ?? this.password()) || !allowed) {
      throw new AppError('Wrong email or password.', 401);
    }
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const jwt = new SignJWT({ email, role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(profile.id)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime(expiresAt);
    const issuer = supabaseUrl();
    if (issuer) jwt.setIssuer(`${issuer}/auth/v1`);
    const token = await jwt.sign(new TextEncoder().encode(supabaseJwtSecret()));
    return this.sessions.fromTokens({
      access_token: token,
      refresh_token: `dev:${email}`,
      expires_at: expiresAt,
    });
  }
}
