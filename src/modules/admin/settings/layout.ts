import { AppError } from '../../../common/errors.js';

/** The homepage's blocks, top to bottom by default. `shop` is the product grid, which is never hidden. */
export const LAYOUT_SECTIONS = [
  'hero',
  'trust',
  'preorders',
  'lists',
  'recent',
  'shop',
  'about',
  'events',
] as const;
export type LayoutSection = (typeof LAYOUT_SECTIONS)[number];

const VIEWS = ['grid', 'compact', 'list'] as const;
const COLUMNS = ['auto', 3, 4, 5, 6] as const;
const SHAPES = ['square', 'portrait'] as const;
const SIDEBARS = ['left', 'right', 'hidden'] as const;
const WIDTHS = ['standard', 'wide', 'full'] as const;

/** How the storefront is laid out (Admin > Homepage > Page layout). */
export interface StorefrontLayout {
  /** Homepage blocks in order; a hidden one isn't shown. */
  sections: { id: LayoutSection; visible: boolean }[];
  /** How products are listed for a shopper who hasn't picked a view themselves. */
  productView: (typeof VIEWS)[number];
  /** Product cards per row on a wide screen ('auto': as many as fit). Phones always show two. */
  columns: (typeof COLUMNS)[number];
  /** Product photos square, or taller than wide (3:4, for figures and standees). */
  imageShape: (typeof SHAPES)[number];
  /** Where the categories and filters sit on a computer; 'hidden' puts them behind the Filters button, as on a phone. */
  sidebar: (typeof SIDEBARS)[number];
  /** How wide the page gets on a big screen: 1400px, 1680px or the whole window. */
  width: (typeof WIDTHS)[number];
  /** The thin bar at the very top (free shipping, account links). */
  announcementBar: boolean;
}

export const DEFAULT_LAYOUT: StorefrontLayout = {
  sections: LAYOUT_SECTIONS.map((id) => ({ id, visible: true })),
  productView: 'grid',
  columns: 'auto',
  imageShape: 'square',
  sidebar: 'left',
  width: 'standard',
  announcementBar: true,
};

function pick<T>(field: string, allowed: readonly T[], value: unknown, fallback: T): T {
  if (value === undefined) return fallback;
  if (!allowed.includes(value as T)) throw new AppError(`Invalid layout ${field}.`);
  return value as T;
}

/**
 * A complete layout from what the admin screen sent (or what's stored): fields left out keep their defaults, and blocks missing from
 * `sections` (one added in a later release) go at the end, shown. Null or an empty object is the default layout.
 */
export function storefrontLayout(value: unknown): StorefrontLayout {
  if (value === null || value === undefined) return DEFAULT_LAYOUT;
  if (typeof value !== 'object' || Array.isArray(value)) throw new AppError('Invalid layout.');
  const v = value as Record<string, unknown>;

  let sections = DEFAULT_LAYOUT.sections;
  if (v.sections !== undefined) {
    if (!Array.isArray(v.sections)) throw new AppError('Invalid layout sections.');
    const seen = new Set<string>();
    sections = v.sections.map((s: unknown) => {
      const { id, visible } = (s ?? {}) as { id?: unknown; visible?: unknown };
      if (!LAYOUT_SECTIONS.includes(id as LayoutSection) || seen.has(id as string))
        throw new AppError('Invalid layout sections.');
      seen.add(id as string);
      // the product grid is the shop itself: it can move, never disappear
      return { id: id as LayoutSection, visible: id === 'shop' ? true : visible !== false };
    });
    for (const id of LAYOUT_SECTIONS) if (!seen.has(id)) sections.push({ id, visible: true });
  }

  if (v.announcementBar !== undefined && typeof v.announcementBar !== 'boolean')
    throw new AppError('Invalid layout announcementBar.');
  return {
    sections,
    productView: pick('productView', VIEWS, v.productView, DEFAULT_LAYOUT.productView),
    columns: pick('columns', COLUMNS, v.columns, DEFAULT_LAYOUT.columns),
    imageShape: pick('imageShape', SHAPES, v.imageShape, DEFAULT_LAYOUT.imageShape),
    sidebar: pick('sidebar', SIDEBARS, v.sidebar, DEFAULT_LAYOUT.sidebar),
    width: pick('width', WIDTHS, v.width, DEFAULT_LAYOUT.width),
    announcementBar: v.announcementBar ?? DEFAULT_LAYOUT.announcementBar,
  };
}
