import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import { AppError } from './errors.js';

/** Sliding-window counter: remembers when each key last hit, and refuses once `limit` hits fall inside `windowMs`. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  hit(
    key: string,
    limit: number,
    windowMs: number,
    now = Date.now(),
  ): { allowed: boolean; retryAfterSeconds: number } {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)),
      };
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(windowMs, now);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  reset() {
    this.hits.clear();
  }

  /** Bounds memory under a flood of distinct addresses: drop idle keys, and everything if that isn't enough. */
  private prune(windowMs: number, now: number) {
    for (const [key, times] of this.hits)
      if (!times.some((t) => now - t < windowMs)) this.hits.delete(key);
    if (this.hits.size > 10_000) this.hits.clear();
  }
}

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}
const RULE_KEY = 'spinhobby:rate-limit';
const SKIP_KEY = 'spinhobby:rate-limit-skip';
/** Per-route limit, counted per IP in addition to the global one. */
export const RateLimit = (rule: RateLimitRule) => SetMetadata(RULE_KEY, rule);
/** Exempt a route or controller (webhooks, health checks, images). */
export const SkipRateLimit = () => SetMetadata(SKIP_KEY, true);

const MESSAGE = 'Too many requests. Please wait a moment and try again.';

/** Per-IP limits: a generous global ceiling (shared Wi-Fi at conventions) plus tighter ones on sensitive routes. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly limiter = new RateLimiter();

  constructor(private readonly reflector: Reflector) {}

  reset() {
    this.limiter.reset();
  }

  canActivate(context: ExecutionContext): boolean {
    if (env('THROTTLE_DISABLED') === 'true') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(SKIP_KEY, targets)) return true;
    const http = context.switchToHttp();
    const ip = http.getRequest<Request>().ip ?? 'unknown';

    const globalLimit = Number(env('RATE_LIMIT_PER_MINUTE') ?? 300);
    const checks: { bucket: string; rule: RateLimitRule }[] = [
      {
        bucket: 'global',
        rule: {
          limit: Number.isFinite(globalLimit) && globalLimit > 0 ? globalLimit : 300,
          windowMs: 60_000,
        },
      },
    ];
    const rule = this.reflector.getAllAndOverride<RateLimitRule | undefined>(RULE_KEY, targets);
    if (rule)
      checks.push({ bucket: `${context.getClass().name}.${context.getHandler().name}`, rule });

    for (const { bucket, rule: r } of checks) {
      const result = this.limiter.hit(`${bucket}|${ip}`, r.limit, r.windowMs);
      if (!result.allowed) {
        http.getResponse<Response>().setHeader('Retry-After', String(result.retryAfterSeconds));
        throw new AppError(MESSAGE, 429, 'RATE_LIMITED', {
          retryAfterSeconds: result.retryAfterSeconds,
        });
      }
    }
    return true;
  }
}
