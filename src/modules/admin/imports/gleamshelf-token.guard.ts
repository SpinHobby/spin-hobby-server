import { CanActivate, createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { unauthorized } from '../../../common/errors.js';
import { ImportsService } from './imports.service.js';

export type TokenRequest = Request & { gleamshelf?: { tokenId: string } };

/** The routes a connected Gleamshelf app calls: they need the app's token (from the pairing code), not a signed-in person. */
@Injectable()
export class GleamshelfTokenGuard implements CanActivate {
  constructor(private readonly imports: ImportsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<TokenRequest>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const found = token ? await this.imports.authenticate(token) : null;
    if (!found) throw unauthorized();
    req.gleamshelf = { tokenId: found.id };
    return true;
  }
}

export const AppToken = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<TokenRequest>().gleamshelf!.tokenId,
);
