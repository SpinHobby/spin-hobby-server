import { Injectable } from '@nestjs/common';
import { SignJWT } from 'jose';
import { AppError } from '../../common/errors.js';
import { Db } from '../../database/db.service.js';
import { SessionService, type Session } from './session.service.js';
import { devLoginFlag } from '../../config/auth.config.js';
import { devLoginPassword, devLoginUsers } from '../../config/auth.config.js';
import { supabaseJwtSecret, supabaseUrl } from '../../config/supabase.config.js';

/**
 * Local development only: sign in as a seeded account without Supabase (see scripts/dev-local.mjs).
 * Switched on by AUTH_DEV_LOGIN=true, never in production. The token it issues is a normal Supabase-style
 * JWT signed with SUPABASE_JWT_SECRET, so the rest of the API can't tell the difference.
 */
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

  async login(email: string, password: string): Promise<Session> {
    const profile = await this.db.one<{ id: string }>(
      'select id from public.profiles where email = $1',
      [email],
    );
    const allowed = devLoginUsers()
      .map((e) => e.split(':')[0])
      .includes(email);
    if (!profile || password !== this.password() || !allowed) {
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
    const token = await jwt.sign(new TextEncoder().encode(supabaseJwtSecret()!));
    return this.sessions.fromTokens({
      access_token: token,
      refresh_token: `dev:${email}`,
      expires_at: expiresAt,
    });
  }
}
