import { CanActivate, createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { unauthorized } from '../../common/errors.js';
import { RewardsService, type RewardApp } from './rewards.service.js';

export type AppRequest = Request & { rewardApp?: RewardApp };

/** The rewards routes another app calls: they need that app's key (Admin > Rewards > Apps), not a signed-in person. */
@Injectable()
export class RewardAppGuard implements CanActivate {
  constructor(private readonly rewards: RewardsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    const header = req.headers.authorization ?? '';
    const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const app = key ? await this.rewards.authenticateApp(key) : null;
    if (!app) throw unauthorized();
    req.rewardApp = app;
    return true;
  }
}

export const CallingApp = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AppRequest>().rewardApp!,
);
