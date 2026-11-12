/** The rewards arithmetic, kept free of the database so it can be tested on its own. Everything is whole points and whole cents. */

export interface RewardRates {
  /** Points for each whole dollar of goods paid. */
  pointsPerDollar: number;
  /** What 100 points take off an order, in cents. */
  centsPer100Points: number;
  /** The fewest points that can be turned into a code at once. */
  minRedeemPoints: number;
}

/** Points a paid order earns: whole dollars of goods (after the discount; not shipping or tax) times the rate. */
export function pointsForGoods(goodsCents: number, pointsPerDollar: number): number {
  if (!(goodsCents > 0) || !(pointsPerDollar > 0)) return 0;
  return Math.floor(goodsCents / 100) * Math.floor(pointsPerDollar);
}

/** What `points` take off an order, in cents (rounded down: a code is never worth more than the points). */
export function pointsValueCents(points: number, centsPer100Points: number): number {
  return Math.floor((Math.max(0, points) * centsPer100Points) / 100);
}

/**
 * Points to take back when `refundedCents` of an order's `totalCents` is refunded: the same share of what it `earned`, never more than
 * what is still left after earlier refunds (`takenBack`, a positive number).
 */
export function pointsToTakeBack(
  earned: number,
  takenBack: number,
  refundedCents: number,
  totalCents: number,
): number {
  if (!(earned > 0) || !(totalCents > 0) || !(refundedCents > 0)) return 0;
  const share =
    refundedCents >= totalCents ? earned : Math.round((earned * refundedCents) / totalCents);
  return Math.max(0, Math.min(share, earned - Math.max(0, takenBack)));
}

/** Why `points` can't be turned into a code, or null when they can. */
export function redeemProblem(points: number, balance: number, rates: RewardRates): string | null {
  if (!Number.isInteger(points) || points <= 0) return 'Choose how many points to use.';
  if (points < rates.minRedeemPoints)
    return `You can use ${rates.minRedeemPoints.toLocaleString('en-CA')} points or more at a time.`;
  if (points > balance) return `You have ${Math.max(0, balance).toLocaleString('en-CA')} points.`;
  if (pointsValueCents(points, rates.centsPer100Points) < 1)
    return 'That is worth less than a cent.';
  return null;
}
