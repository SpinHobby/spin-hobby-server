import { AppError } from '../../../common/errors.js';

/** The most ads the banner holds. More than this and the late ones are never seen. */
export const MAX_ADS = 10;
/** The most products an admin picks to show behind one ad. */
export const MAX_PICKED = 12;
/** How many product pictures sit behind one ad. */
export const BACKDROP_PHOTOS = 5;

export const BACKDROPS = ['products', 'photo', 'chosen'] as const;
export type Backdrop = (typeof BACKDROPS)[number];

export function backdropValue(value: unknown): Backdrop {
  if (!BACKDROPS.includes(value as Backdrop))
    throw new AppError('backdrop must be products, photo or chosen.');
  return value as Backdrop;
}

/** Product ids in the order picked: text, no repeats, at most MAX_PICKED. */
export function pickedProducts(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id || id.length > 80))
    throw new AppError('productIds must be a list of product ids.');
  const ids = [...new Set(value as string[])];
  if (ids.length > MAX_PICKED) throw new AppError(`Pick at most ${MAX_PICKED} products for an ad.`);
  return ids;
}

/** A date and time, or null for "no limit". */
export function optionalMoment(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  const at = typeof value === 'string' ? new Date(value) : null;
  if (!at || Number.isNaN(at.getTime())) throw new AppError(`${field} must be a date.`);
  return at.toISOString();
}

/** Whether an ad shows at `now`: switched on, and inside its dates. */
export function isLive(
  ad: { is_visible: boolean; starts_at: string | Date | null; ends_at: string | Date | null },
  now = new Date(),
): boolean {
  if (!ad.is_visible) return false;
  if (ad.starts_at && new Date(ad.starts_at) > now) return false;
  return !(ad.ends_at && new Date(ad.ends_at) <= now);
}

/**
 * The products behind each ad. An ad with picked products shows those (the ones shoppers can still see, in the order picked); the
 * others share the pool of recent products, each taking the next few so two ads never show the same pictures while there are enough.
 */
export function dealBackdrops<P extends { id: string }>(
  ads: { backdrop: Backdrop; product_ids: string[] }[],
  byId: Map<string, P>,
  pool: P[],
): P[][] {
  let next = 0;
  return ads.map((ad) => {
    if (ad.backdrop === 'photo') return [];
    const picked =
      ad.backdrop === 'chosen' ? ad.product_ids.flatMap((id) => byId.get(id) ?? []) : [];
    if (picked.length) return picked;
    if (!pool.length) return [];
    const dealt: P[] = [];
    for (let i = 0; i < Math.min(BACKDROP_PHOTOS, pool.length); i += 1)
      dealt.push(pool[(next + i) % pool.length]);
    next += dealt.length;
    return dealt;
  });
}
