import { AppError } from '../../../common/errors.js';

/**
 * The storefront looks the owner can pick in Admin > Homepage > Theme. Each id has a set of colours on the website
 * (src/v3/storefront/themes.scss, THEMES in src/v3/storefront/themes.ts); keep the three lists in step.
 */
export const STOREFRONT_THEMES = ['classic', 'water-glass', 'sakura', 'matcha', 'manga'] as const;
export type StorefrontTheme = (typeof STOREFRONT_THEMES)[number];
export const DEFAULT_THEME: StorefrontTheme = 'classic';

/** The saved theme, or the default for one the shop no longer has. */
export const storefrontTheme = (value: unknown): StorefrontTheme =>
  STOREFRONT_THEMES.includes(value as StorefrontTheme) ? (value as StorefrontTheme) : DEFAULT_THEME;

/** Validation for the settings form: one of the themes above. */
export function themeId(value: unknown): StorefrontTheme {
  if (!STOREFRONT_THEMES.includes(value as StorefrontTheme))
    throw new AppError(`Theme must be one of: ${STOREFRONT_THEMES.join(', ')}.`);
  return value as StorefrontTheme;
}
