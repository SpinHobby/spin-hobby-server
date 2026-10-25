import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { forbidden } from '../../common/errors.js';
import type { AuthedRequest } from '../auth/access.js';
import { atLeast } from '../auth/roles.js';
import { squareSyncTriggerSecret } from '../../config/square.config.js';

const sameSecret = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Lets a Square sync be started by the signed-in owner, or by a scheduled job that sends the shared
 * secret (SQUARE_SYNC_TRIGGER_SECRET) in the `x-square-sync-secret` header. Runs after the global
 * AccessGuard, which has already attached the signed-in user (if any).
 */
@Injectable()
export class OwnerOrSyncSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const expected = squareSyncTriggerSecret();
    const given = req.headers['x-square-sync-secret'];
    const bySecret = Boolean(expected && typeof given === 'string' && sameSecret(given, expected));
    if (!bySecret && !atLeast(req.user?.role, 'owner')) throw forbidden('start a Square sync');
    return true;
  }
}
