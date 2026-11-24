/** What a product's transparent photos show on: the shop's rule, or the product's own choice. */
export type BackgroundMode = 'shop' | 'white' | 'library' | 'box_art';
/** The shop's rule for products with no choice of their own. */
export type BackgroundRule = 'shop' | 'box_art';

export const BACKGROUND_MODES: BackgroundMode[] = ['shop', 'white', 'library', 'box_art'];
export const BACKGROUND_RULES: BackgroundRule[] = ['shop', 'box_art'];

export interface ProductBackgroundFacts {
  /** The product's own choice (null: none, the shop's rule decides). */
  mode: BackgroundMode | null;
  /** The library background it chose, when it is still in the library. */
  libraryUrl: string | null;
  /** Its box art, when it has one. */
  boxArtUrl: string | null;
}

/**
 * The background a product shows on that is its own: `{ url }` (null: plain white), or undefined when it shows on the shop background like
 * every product without a choice. Box art that a product does not have, and a library background since deleted, fall back to the shop
 * background: "box art, where there is one".
 */
export function ownBackground(
  facts: ProductBackgroundFacts,
  rule: BackgroundRule,
): { url: string | null } | undefined {
  const mode = facts.mode ?? rule;
  if (mode === 'white') return { url: null };
  if (mode === 'library') return facts.libraryUrl ? { url: facts.libraryUrl } : undefined;
  if (mode === 'box_art') return facts.boxArtUrl ? { url: facts.boxArtUrl } : undefined;
  return undefined;
}
