import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { tap } from 'rxjs';
import { draftsChanged, workQueued } from './wake.js';

/** After any change request that succeeds (not a GET), tells whoever waits that `kind` happened (wake.ts). */
function after(kind: 'work' | 'drafts') {
  @Injectable()
  class Wake implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler) {
      const method = context.switchToHttp().getRequest<Request>().method;
      return next.handle().pipe(
        tap(() => {
          if (method !== 'GET') (kind === 'work' ? workQueued : draftsChanged)();
        }),
      );
    }
  }
  return Wake;
}

/** On the admin's job routes: a queued or retried job wakes the photo computer. */
export const WakesWorker = after('work');
/** On routes that change drafts: an Imports page waiting for news reloads its list. */
export const ChangesDrafts = after('drafts');
