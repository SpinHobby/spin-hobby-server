import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit.js';

describe('RateLimiter', () => {
  it('allows up to the limit inside the window and reports when to retry', () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 3; i++) expect(limiter.hit('ip', 3, 60_000, 1_000 + i).allowed).toBe(true);
    const blocked = limiter.hit('ip', 3, 60_000, 10_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(51); // oldest hit at 1s ages out at 61s
  });

  it('forgives old hits as the window slides', () => {
    const limiter = new RateLimiter();
    limiter.hit('ip', 1, 1_000, 0);
    expect(limiter.hit('ip', 1, 1_000, 500).allowed).toBe(false);
    expect(limiter.hit('ip', 1, 1_000, 1_001).allowed).toBe(true);
  });

  it('counts each key separately and can be reset', () => {
    const limiter = new RateLimiter();
    expect(limiter.hit('a', 1, 60_000).allowed).toBe(true);
    expect(limiter.hit('b', 1, 60_000).allowed).toBe(true);
    expect(limiter.hit('a', 1, 60_000).allowed).toBe(false);
    limiter.reset();
    expect(limiter.hit('a', 1, 60_000).allowed).toBe(true);
  });
});
