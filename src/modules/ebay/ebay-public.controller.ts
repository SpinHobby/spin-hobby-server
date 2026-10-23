import { Body, Controller, Get, HttpCode, Logger, Post, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { createHash } from 'node:crypto';
import { AppError } from '../../common/errors.js';
import { SkipRateLimit } from '../../common/guards/rate-limit.guard.js';
import { ebayDeletionEndpoint, ebayVerificationToken } from '../../config/ebay.config.js';
import { Access } from '../auth/access.js';
import { EbayConnectionService } from './ebay-connection.service.js';

/**
 * What eBay itself calls: the end of the owner's sign-in (eBay sends them back here with a code), and eBay's "marketplace account deletion"
 * notices, which every app must answer before its production keys work. The shop keeps no eBay buyer's data, so a notice has nothing to
 * delete (only the connected seller's own user name, if it is theirs).
 */
@ApiExcludeController()
@Controller('ebay')
@Access('public')
export class EbayPublicController {
  private readonly logger = new Logger('eBay');

  constructor(private readonly connection: EbayConnectionService) {}

  @Get('oauth/callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    if (error || !code || !state)
      return res.redirect(
        302,
        this.connection.adminUrl(error === 'access_denied' ? 'declined' : 'error'),
      );
    try {
      await this.connection.finishConnect(code, state);
      return res.redirect(302, this.connection.adminUrl('connected'));
    } catch (e) {
      this.logger.warn(`eBay sign-in failed: ${e instanceof Error ? e.message : String(e)}`);
      return res.redirect(302, this.connection.adminUrl('error'));
    }
  }

  /** eBay checks the endpoint is ours: the answer is a hash of its challenge, our verification token and this exact address. */
  @Get('account-deletion')
  @SkipRateLimit()
  challenge(@Query('challenge_code') challengeCode: string | undefined) {
    const token = ebayVerificationToken();
    const endpoint = ebayDeletionEndpoint();
    if (!token || !endpoint)
      throw new AppError('eBay account deletion notices are not set up on this server.', 503);
    if (!challengeCode || challengeCode.length > 200)
      throw new AppError('challenge_code is missing.');
    return {
      challengeResponse: createHash('sha256')
        .update(challengeCode)
        .update(token)
        .update(endpoint)
        .digest('hex'),
    };
  }

  @Post('account-deletion')
  @HttpCode(200)
  @SkipRateLimit()
  async deletion(
    @Body() body: { notification?: { data?: { username?: string; userId?: string } } },
  ) {
    const username = body?.notification?.data?.username;
    if (username) await this.connection.forgetUsername(String(username));
    return { success: true };
  }
}
