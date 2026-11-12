import { describe, expect, it } from 'vitest';
import {
  pointsForGoods,
  pointsToTakeBack,
  pointsValueCents,
  redeemProblem,
} from './rewards-math.js';

const rates = { pointsPerDollar: 1, centsPer100Points: 100, minRedeemPoints: 500 };

describe('rewards math', () => {
  it('gives points for whole dollars of goods', () => {
    expect(pointsForGoods(7_899, 1)).toBe(78);
    expect(pointsForGoods(7_899, 3)).toBe(234);
    expect(pointsForGoods(99, 1)).toBe(0);
    expect(pointsForGoods(5_000, 0)).toBe(0);
    expect(pointsForGoods(-100, 1)).toBe(0);
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
});
