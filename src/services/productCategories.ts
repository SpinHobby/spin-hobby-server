// Flat, AmiAmi-style product taxonomy for cashier-entered items. Deliberately
// separate from the pre-existing Square category list, which has years of
// organic duplicates and typos ("Badge"/"Badges"/"Badeg", "Card"/"TCG"/
// "TCG Suply", franchise names used as categories, etc.) - reorganizing that
// is a bigger, separate cleanup. This list is only what new cashier-entered
// items get classified into going forward.
export const PRODUCT_CATEGORIES = [
  "Bishoujo Figures",
  "Action Figures",
  "Nendoroids & Chibi Figures",
  "Plushies",
  "Keychains & Straps",
  "Acrylic Stands",
  "Badges & Pins",
  "Trading Cards & TCG",
  "Apparel",
  "Home Goods",
  "Posters & Tapestries",
  "Stationery & Stickers",
  "Cosplay",
  "Other",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
