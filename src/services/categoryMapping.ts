import { PRODUCT_CATEGORIES, ProductCategory } from "./productCategories";

// Square's live category list has 64+ entries accumulated over years of
// manual entry - duplicates, typos, and franchise names used as categories
// ("Badeg"/"Badge"/"Badges", "Genshin", "Figure" x2, etc). Rather than
// editing Square's catalog directly (would require re-tagging every
// affected product), this maps each messy real category onto the same
// clean PRODUCT_CATEGORIES taxonomy the cashier tool already uses, so the
// storefront can show ~14 categories while Square's data stays untouched.
// Unmapped/new category names default to "Other" rather than disappearing.
// `null` means "exclude entirely" (internal-only, not a real product type).
const SQUARE_CATEGORY_NAME_TO_DISPLAY: Record<string, ProductCategory | null> = {
  "bishoujo figures": "Bishoujo Figures",

  "action figures": "Action Figures",
  figure: "Action Figures",
  figures: "Action Figures",
  "figures - open box": "Action Figures",
  "junk figure": "Action Figures",
  "non box figure": "Action Figures",

  plush: "Plushies",
  plushie: "Plushies",
  plushies: "Plushies",
  pulsh: "Plushies",
  "stuffed toy": "Plushies",

  "key chain": "Keychains & Straps",
  "key chains, rubber key chains": "Keychains & Straps",
  straps: "Keychains & Straps",
  "smart phone ring": "Keychains & Straps",

  "acrylic stand": "Acrylic Stands",
  "acrylic stands": "Acrylic Stands",

  badeg: "Badges & Pins",
  badge: "Badges & Pins",
  badges: "Badges & Pins",

  card: "Trading Cards & TCG",
  "card stuffs": "Trading Cards & TCG",
  "clear card": "Trading Cards & TCG",
  tcg: "Trading Cards & TCG",
  "tcg suply": "Trading Cards & TCG",
  "tcg supply": "Trading Cards & TCG",

  clothes: "Apparel",
  cloths: "Apparel",
  "t-shirt": "Apparel",

  bag: "Home Goods",
  blanket: "Home Goods",
  cup: "Home Goods",
  glass: "Home Goods",
  "mouse pad": "Home Goods",
  "mouse pads": "Home Goods",
  picture: "Home Goods",
  pillow: "Home Goods",
  "pillow case": "Home Goods",
  tableware: "Home Goods",
  towle: "Home Goods",
  towles: "Home Goods",

  poster: "Posters & Tapestries",
  "posters, tapestries": "Posters & Tapestries",
  tapestry: "Posters & Tapestries",

  "clear file folder": "Stationery & Stickers",
  sticker: "Stationery & Stickers",

  cosplay: "Cosplay",

  "anime snack": "Other",
  "artist goods": "Other",
  arts: "Other",
  book: "Other",
  "etc.": "Other",
  genshin: "Other",
  hololive: "Other",
  "ichiban kuji": "Other",
  nick: "Other",
  others: "Other",
  pokemon: "Other",
  snacks: "Other",
  yuki: "Other",

  "cashier tool (internal - not on website)": null,
};

export interface SquareCategory {
  id: string;
  name: string;
}

export interface DisplayCategory {
  name: ProductCategory;
  categoryIds: string[];
}

// Groups Square's real categories into the clean display taxonomy. Only
// returns buckets that actually have at least one underlying category.
export function buildDisplayCategories(realCategories: SquareCategory[]): DisplayCategory[] {
  const idsByBucket = new Map<ProductCategory, string[]>();

  for (const cat of realCategories) {
    const key = cat.name.trim().toLowerCase();
    const bucket = key in SQUARE_CATEGORY_NAME_TO_DISPLAY
      ? SQUARE_CATEGORY_NAME_TO_DISPLAY[key]
      : "Other";
    if (bucket === null) continue;

    const existing = idsByBucket.get(bucket);
    if (existing) existing.push(cat.id);
    else idsByBucket.set(bucket, [cat.id]);
  }

  return PRODUCT_CATEGORIES.filter((name) => idsByBucket.has(name)).map((name) => ({
    name,
    categoryIds: idsByBucket.get(name)!,
  }));
}
