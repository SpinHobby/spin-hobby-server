/**
 * Lower-case words joined by dashes, accents dropped: "Re:Zero" → "re-zero", "Pokémon" → "pokemon". The website builds its
 * /series/<slug> and product addresses the same way (slugify in src/v3/storefront/data.ts and scripts/generate-seo.mjs).
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
