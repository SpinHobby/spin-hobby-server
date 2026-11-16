import { describe, expect, it } from 'vitest';
import {
  multiplierAt,
  pointsForLines,
  pointsToTakeBack,
  pointsValueCents,
  redeemProblem,
  requirementProblem,
} from './rewards-math.js';

const rates = { pointsPerDollar: 1, centsPer100Points: 100, minRedeemPoints: 500 };

describe('rewards math', () => {
  it("gives points for the goods, with each product's multiplier and its share of the discount", () => {
    const none = new Map();
    const line = (itemId: string, lineCents: number) => ({ itemId, lineCents });
    expect(pointsForLines([line('A', 7_800)], 0, 3, none)).toBe(234);
    expect(pointsForLines([line('A', 7_899)], 0, 1, none)).toBe(78);
    expect(pointsForLines([line('A', 99)], 0, 1, none)).toBe(0);
    expect(pointsForLines([line('A', 5_000)], 0, 0, none)).toBe(0);
    // $10 off a $100 order: 90 dollars of goods
    expect(pointsForLines([line('A', 10_000)], 1_000, 1, none)).toBe(90);
    const rules = new Map([
      ['DOUBLE', { multiplier: 2, endsAt: null }],
      ['RARE', { multiplier: 0, endsAt: null }],
    ]);
    expect(
      pointsForLines([line('DOUBLE', 5_000), line('RARE', 50_000), line('A', 1_000)], 0, 1, rules),
    ).toBe(110);
    expect(pointsForLines([line('RARE', 50_000)], 0, 3, rules)).toBe(0);
  });

  it('lets a promotion run until its end', () => {
    const rule = { multiplier: 3, endsAt: '2026-12-01T00:00:00Z' };
    expect(multiplierAt(rule, Date.parse('2026-11-30T12:00:00Z'))).toBe(3);
    expect(multiplierAt(rule, Date.parse('2026-12-01T00:00:00Z'))).toBe(1);
    expect(multiplierAt(undefined, 0)).toBe(1);
    expect(multiplierAt({ multiplier: 0, endsAt: null }, 0)).toBe(0);
  });

  it('values points, rounding down', () => {
    expect(pointsValueCents(500, 100)).toBe(500);
    expect(pointsValueCents(550, 100)).toBe(550);
    expect(pointsValueCents(333, 50)).toBe(166);
    expect(pointsValueCents(-5, 100)).toBe(0);
  });

  it('takes back the refunded share, never more than is left', () => {
    expect(pointsToTakeBack(100, 0, 10_000, 10_000)).toBe(100);
    expect(pointsToTakeBack(100, 0, 2_500, 10_000)).toBe(25);
    expect(pointsToTakeBack(100, 90, 5_000, 10_000)).toBe(10);
    expect(pointsToTakeBack(100, 100, 10_000, 10_000)).toBe(0);
    expect(pointsToTakeBack(0, 0, 10_000, 10_000)).toBe(0);
  });

  it('says why points cannot be used', () => {
    expect(redeemProblem(500, 600, rates)).toBeNull();
    expect(redeemProblem(400, 600, rates)).toMatch(/500 points or more/);
    expect(redeemProblem(700, 600, rates)).toMatch(/You have 600 points/);
    expect(redeemProblem(1.5, 600, rates)).toMatch(/Choose/);
  });

  it('says why a buyer cannot have a product that asks for something', () => {
    const points = { minEarnedPoints: 1_000, minOtherCents: null };
    expect(requirementProblem('ETB', points, null, 0)).toMatch(/Sign in to buy it/);
    expect(requirementProblem('ETB', points, 999, 0)).toMatch(
      /1,000 points from past orders. You have 999/,
    );
    expect(requirementProblem('ETB', points, 1_000, 0)).toBeNull();
    expect(requirementProblem('ETB', points, 1_000, 0, false)).toMatch(/confirmed their email/);
    const other = { minEarnedPoints: null, minOtherCents: 5_000 };
    expect(requirementProblem('ETB', other, null, 4_999)).toBe(
      'ETB needs at least $50.00 of other items in the same order.',
    );
    expect(requirementProblem('ETB', other, null, 5_000)).toBeNull();
  });
});
