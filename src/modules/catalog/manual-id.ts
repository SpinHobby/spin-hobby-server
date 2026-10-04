/**
 * Hand-entered products (not in Square) get ids that start with this prefix. It is the one rule that tells
 * them apart from Square items, so the admin, checkout and Square order code all use these two helpers.
 */
export const MANUAL_ID_PREFIX = 'manual-';
export const isManualId = (id: string) => id.startsWith(MANUAL_ID_PREFIX);
