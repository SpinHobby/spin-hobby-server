/** The rewards arithmetic, kept free of the database so it can be tested on its own. Everything is whole points and whole cents. */

export interface RewardRates {
  /** Points for each whole dollar of goods paid. */
  pointsPerDollar: number;
  /** What 100 points take off an order, in cents. */
  centsPer100Points: number;
  /** The fewest points that can be turned into a code at once. */
  minRedeemPoints: number;
}

/** A product's own rule: `multiplier` 2 = double points, 0 = none; an ended promotion counts as no rule. */
export interface ProductRule {
  multiplier: number;
  endsAt: string | null;
}

/** The multiplier a product earns at `at` (ms): its rule while that runs, else 1. */
export function multiplierAt(rule: ProductRule | undefined, at: number): number {
  if (!rule) return 1;
  if (rule.endsAt && Date.parse(rule.endsAt) <= at) return 1;
  return Math.max(0, Number(rule.multiplier));
}

/**
 * Points for an order's lines: each line's goods (its share of any discount taken off) times the rate and the product's multiplier,
 * rounded down once for the whole order. Not shipping or tax.
 */
export function pointsForLines(
  lines: { itemId: string; lineCents: number }[],
  discountCents: number,
  pointsPerDollar: number,
  rules: Map<string, ProductRule>,
  at = Date.now(),
): number {
  if (!(pointsPerDollar > 0)) return 0;
  const subtotal = lines.reduce((t, l) => t + Math.max(0, l.lineCents), 0);
  if (!(subtotal > 0)) return 0;
  const keep = Math.max(0, subtotal - Math.max(0, discountCents)) / subtotal;
  const raw = lines.reduce(
    (t, l) => t + Math.max(0, l.lineCents) * keep * multiplierAt(rules.get(l.itemId), at),
    0,
  );
  // tiny float error (19.999999) must not cost a point
  return Math.floor((raw * Math.floor(pointsPerDollar)) / 100 + 1e-9);
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

/** What a product asks of a buyer: points from past orders, and/or other products in the same order. */
export interface Requirement {
  minEarnedPoints: number | null;
  minOtherCents: number | null;
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Why this buyer can't have `name` in this cart, or null when they can. `earned` is their points from past orders (null when signed
 * out); `otherCents` is what the rest of the cart comes to.
 */
export function requirementProblem(
  name: string,
  req: Requirement,
  earned: number | null,
  otherCents: number,
  emailConfirmed = true,
): string | null {
  if (req.minEarnedPoints) {
    const need = req.minEarnedPoints.toLocaleString('en-CA');
    if (earned === null)
      return `${name} is for customers with ${need} points from past orders. Sign in to buy it.`;
    if (!emailConfirmed)
      return `${name} is for customers who have confirmed their email. Confirm yours in Account to buy it.`;
    if (earned < req.minEarnedPoints)
      return `${name} is for customers with ${need} points from past orders. You have ${earned.toLocaleString('en-CA')}.`;
  }
  if (req.minOtherCents && otherCents < req.minOtherCents)
    return `${name} needs at least ${dollars(req.minOtherCents)} of other items in the same order.`;
  return null;
}
