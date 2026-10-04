import { Body, Controller, Get, Headers, HttpCode, Ip, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RateLimit } from '../../common/guards/rate-limit.guard.js';
import { Access } from './access.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { OauthUrlQuery } from './dto/oauth-url.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { ResetDto } from './dto/reset.dto.js';
import { SignupDto } from './dto/signup.dto.js';
import { SignInService } from './sign-in.service.js';

/**
 * Sign-in for the storefront and admin. The browser only talks to this API; this API talks to
 * Supabase Auth, so no Supabase keys or SDK are needed in the frontend.
 */
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly signIn: SignInService) {}

  /** Which sign-in methods to show. */
  @Get('providers')
  providers() {
    return this.signIn.providers();
  }

  /** Email + password (or, on staging, the admin username + password). Returns a session. */
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.signIn.login(dto.email, dto.password);
  }

  /** Creates a customer account that is already confirmed (no email is sent), then signs it in. */
  @Post('signup')
  @HttpCode(201)
  signup(@Body() dto: SignupDto, @Ip() ip: string) {
    return this.signIn.signup(dto, ip);
  }

  /** Emails a password-reset link. Always answers OK for a well-formed address, so addresses can't be probed. */
  @RateLimit({ limit: 5, windowMs: 60 * 60_000 })
  @Post('reset')
  @HttpCode(200)
  reset(@Body() dto: ResetDto) {
    return this.signIn.requestPasswordReset(dto.email, dto.redirectTo);
  }

  /** Sets a new password for the signed-in account. A reset link signs the person in first, then lands here. */
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @Post('password')
  @Access('user')
  @HttpCode(200)
  password(@Body() dto: ChangePasswordDto, @Headers('authorization') authorization = '') {
    return this.signIn.changePassword(authorization.replace(/^Bearer\s+/i, ''), dto.password);
  }

  /** Trades a refresh token for a fresh session. */
  @RateLimit({ limit: 30, windowMs: 60_000 })
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.signIn.refresh(dto.refreshToken);
  }

  /** Where to send the browser for Google/Discord sign-in; Supabase redirects back with tokens in the URL hash. */
  @Get('oauth-url')
  oauthUrl(@Query() query: OauthUrlQuery) {
    return this.signIn.oauthUrl(query.provider, query.redirectTo);
  }
}
