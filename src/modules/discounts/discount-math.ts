/** A discount code as the pricing rules need it. */
export interface DiscountRule {
  code: string;
  kind: 'percent' | 'amount';
  /** Percent (1 to 100) or cents. */
  value: number;
  min_subtotal_cents: number;
  starts_at: string | null;
  ends_at: string | null;
  max_uses: number | null;
  uses: number;
  active: boolean;
}

/** Codes are typed any way and stored upper-case, without spaces. */
export const normalizeCode = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, '');

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * What a code takes off a cart with this goods subtotal (cents), or why it can't be used. Never more than the goods: shipping and
 * tax aren't discounted. `now` is a parameter so tests can fix it.
 */
export function applyDiscount(
  rule: DiscountRule | null,
  subtotalCents: number,
  now = Date.now(),
): { cents: number; message: null } | { cents: 0; message: string } {
  if (!rule || !rule.active) return { cents: 0, message: "That code isn't valid." };
  if (rule.starts_at && new Date(rule.starts_at).getTime() > now)
    return { cents: 0, message: "That code isn't active yet." };
  if (rule.ends_at && new Date(rule.ends_at).getTime() <= now)
    return { cents: 0, message: 'That code has expired.' };
  if (rule.max_uses != null && rule.uses >= rule.max_uses)
    return { cents: 0, message: 'That code has been used up.' };
  if (subtotalCents < rule.min_subtotal_cents)
    return {
      cents: 0,
      message: `That code needs an order of ${money(rule.min_subtotal_cents)} or more.`,
    };
  const cents =
    rule.kind === 'percent'
      ? Math.round((subtotalCents * rule.value) / 100)
      : Math.min(rule.value, subtotalCents);
  return { cents, message: null };
}

/** "10% off" or "$5.00 off", for the checkout and receipts. */
export const discountLabel = (rule: Pick<DiscountRule, 'kind' | 'value'>) =>
  rule.kind === 'percent' ? `${rule.value}% off` : `${money(rule.value)} off`;
