/**
 * The sample catalog for staging and local development: a category tree and about a hundred
 * products across every state the store knows (in stock, low stock, sold out, pre-order, backorder,
 * hidden, on sale), plus the people whose sample orders go with them. Nothing here is real stock;
 * the product pictures are drawn by images.ts. Every product id starts with SAMPLE_PREFIX, so the
 * whole set can be found and removed again.
 */
export const SAMPLE_PREFIX = 'sample-';

/** Top-level categories and their children, in display order. */
export const SAMPLE_CATEGORIES: [string, string[]][] = [
  ['Figures', ['Scale Figures', 'Prize Figures', 'Nendoroids', 'figma & Action Figures']],
  ['Model Kits', ['Gunpla', 'Mecha & Vehicle Kits', 'Tools & Paint']],
  ['Plushies', ['Character Plush', 'Mascot Plush']],
  ['Trading Cards', ['Pokémon TCG', 'One Piece Card Game', 'Weiss Schwarz', 'Union Arena']],
  ['Goods', ['Acrylic Stands', 'Badges & Pins', 'Keychains', 'Blind Boxes', 'Apparel', 'Posters & Tapestries']],
  ['Books & Media', ['Manga', 'Art Books', 'Music', 'Blu-ray & DVD']],
];

/** What the picture shows (images.ts draws one illustration per kind). */
export type Kind =
  | 'figure' | 'prize' | 'nendoroid' | 'figma' | 'gunpla' | 'mecha' | 'car' | 'nipper' | 'marker' | 'bottle'
  | 'plush' | 'booster' | 'deck' | 'acrylic' | 'badge' | 'pin' | 'keychain' | 'blindbox' | 'shirt' | 'hoodie' | 'cap'
  | 'tapestry' | 'poster' | 'manga' | 'artbook' | 'cd' | 'bluray';

export type Availability = 'auto' | 'preorder' | 'backorder' | 'hidden';

/**
 * Character products and figures get a portrait of an anime character as their main picture, from
 * thiswaifudoesnotexist.net: AI-generated art with no rights holder, one fixed picture per seed, so
 * each product keeps the same face. The drawn illustration (images.ts) is their second picture.
 */
const PORTRAIT_KINDS = new Set<Kind>(['figure', 'prize', 'nendoroid', 'figma', 'acrylic', 'badge', 'pin', 'keychain', 'shirt', 'hoodie', 'cap', 'tapestry', 'poster', 'manga', 'artbook', 'cd', 'bluray']);
const PORTRAIT_SEEDS = 100000;
/** Hand-picked replacements for seeds whose picture did not suit a shop (slug -> seed). */
const PORTRAIT_OVERRIDES: Record<string, number> = {};

export const portraitUrl = (seed: number) => `https://www.thiswaifudoesnotexist.net/example-${seed}.jpg`;

export interface SampleProduct {
  id: string;
  slug: string;
  /** The character portrait, when the product is the kind that has one. */
  photo: string | null;
  name: string;
  category: string;
  series: string;
  character: string | null;
  maker: string | null;
  priceCents: number;
  compareAtCents: number | null;
  availability: Availability;
  /** null = not tracked (always orderable) */
  stock: number | null;
  /** YYYY-MM-01 for pre-orders */
  release: string | null;
  orderByDays: number | null;
  rank: number;
  featured: boolean;
  kind: Kind;
  description: string;
  jan: string;
}

// name, category, series, character ('' for none), maker, price in CAD, status, popularity rank, picture kind, flags...
// status: 'in:N' (N in stock), 'out' (sold out), 'open' (stock not tracked), 'pre:YYYY-MM:D' (pre-order
//         releasing that month, order by D days from now), 'back' (backorder), 'hidden:N' (kept off the storefront)
// flags:  'featured', 'sale:P' (P percent off, the regular price shown struck through)
type Row = [string, string, string, string, string, number, string, number, Kind, ...string[]];

const ROWS: Row[] = [
  // ---- Figures: Scale Figures
  ['Hatsune Miku: Magical Mirai 2025 Ver. 1/7 Scale Figure', 'Scale Figures', 'Vocaloid', 'Hatsune Miku', 'Good Smile Company', 289, 'pre:2027-04:45', 1, 'figure', 'featured'],
  ['Frieren 1/7 Scale Figure', 'Scale Figures', 'Frieren: Beyond Journey\'s End', 'Frieren', 'Good Smile Company', 259, 'pre:2027-02:30', 3, 'figure', 'featured'],
  ['Marin Kitagawa: Swimsuit Ver. 1/7 Scale Figure', 'Scale Figures', 'My Dress-Up Darling', 'Marin Kitagawa', 'Max Factory', 279, 'in:2', 5, 'figure'],
  ['Nezuko Kamado 1/8 Scale Figure', 'Scale Figures', 'Demon Slayer', 'Nezuko Kamado', 'Aniplex', 229, 'in:4', 12, 'figure', 'sale:15'],
  ['Satoru Gojo 1/7 Scale Figure', 'Scale Figures', 'Jujutsu Kaisen', 'Satoru Gojo', 'Good Smile Company', 249, 'out', 7, 'figure'],
  ['Raiden Shogun 1/7 Scale Figure', 'Scale Figures', 'Genshin Impact', 'Raiden Shogun', 'APEX', 339, 'pre:2027-06:60', 9, 'figure', 'featured'],
  ['Power 1/7 Scale Figure', 'Scale Figures', 'Chainsaw Man', 'Power', 'Kadokawa', 219, 'in:3', 15, 'figure'],
  ['Asuka Langley: Plugsuit Ver. 1/7 Scale Figure', 'Scale Figures', 'Evangelion', 'Asuka Langley', 'Alter', 269, 'in:1', 18, 'figure'],
  ['Yor Forger: Party Dress Ver. 1/7 Scale Figure', 'Scale Figures', 'Spy x Family', 'Yor Forger', 'Kotobukiya', 249, 'back', 20, 'figure'],
  ['Firefly 1/7 Scale Figure', 'Scale Figures', 'Honkai: Star Rail', 'Firefly', 'APEX', 319, 'pre:2027-05:50', 6, 'figure'],
  // ---- Figures: Prize Figures
  ['Hatsune Miku Luminasta Figure', 'Prize Figures', 'Vocaloid', 'Hatsune Miku', 'SEGA', 36, 'in:12', 2, 'prize', 'featured'],
  ['Tanjiro Kamado Vibration Stars Figure', 'Prize Figures', 'Demon Slayer', 'Tanjiro Kamado', 'Banpresto', 32, 'in:9', 10, 'prize'],
  ['Zero Two Noodle Stopper Figure', 'Prize Figures', 'Darling in the Franxx', 'Zero Two', 'FuRyu', 34, 'in:15', 14, 'prize'],
  ['Hitori Gotoh SPM Figure', 'Prize Figures', 'Bocchi the Rock!', 'Hitori Gotoh', 'SEGA', 38, 'in:6', 8, 'prize'],
  ['Anya Forger Trio-Try-iT Figure', 'Prize Figures', 'Spy x Family', 'Anya Forger', 'FuRyu', 34, 'in:20', 11, 'prize', 'sale:10'],
  ['Makima Prize Figure', 'Prize Figures', 'Chainsaw Man', 'Makima', 'SEGA', 36, 'out', 16, 'prize'],
  ['Son Goku Super Saiyan Blue Prize Figure', 'Prize Figures', 'Dragon Ball Super', 'Son Goku', 'Banpresto', 42, 'in:7', 22, 'prize'],
  ['Megumin Prize Figure', 'Prize Figures', 'KonoSuba', 'Megumin', 'SEGA', 36, 'in:5', 25, 'prize'],
  ['Rem Precious Figure', 'Prize Figures', 'Re:ZERO', 'Rem', 'Taito', 38, 'in:11', 19, 'prize'],
  ['Gawr Gura Prize Figure', 'Prize Figures', 'hololive', 'Gawr Gura', 'SEGA', 36, 'pre:2026-12:20', 13, 'prize'],
  // ---- Figures: Nendoroids
  ['Nendoroid Hatsune Miku: Snow Miku 2026 Ver.', 'Nendoroids', 'Vocaloid', 'Hatsune Miku', 'Good Smile Company', 84, 'pre:2027-01:25', 4, 'nendoroid', 'featured'],
  ['Nendoroid Frieren', 'Nendoroids', 'Frieren: Beyond Journey\'s End', 'Frieren', 'Good Smile Company', 74, 'in:3', 17, 'nendoroid'],
  ['Nendoroid Anya Forger', 'Nendoroids', 'Spy x Family', 'Anya Forger', 'Good Smile Company', 69, 'in:8', 21, 'nendoroid'],
  ['Nendoroid Satoru Gojo', 'Nendoroids', 'Jujutsu Kaisen', 'Satoru Gojo', 'Good Smile Company', 74, 'out', 23, 'nendoroid'],
  ['Nendoroid Kirby: 30th Anniversary Ver.', 'Nendoroids', 'Kirby', 'Kirby', 'Good Smile Company', 79, 'in:2', 26, 'nendoroid'],
  ['Nendoroid Ellen Joe', 'Nendoroids', 'Zenless Zone Zero', 'Ellen Joe', 'Good Smile Company', 79, 'pre:2027-03:40', 24, 'nendoroid'],
  ['Nendoroid Denji', 'Nendoroids', 'Chainsaw Man', 'Denji', 'Good Smile Company', 69, 'in:6', 30, 'nendoroid', 'sale:10'],
  ['Nendoroid Doll Sailor Moon', 'Nendoroids', 'Sailor Moon', 'Usagi Tsukino', 'Good Smile Company', 99, 'pre:2027-02:35', 28, 'nendoroid'],
  // ---- Figures: figma & Action Figures
  ['figma Hatsune Miku V4X', 'figma & Action Figures', 'Vocaloid', 'Hatsune Miku', 'Max Factory', 119, 'in:2', 27, 'figma'],
  ['S.H.Figuarts Son Goku: Legendary Super Saiyan', 'figma & Action Figures', 'Dragon Ball Z', 'Son Goku', 'Bandai Spirits', 109, 'in:4', 29, 'figma'],
  ['figma Frieren', 'figma & Action Figures', 'Frieren: Beyond Journey\'s End', 'Frieren', 'Max Factory', 109, 'pre:2027-04:30', 31, 'figma'],
  ['S.H.Figuarts Tanjiro Kamado', 'figma & Action Figures', 'Demon Slayer', 'Tanjiro Kamado', 'Bandai Spirits', 94, 'in:3', 33, 'figma'],
  ['Pop Up Parade Marin Kitagawa', 'figma & Action Figures', 'My Dress-Up Darling', 'Marin Kitagawa', 'Good Smile Company', 64, 'in:9', 32, 'figure'],
  ['Pop Up Parade Makima', 'figma & Action Figures', 'Chainsaw Man', 'Makima', 'Good Smile Company', 59, 'in:7', 34, 'figure', 'sale:20'],
  // ---- Model Kits: Gunpla
  ['HG 1/144 RX-78-2 Gundam (Revival Ver.)', 'Gunpla', 'Mobile Suit Gundam', 'RX-78-2 Gundam', 'Bandai Spirits', 29, 'in:25', 35, 'gunpla', 'featured'],
  ['HG 1/144 Gundam Aerial', 'Gunpla', 'The Witch from Mercury', 'Gundam Aerial', 'Bandai Spirits', 36, 'in:14', 36, 'gunpla'],
  ['RG 1/144 Nu Gundam', 'Gunpla', 'Char\'s Counterattack', 'Nu Gundam', 'Bandai Spirits', 69, 'in:5', 37, 'gunpla'],
  ['RG 1/144 Sazabi', 'Gunpla', 'Char\'s Counterattack', 'Sazabi', 'Bandai Spirits', 74, 'in:2', 40, 'gunpla'],
  ['MG 1/100 Unicorn Gundam Ver.Ka', 'Gunpla', 'Gundam Unicorn', 'Unicorn Gundam', 'Bandai Spirits', 109, 'in:3', 38, 'gunpla'],
  ['MG 1/100 Freedom Gundam Ver. 2.0', 'Gunpla', 'Gundam SEED', 'Freedom Gundam', 'Bandai Spirits', 79, 'in:6', 42, 'gunpla'],
  ['PG Unleashed 1/60 RX-78-2 Gundam', 'Gunpla', 'Mobile Suit Gundam', 'RX-78-2 Gundam', 'Bandai Spirits', 389, 'pre:2027-01:40', 45, 'gunpla'],
  ['HG 1/144 Gundam Calibarn', 'Gunpla', 'The Witch from Mercury', 'Gundam Calibarn', 'Bandai Spirits', 42, 'out', 44, 'gunpla'],
  ['Entry Grade 1/144 Strike Gundam', 'Gunpla', 'Gundam SEED', 'Strike Gundam', 'Bandai Spirits', 19, 'in:30', 39, 'gunpla'],
  ['HG 1/144 Char\'s Zaku II', 'Gunpla', 'Mobile Suit Gundam', 'Zaku II', 'Bandai Spirits', 29, 'in:11', 46, 'gunpla', 'sale:10'],
  // ---- Model Kits: Mecha & Vehicle Kits
  ['30 Minutes Missions: EXM-A9k Spinatio (Knight Type)', 'Mecha & Vehicle Kits', '30 Minutes Missions', '', 'Bandai Spirits', 24, 'in:8', 50, 'mecha'],
  ['RG Evangelion Unit-01', 'Mecha & Vehicle Kits', 'Evangelion', 'Unit-01', 'Bandai Spirits', 64, 'in:4', 48, 'mecha'],
  ['Frame Arms Girl: Gourai', 'Mecha & Vehicle Kits', 'Frame Arms Girl', 'Gourai', 'Kotobukiya', 69, 'in:3', 55, 'figma'],
  ['1/24 Nissan Skyline GT-R (R34)', 'Mecha & Vehicle Kits', 'Tamiya Sports Car Series', '', 'Tamiya', 49, 'in:6', 60, 'car'],
  // ---- Model Kits: Tools & Paint
  ['GodHand Ultimate Nipper 5.0', 'Tools & Paint', 'GodHand', '', 'GodHand', 79, 'in:4', 41, 'nipper', 'featured'],
  ['Gundam Marker Basic Set (6 markers)', 'Tools & Paint', 'Gundam Marker', '', 'GSI Creos', 24, 'in:18', 47, 'marker'],
  ['Mr. Hobby Top Coat Flat (88 ml)', 'Tools & Paint', 'Mr. Hobby', '', 'GSI Creos', 12, 'in:22', 56, 'bottle'],
  ['Bandai Entry Nipper', 'Tools & Paint', 'Bandai Hobby', '', 'Bandai Spirits', 12, 'in:30', 52, 'nipper'],
  // ---- Plushies: Character Plush
  ['Hatsune Miku Fuwa Fuwa Plush (20 cm)', 'Character Plush', 'Vocaloid', 'Hatsune Miku', 'Taito', 34, 'in:10', 43, 'plush', 'featured'],
  ['Frieren Chibi Plush', 'Character Plush', 'Frieren: Beyond Journey\'s End', 'Frieren', 'Good Smile Company', 32, 'in:6', 49, 'plush'],
  ['Anya Forger Plush (25 cm)', 'Character Plush', 'Spy x Family', 'Anya Forger', 'Bandai', 36, 'in:8', 51, 'plush'],
  ['Nezuko Kamado Mochi Plush', 'Character Plush', 'Demon Slayer', 'Nezuko Kamado', 'Banpresto', 28, 'in:15', 53, 'plush'],
  ['Pochita Plush (30 cm)', 'Character Plush', 'Chainsaw Man', 'Pochita', 'Taito', 42, 'in:3', 54, 'plush'],
  ['Bond Forger Big Plush (40 cm)', 'Character Plush', 'Spy x Family', 'Bond Forger', 'Bandai', 55, 'pre:2026-12:15', 58, 'plush'],
  ['Gawr Gura Shark Plush', 'Character Plush', 'hololive', 'Gawr Gura', 'Cover Corp.', 39, 'out', 59, 'plush'],
  ['Kirby Plush (25 cm)', 'Character Plush', 'Kirby', 'Kirby', 'Sanei', 34, 'in:12', 57, 'plush'],
  // ---- Plushies: Mascot Plush
  ['Spin Hobby Mascot Plush (20 cm)', 'Mascot Plush', 'Spin Hobby', 'Spin', 'Spin Hobby', 32, 'in:20', 62, 'plush', 'featured'],
  ['Pikachu Sleeping Plush', 'Mascot Plush', 'Pokémon', 'Pikachu', 'Pokémon Center', 36, 'in:9', 61, 'plush'],
  ['Totoro Plush (30 cm)', 'Mascot Plush', 'Studio Ghibli', 'Totoro', 'Sun Arrow', 48, 'in:4', 63, 'plush'],
  ['Chiikawa Plush', 'Mascot Plush', 'Chiikawa', 'Chiikawa', 'Bandai', 29, 'in:14', 64, 'plush'],
  // ---- Trading Cards: Pokémon TCG
  ['Pokémon TCG: Prismatic Evolutions Booster Box', 'Pokémon TCG', 'Pokémon', '', 'The Pokémon Company', 189, 'in:2', 65, 'booster', 'featured'],
  ['Pokémon TCG: Elite Trainer Box', 'Pokémon TCG', 'Pokémon', '', 'The Pokémon Company', 69, 'in:6', 66, 'deck'],
  ['Pokémon TCG (Japanese): Terastal Festival Booster Box', 'Pokémon TCG', 'Pokémon', '', 'The Pokémon Company', 99, 'in:3', 67, 'booster'],
  ['Pokémon TCG: Booster Pack', 'Pokémon TCG', 'Pokémon', '', 'The Pokémon Company', 7, 'in:80', 70, 'booster'],
  ['Pokémon TCG: 151 Ultra-Premium Collection', 'Pokémon TCG', 'Pokémon', '', 'The Pokémon Company', 169, 'out', 69, 'deck'],
  // ---- Trading Cards: One Piece Card Game
  ['One Piece Card Game: OP-10 Booster Box', 'One Piece Card Game', 'One Piece', '', 'Bandai', 129, 'in:4', 68, 'booster'],
  ['One Piece Card Game: Starter Deck - Straw Hat Crew', 'One Piece Card Game', 'One Piece', 'Monkey D. Luffy', 'Bandai', 19, 'in:15', 73, 'deck'],
  ['One Piece Card Game: Premium Card Collection', 'One Piece Card Game', 'One Piece', '', 'Bandai', 59, 'pre:2026-12:20', 74, 'deck'],
  // ---- Trading Cards: Weiss Schwarz
  ['Weiss Schwarz: hololive production Vol. 3 Booster Box', 'Weiss Schwarz', 'hololive', '', 'Bushiroad', 119, 'in:3', 72, 'booster'],
  ['Weiss Schwarz: Bocchi the Rock! Trial Deck', 'Weiss Schwarz', 'Bocchi the Rock!', '', 'Bushiroad', 24, 'in:8', 76, 'deck'],
  // ---- Trading Cards: Union Arena
  ['Union Arena: Jujutsu Kaisen Booster Box', 'Union Arena', 'Jujutsu Kaisen', '', 'Bandai', 89, 'in:5', 75, 'booster'],
  ['Union Arena: Chainsaw Man Starter Deck', 'Union Arena', 'Chainsaw Man', '', 'Bandai', 19, 'in:10', 80, 'deck'],
  // ---- Goods: Acrylic Stands
  ['Hatsune Miku Acrylic Stand: Spring Ver.', 'Acrylic Stands', 'Vocaloid', 'Hatsune Miku', 'Good Smile Company', 22, 'in:12', 71, 'acrylic'],
  ['Frieren & Fern Acrylic Stand Set', 'Acrylic Stands', 'Frieren: Beyond Journey\'s End', 'Frieren', 'Movic', 34, 'in:6', 77, 'acrylic'],
  ['Satoru Gojo Acrylic Stand', 'Acrylic Stands', 'Jujutsu Kaisen', 'Satoru Gojo', 'Movic', 22, 'in:9', 79, 'acrylic'],
  ['Hoshimachi Suisei Acrylic Stand', 'Acrylic Stands', 'hololive', 'Hoshimachi Suisei', 'Cover Corp.', 24, 'in:4', 82, 'acrylic'],
  ['Shiroko Acrylic Stand', 'Acrylic Stands', 'Blue Archive', 'Shiroko', 'Yostar', 22, 'in:7', 85, 'acrylic'],
  // ---- Goods: Badges & Pins
  ['Demon Slayer Can Badge Set (8 pcs)', 'Badges & Pins', 'Demon Slayer', '', 'Ensky', 32, 'in:5', 78, 'badge'],
  ['Anya Forger Enamel Pin', 'Badges & Pins', 'Spy x Family', 'Anya Forger', 'Crunchyroll', 12, 'in:20', 83, 'pin'],
  ['Oshi no Ko Trading Can Badge (blind)', 'Badges & Pins', 'Oshi no Ko', '', 'Movic', 6, 'in:60', 81, 'badge'],
  ['NERV Logo Enamel Pin', 'Badges & Pins', 'Evangelion', '', 'Movic', 14, 'in:10', 90, 'pin'],
  // ---- Goods: Keychains
  ['Pochita Acrylic Keychain', 'Keychains', 'Chainsaw Man', 'Pochita', 'Movic', 12, 'in:25', 84, 'keychain'],
  ['Hu Tao Chibi Keychain', 'Keychains', 'Genshin Impact', 'Hu Tao', 'miHoYo', 14, 'in:15', 86, 'keychain'],
  ['Nijika Ijichi Rubber Strap', 'Keychains', 'Bocchi the Rock!', 'Nijika Ijichi', 'Movic', 12, 'in:12', 88, 'keychain'],
  ['Kirby Plush Keychain', 'Keychains', 'Kirby', 'Kirby', 'Sanei', 16, 'in:18', 87, 'keychain'],
  // ---- Goods: Blind Boxes
  ['POP MART x Hatsune Miku Blind Box', 'Blind Boxes', 'Vocaloid', 'Hatsune Miku', 'POP MART', 22, 'in:36', 89, 'blindbox', 'featured'],
  ['Chiikawa Mini Figure Blind Box', 'Blind Boxes', 'Chiikawa', '', 'Bandai', 14, 'in:48', 91, 'blindbox'],
  ['Sanrio Characters Mystery Capsule', 'Blind Boxes', 'Sanrio', '', 'Bandai', 8, 'in:100', 95, 'blindbox'],
  ['Demon Slayer Chibi Figure Blind Box', 'Blind Boxes', 'Demon Slayer', '', 'Bandai', 14, 'out', 93, 'blindbox'],
  // ---- Goods: Apparel
  ['Hatsune Miku Graphic T-Shirt (L)', 'Apparel', 'Vocaloid', 'Hatsune Miku', 'Crunchyroll', 42, 'in:5', 92, 'shirt'],
  ['RX-78-2 Gundam Hoodie (M)', 'Apparel', 'Mobile Suit Gundam', 'RX-78-2 Gundam', 'Bandai', 79, 'in:3', 96, 'hoodie'],
  ['Jujutsu Kaisen Embroidered Cap', 'Apparel', 'Jujutsu Kaisen', '', 'Crunchyroll', 36, 'in:7', 98, 'cap', 'sale:15'],
  // ---- Goods: Posters & Tapestries
  ['Frieren B2 Wall Tapestry', 'Posters & Tapestries', 'Frieren: Beyond Journey\'s End', 'Frieren', 'Movic', 45, 'pre:2026-12:25', 94, 'tapestry'],
  ['Genshin Impact A3 Poster Set (5 pcs)', 'Posters & Tapestries', 'Genshin Impact', '', 'miHoYo', 24, 'in:10', 97, 'poster'],
  ['Evangelion Unit-01 B2 Tapestry', 'Posters & Tapestries', 'Evangelion', 'Unit-01', 'Movic', 45, 'in:2', 99, 'tapestry'],
  // ---- Books & Media: Manga
  ['Frieren: Beyond Journey\'s End Vol. 1', 'Manga', 'Frieren: Beyond Journey\'s End', '', 'VIZ Media', 14, 'in:20', 100, 'manga'],
  ['Chainsaw Man Vol. 1', 'Manga', 'Chainsaw Man', '', 'VIZ Media', 14, 'in:18', 101, 'manga'],
  ['Oshi no Ko Vol. 1', 'Manga', 'Oshi no Ko', '', 'Yen Press', 16, 'in:12', 102, 'manga'],
  ['Spy x Family Vol. 1', 'Manga', 'Spy x Family', '', 'VIZ Media', 14, 'in:16', 104, 'manga'],
  // ---- Books & Media: Art Books
  ['Frieren Official Art Book', 'Art Books', 'Frieren: Beyond Journey\'s End', '', 'Shogakukan', 48, 'in:4', 103, 'artbook'],
  ['Genshin Impact Official Art Book Vol. 2', 'Art Books', 'Genshin Impact', '', 'miHoYo', 59, 'in:3', 106, 'artbook'],
  ['Hatsune Miku 2025 Illustration Collection', 'Art Books', 'Vocaloid', 'Hatsune Miku', 'KADOKAWA', 52, 'pre:2027-01:30', 105, 'artbook'],
  // ---- Books & Media: Music
  ['Bocchi the Rock! Complete Soundtrack', 'Music', 'Bocchi the Rock!', '', 'Aniplex', 42, 'in:5', 107, 'cd'],
  ['Frieren: Beyond Journey\'s End Original Soundtrack', 'Music', 'Frieren: Beyond Journey\'s End', '', 'Toho Animation', 38, 'in:6', 109, 'cd', 'sale:20'],
  ['YOASOBI "THE BOOK 3"', 'Music', 'YOASOBI', '', 'Sony Music', 34, 'in:8', 110, 'cd'],
  // ---- Books & Media: Blu-ray & DVD
  ['Hatsune Miku Magical Mirai 2025 Live Blu-ray', 'Blu-ray & DVD', 'Vocaloid', 'Hatsune Miku', 'Crypton Future Media', 89, 'pre:2027-02:30', 108, 'bluray'],
  ['Demon Slayer: Infinity Castle Blu-ray', 'Blu-ray & DVD', 'Demon Slayer', '', 'Aniplex', 49, 'in:4', 111, 'bluray'],
  ['Evangelion: 3.0+1.0 Thrice Upon a Time Blu-ray', 'Blu-ray & DVD', 'Evangelion', '', 'Khara', 44, 'in:5', 112, 'bluray'],
  // ---- kept off the storefront (admin only), to test hidden products
  ['Convention Exclusive Bundle (staff only)', 'Blind Boxes', 'Spin Hobby', '', 'Spin Hobby', 60, 'hidden:5', 113, 'blindbox'],
];

const BLURB: Record<Kind, string> = {
  figure: 'Painted, pre-assembled PVC figure with a dedicated display base.',
  prize: 'Prize figure as won from Japanese crane games, in its original box.',
  nendoroid: 'Articulated chibi figure with interchangeable face plates and parts.',
  figma: 'Fully articulated action figure with extra hands and accessories.',
  gunpla: 'Snap-fit plastic model kit. No glue or paint needed.',
  mecha: 'Plastic model kit with articulated joints. No glue needed.',
  car: 'Scale plastic model kit with decals. Cement and paint required.',
  nipper: 'Single-edge nipper for clean gate cuts on plastic model kits.',
  marker: 'Paint markers for panel lines and touch-ups on plastic kits.',
  bottle: 'Spray-on finish for painted and unpainted plastic models.',
  plush: 'Soft, huggable plush with embroidered details.',
  booster: 'Sealed booster product. Contents are random.',
  deck: 'Sealed deck or collection box with everything needed to play.',
  acrylic: 'Printed acrylic standee with a clear base, about 12 cm tall.',
  badge: 'Tin badges with a pin back.',
  pin: 'Hard enamel pin with a rubber clutch.',
  keychain: 'Charm on a metal ball chain.',
  blindbox: 'One random figure per sealed box.',
  shirt: '100% cotton tee with a screen-printed graphic.',
  hoodie: 'Pullover hoodie with a printed chest graphic.',
  cap: 'Adjustable cap with embroidered artwork.',
  tapestry: 'B2-size fabric wall scroll with hanging rods.',
  poster: 'Printed posters on heavyweight paper.',
  manga: 'English-language paperback volume.',
  artbook: 'Hardcover collection of illustrations and concept art.',
  cd: 'Audio CD in a jewel case.',
  bluray: 'Region-free Blu-ray disc with an outer sleeve.',
};

export const slugify = (text: string) =>
  text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

function parse(row: Row, i: number, slugs: Set<string>): SampleProduct {
  const [name, category, series, character, maker, price, status, rank, kind, ...flags] = row;
  let slug = slugify(name);
  if (slugs.has(slug)) slug = `${slug}-${i + 1}`;
  slugs.add(slug);
  let seed = 17;
  for (const ch of slug) seed = (seed * 31 + ch.charCodeAt(0)) % PORTRAIT_SEEDS;
  seed = PORTRAIT_OVERRIDES[slug] ?? seed;
  const [state, a, b] = status.split(':');
  const availability: Availability = state === 'pre' ? 'preorder' : state === 'back' ? 'backorder' : state === 'hidden' ? 'hidden' : 'auto';
  const stock = state === 'in' || state === 'hidden' ? Number(a) : state === 'out' ? 0 : null;
  const sale = flags.find((f) => f.startsWith('sale:'));
  const discount = sale ? Number(sale.slice(5)) : 0;
  return {
    id: `${SAMPLE_PREFIX}${slug}`,
    slug,
    photo: PORTRAIT_KINDS.has(kind) ? portraitUrl(seed) : null,
    name,
    category,
    series,
    character: character || null,
    maker: maker || null,
    priceCents: discount ? Math.round(price * (100 - discount)) : price * 100,
    compareAtCents: discount ? price * 100 : null,
    availability,
    stock,
    release: state === 'pre' ? `${a}-01` : null,
    orderByDays: state === 'pre' ? Number(b) : null,
    rank,
    featured: flags.includes('featured'),
    kind,
    description: `${BLURB[kind]} ${series}${maker ? `, by ${maker}` : ''}. Sample listing: nothing on the staging store is real stock.`,
    jan: `4580${String(100000000 + i * 7919).slice(-9)}`,
  };
}

const slugs = new Set<string>();
export const SAMPLE_PRODUCTS: SampleProduct[] = ROWS.map((row, i) => parse(row, i, slugs));
const BY_SLUG = new Map(SAMPLE_PRODUCTS.map((p) => [p.slug, p]));
export const sampleProductBySlug = (slug: string) => BY_SLUG.get(slug);

/** Homepage banners. A slide without an image shows the mascot instead. */
export const SAMPLE_SLIDES: { headline: string; subheading: string; banner: number | null }[] = [
  { headline: 'New arrivals every week', subheading: 'Fresh figures, badges and plushies added regularly.', banner: null },
  { headline: 'Spring 2027 pre-order fair', subheading: 'Reserve the season\'s scale figures before their order-by dates.', banner: 1 },
  { headline: 'Gunpla restock', subheading: 'HG, RG and MG kits are back on the shelf.', banner: 2 },
];

/** Customers for the sample orders. */
export const SAMPLE_PEOPLE: [string, string, string, string, string][] = [
  ['Aisha', 'Nguyen', '112 Main St SW', 'Calgary', 'AB'],
  ['Marc', 'Tremblay', '48 Jasper Ave', 'Edmonton', 'AB'],
  ['Kenji', 'Sato', '900 Robson St', 'Vancouver', 'BC'],
  ['Jasleen', 'Singh', '25 Queen St W', 'Toronto', 'ON'],
  ['Olivia', 'Martin', '300 Rue Sainte-Catherine', 'Montréal', 'QC'],
  ['Liam', 'Chen', '77 Portage Ave', 'Winnipeg', 'MB'],
  ['Sofia', 'Rossi', '14 Water St', 'Halifax', 'NS'],
  ['Noah', 'Kim', '1200 Victoria Ave', 'Regina', 'SK'],
  ['Emma', 'Dubois', '5 Wellington St', 'Ottawa', 'ON'],
  ['Ethan', 'Patel', '620 8 Ave SW', 'Calgary', 'AB'],
  ['Mia', 'Wong', '1055 W Georgia St', 'Vancouver', 'BC'],
  ['Lucas', 'Brown', '200 Yonge St', 'Toronto', 'ON'],
];
