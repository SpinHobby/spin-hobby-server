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
import { AuthService, restrictionError, type AppUser } from './auth.service.js';
import { atLeast } from './roles.js';

/**
 * public: anyone (user attached if signed in) · user: any signed-in account · staff: staff and every role above (roles.ts) ·
 * auditor: owners and the staff the owner allowed into Audit · owner: owner and above. A suspended or banned account is refused
 * everywhere but public routes, where it counts as signed out.
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
    const user = await this.auth.userFromAuthorization(req.headers.authorization);
    req.user = user?.restriction ? null : user;
    if (level === 'public') return true;
    if (user?.restriction) throw restrictionError(user.restriction);
    if (!user) throw unauthorized();
    if (level === 'staff' && !atLeast(user.role, 'staff')) throw forbidden();
    if (level === 'auditor' && !user.canAudit) throw forbidden();
    if (level === 'owner' && !atLeast(user.role, 'owner')) throw forbidden();
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<AuthedRequest>().user ?? null,
);
