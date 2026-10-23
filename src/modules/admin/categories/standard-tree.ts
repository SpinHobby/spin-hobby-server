// A ready-made category tree modelled on AmiAmi's (Figures > Bishoujo Figures, Character Goods > Plush, ...), and the
// rules that suggest where a product belongs in it from its name and its Square category. Suggestions are only ever
// shown to a person, who applies them; nothing here changes a product by itself.

export interface StandardCategory {
  name: string;
  children: string[];
}

export const STANDARD_TREE: StandardCategory[] = [
  {
    name: 'Figures',
    children: [
      'Bishoujo Figures',
      'Character Figures',
      'Kuji Prize Figures',
      'Action Figures',
      'Chibi Figures',
      'Trading & Blind Box Figures',
      'Dolls',
    ],
  },
  {
    name: 'Character Goods',
    children: [
      'Acrylic Stands & Keychains',
      'Can Badges & Pins',
      'Plush',
      'Tapestries & Posters',
      'Fashion & Bags',
      'Stationery',
      'Household Goods',
      'Calendars',
    ],
  },
  { name: 'Trading Cards', children: ['Card Games', 'Trading Cards', 'Card Supplies'] },
  {
    name: 'Books & Media',
    children: ['Books & Manga', 'Art Books', 'Blu-ray & DVD', 'CDs', 'Video Games'],
  },
  { name: 'Toys & Puzzles', children: ['Tokusatsu Toys', "Kids' Toys", 'Jigsaw Puzzles'] },
];

/** A figure of a girl character is a bishoujo figure; any other character's is a character figure (AmiAmi's split). */
export const FIGURE_CHOICES = ['Bishoujo Figures', 'Character Figures'] as const;

const KIT =
  /\b(model kit|plastic model|plamo|kit|1\/(35|48|60|72|100|144|700)|hguc|entry grade|30 ?minutes|30mm|30ms|figure-?rise)\b/i;

/**
 * First match wins: the most specific kinds of item come first, plain "figure" last. A null category means the item has no
 * place in the tree (model kits, vehicle models): no suggestion, so it isn't filed as a figure by mistake.
 */
const RULES: [RegExp, string | null, ((text: string) => boolean)?][] = [
  [
    /\b(card )?sleeves?\b|\bplay ?mats?\b|\bdeck ?(box|case)\b|\bcard binder\b|\btop ?loaders?\b/i,
    'Card Supplies',
  ],
  [
    /\b(booster|tcg|ccg|card game|starter deck|structure deck|starter set|pok[eé]mon (card|tcg)|one piece card|yu-?gi-?oh|weiss schwarz|union arena|digimon card|lorcana|magic: the gathering|mtg|battle spirits|vanguard)\b/i,
    'Card Games',
  ],
  [
    /\b(trading cards?|card pack|collection cards?|metallic cards?|clear cards?)\b/i,
    'Trading Cards',
  ],
  // model kits and their tools: not in the tree
  [
    /\b(nippers?|airbrush|primer|top coat|panel liner|gundam marker|hobby paint|mr\.? ?hobby)\b/i,
    null,
  ],
  [/\b(gunpla|gundam)\b/i, null, (t) => KIT.test(t) || /\b(hg|rg|mg|pg|sd|eg)\b/.test(t)],
  [KIT, null],
  [/\b(dolls?|dollfie|obitsu|pullip|blythe|harmonia bloom)\b/i, 'Dolls'],
  [
    /\b(blind ?box|trading figures?|gashapon|gachapon|gacha|capsule toys?|mystery box|random box)\b/i,
    'Trading & Blind Box Figures',
  ],
  // Ichiban Kuji and crane-game prize figures. The prize lines are always figures; "kuji" or "prize" only with a figure word,
  // so a kuji towel or acrylic stand goes on to its own kind
  [
    /\b(luminasta|q ?posket|noodle stopper|spm|trio-try-it|glitter ?& ?glamours|espresto|relax time|figurizma)\b/i,
    'Kuji Prize Figures',
  ],
  [
    /\b(ichiban[ -]?kuji|kuji|prize|banpresto)\b|一番くじ/i,
    'Kuji Prize Figures',
    (t) => /\b(figures?|figurine|statue)\b|フィギュア/i.test(t),
  ],
  [
    /\b(nendoroid|chibi|deformed|look ?up|fuwa ?puchi|puchi|petit|mini figures?|sd figures?)\b/i,
    'Chibi Figures',
  ],
  [
    /\b(figma|s\.?\s?h\.?\s?figuarts|figuarts|revoltech|action figures?|articulated|pos(e)?able|amazing yamaguchi|mafex|threezero|robot spirits|metal build)\b/i,
    'Action Figures',
  ],
  [/\b(plush(ies|ie|y)?|nuigurumi|stuffed|mochi ?mochi|mascot)\b/i, 'Plush'],
  [
    /\b(acrylic|keychains?|key ?chains?|key ?rings?|straps?|charms?|standees?)\b/i,
    'Acrylic Stands & Keychains',
  ],
  [/\b(can badges?|badges?|buttons?|enamel pins?|pins?)\b/i, 'Can Badges & Pins'],
  [
    /\b(tapestry|tapestries|posters?|wall scrolls?|art prints?|shikishi)\b/i,
    'Tapestries & Posters',
  ],
  [/\bcalendars?\b/i, 'Calendars'],
  [/\b(jigsaw|puzzles?)\b/i, 'Jigsaw Puzzles'],
  [/\b(blu-?ray|dvd)\b/i, 'Blu-ray & DVD'],
  [/\b(cd|soundtrack|ost|album|vinyl)\b/i, 'CDs'],
  [
    /\b(art ?books?|art ?works|illustrations? (book|collection)|visual book|fan ?book|setting materials)\b/i,
    'Art Books',
  ],
  [/\b(manga|light novels?|novels?|comics?|vol\.?\s*\d+|volume \d+|books?)\b/i, 'Books & Manga'],
  [/\b(nintendo switch|ps[345]|playstation|xbox|video games?|game software)\b/i, 'Video Games'],
  [
    /\b(t-?shirts?|shirts?|hoodies?|jackets?|caps?|hats?|socks|tote|bags?|backpacks?|pouch(es)?|wallets?|apparel|cosplay|wigs?)\b/i,
    'Fashion & Bags',
  ],
  [
    /\b(stickers?|clear files?|notebooks?|pens?|pencils?|memo pads?|stationery|bookmarks?|postcards?)\b/i,
    'Stationery',
  ],
  [
    /\b(mugs?|cups?|tumblers?|glass(es)?|plates?|towels?|blankets?|pillows?|cushions?|dakimakura|lamps?|clocks?|coasters?|mouse ?pads?|desk mats?|home goods)\b/i,
    'Household Goods',
  ],
  // a car, train or military model has no place in the tree, unless something more specific matched first ("Cars" plush)
  [
    /\b(cars?|nissan|toyota|honda|mazda|subaru|mitsubishi|porsche|ferrari|lamborghini|skyline|gt-?r|trucks?|motorcycles?|trains?|tomica|hot wheels|diecast|die-cast|tank|aircraft|warship|battleship|military|fighter jet)\b/i,
    null,
  ],
  [
    /\b(kamen rider|ultraman|super sentai|power rangers|henshin|dx )\b/i,
    'Tokusatsu Toys',
    (t) => !FIGURE.test(t),
  ],
  [/\b(kids'? toys?|toys?)\b/i, "Kids' Toys"],
];

const FIGURE =
  /\b(figures?|figurine|statue|scale|prize|pop up parade|q ?posket|noodle stopper|luminasta|spm|precious|trio-try-it|glitter ?& ?glamours|espresto|relax time|1\/\d+)\b|フィギュア/i;
const GIRL = /\b(bishoujo|bishojo|girls?|female|women)\b/i;
const OTHER_CHARACTER = /\b(bishounen|bishonen|boys?|male|men|action figures?)\b/i;

export interface Suggestion {
  /** The category name in STANDARD_TREE, or null when a person has to choose. */
  category: string | null;
  /** When a person must choose, the names to choose from (a figure whose character could be a girl or not). */
  choices: string[];
  /** Why: which words led to it. */
  reason: string;
}

/**
 * Where a product probably belongs, from its name first and then its Square category (which may carry the shop's
 * own split, such as "Bishoujo Figures"). Null when nothing points anywhere.
 */
export function suggestCategory(name: string, squareCategory: string | null): Suggestion | null {
  for (const [text, where] of [
    [name, 'name'],
    [squareCategory ?? '', 'Square category'],
  ] as const) {
    if (!text) continue;
    for (const [pattern, category, also] of RULES) {
      // the shop's own Square category "Action Figures" holds figures of male characters, not only poseable ones
      if (where === 'Square category' && category === 'Action Figures') continue;
      const hit = text.match(pattern);
      if (hit && (!also || also(text)))
        return category ? { category, choices: [], reason: `"${hit[0]}" in the ${where}` } : null;
    }
  }
  const figureWord = name.match(FIGURE) ?? squareCategory?.match(FIGURE);
  if (!figureWord) return null;
  // Girl or not: the Square category may already say; otherwise a person picks
  for (const text of [squareCategory ?? '', name]) {
    if (GIRL.test(text))
      return {
        category: 'Bishoujo Figures',
        choices: [],
        reason: `"${text.match(GIRL)![0]}" with "${figureWord[0]}"`,
      };
    if (OTHER_CHARACTER.test(text))
      return {
        category: 'Character Figures',
        choices: [],
        reason: `"${text.match(OTHER_CHARACTER)![0]}" with "${figureWord[0]}"`,
      };
  }
  return {
    category: null,
    choices: [...FIGURE_CHOICES],
    reason: `"${figureWord[0]}" in the name: pick Bishoujo (a girl character) or Character`,
  };
}
