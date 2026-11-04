import { describe, expect, it } from 'vitest';
import { applyDiscount, normalizeCode, type DiscountRule } from './discount-math.js';

const rule = (over: Partial<DiscountRule> = {}): DiscountRule => ({
  code: 'SPRING10',
  kind: 'percent',
  value: 10,
  min_subtotal_cents: 0,
  starts_at: null,
  ends_at: null,
  max_uses: null,
  uses: 0,
  active: true,
  ...over,
});
const NOW = Date.parse('2026-10-29T12:00:00Z');

describe('applyDiscount', () => {
  it('takes a percentage off the goods, rounded to the cent', () => {
    expect(applyDiscount(rule(), 4999, NOW)).toEqual({ cents: 500, message: null });
  });

  it('takes a fixed amount off, never more than the goods', () => {
    expect(applyDiscount(rule({ kind: 'amount', value: 1500 }), 4000, NOW).cents).toBe(1500);
    expect(applyDiscount(rule({ kind: 'amount', value: 1500 }), 900, NOW).cents).toBe(900);
  });

  it.each([
    [null, "That code isn't valid."],
    [rule({ active: false }), "That code isn't valid."],
    [rule({ starts_at: '2026-11-01T00:00:00Z' }), "That code isn't active yet."],
    [rule({ ends_at: '2026-10-29T11:59:59Z' }), 'That code has expired.'],
    [rule({ max_uses: 3, uses: 3 }), 'That code has been used up.'],
    [rule({ min_subtotal_cents: 5000 }), 'That code needs an order of $50.00 or more.'],
  ])('refuses %#', (r, message) => {
    expect(applyDiscount(r, 4000, NOW)).toEqual({ cents: 0, message });
  });

  it('reads codes however they are typed', () => {
    expect(normalizeCode('  spring 10 ')).toBe('SPRING10');
  });
});
