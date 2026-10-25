import {
  applyDecorators,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { forbidden, unauthorized } from '../../common/errors.js';
import { AuthService, type AppUser } from './auth.service.js';

/**
 * public: anyone (user attached if signed in) · user: any signed-in account · staff: staff or owner · auditor: owners and the staff
 * the owner allowed into Audit · owner: owner only
 */
export type AccessLevel = 'public' | 'user' | 'staff' | 'auditor' | 'owner';
const ACCESS_KEY = 'spinhobby:access';
/** Who may call a route. Anything above `public` is also shown as needing a bearer token in the API docs. */
export const Access = (level: AccessLevel) =>
  applyDecorators(SetMetadata(ACCESS_KEY, level), ...(level === 'public' ? [] : [ApiBearerAuth()]));

export type AuthedRequest = Request & { user?: AppUser | null };

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const level =
      this.reflector.getAllAndOverride<AccessLevel>(ACCESS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'public';
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    req.user = await this.auth.userFromAuthorization(req.headers.authorization);
    if (level === 'public') return true;
    if (!req.user) throw unauthorized();
    if (level === 'staff' && req.user.role !== 'staff' && req.user.role !== 'owner')
      throw forbidden();
    if (level === 'auditor' && !req.user.canAudit) throw forbidden();
    if (level === 'owner' && req.user.role !== 'owner') throw forbidden();
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<AuthedRequest>().user ?? null,
);
