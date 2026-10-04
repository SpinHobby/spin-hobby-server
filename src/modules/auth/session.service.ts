import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import { AuthService, type AppUser } from './auth.service.js';
import type { ExternalJson } from '../../common/external-json.js';

/** What every successful sign-in returns; the storefront keeps it in localStorage. */
export interface Session {
  success: true;
  accessToken: string;
  refreshToken: string;
  /** Unix seconds. */
  expiresAt: number;
  user: AppUser;
}

/** Turns a Supabase token response into a Session, loading the person's profile. */
@Injectable()
export class SessionService {
  constructor(private readonly auth: AuthService) {}

  async fromTokens(data: ExternalJson): Promise<Session> {
    const user = await this.auth.userFromAuthorization(`Bearer ${data.access_token}`);
    if (!user) throw new AppError('Your account profile could not be loaded.', 500);
    return {
      success: true,
      accessToken: data.access_token as string,
      refreshToken: data.refresh_token as string,
      expiresAt: Number(
        data.expires_at ?? Math.floor(Date.now() / 1000) + Number(data.expires_in ?? 3600),
      ),
      user,
    };
  }
}
