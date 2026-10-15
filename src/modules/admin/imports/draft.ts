import { AppError } from '../../../common/errors.js';

/** What the sender says about a draft that is not a column of its own: kept as one JSON document, cut down to known fields and sizes. */
export interface DraftDetails {
  flags: string[];
  highlights: string[];
  unsupported: string[];
  unverifiedNumbers: string[];
  sources: string[];
  /** The product lookup's outcome: did it find the product online, and what was it read as. */
  lookup: { state: string; read: string | null; detail: string } | null;
  /** What the product sells for in North America (asking prices, in CAD) read from real listings; never a price to use without a person looking. */
  market: MarketPrice | null;
  /** The maker's own photo of this exact product, found and confirmed by the app; used only if a person chooses it when adding. */
  official: OfficialPhoto | null;
  generator: string | null;
}

export interface OfficialPhoto {
  imageUrl: string;
  pageUrl: string;
  site: string;
}

/** Makers' and their prize brands' official sites: the only places an official photo is taken from (the server downloads it when it is chosen). */
export const OFFICIAL_SITES = [
  '1kuji.com',
  'bsp-prize.jp',
  'bandaispirits.co.jp',
  'p-bandai.jp',
  'tamashiiweb.com',
  'goodsmile.com',
  'goodsmile.info',
  'goodsmileus.com',
  'furyu-hobby.com',
  'charahiroba.com',
  'segaplaza.jp',
  'sega-prize.com',
  'taito.co.jp',
  'megahouse.co.jp',
  'kotobukiya.co.jp',
  'alter-web.jp',
  'maxfactory.jp',
];

export const isOfficialUrl = (value: string): boolean => {
  try {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      OFFICIAL_SITES.some((s) => u.hostname === s || u.hostname.endsWith(`.${s}`))
    );
  } catch {
    return false;
  }
};

export interface MarketListing {
  title: string;
  url: string;
  site: string;
  price: number;
  currency: 'CAD' | 'USD';
  cad: number;
  condition: 'new' | 'used' | null;
  canadian: boolean;
}

export interface MarketPrice {
  low: number;
  median: number;
  high: number;
  count: number;
  canadian: number;
  rate: number;
  rateIsEstimate: boolean;
  note: string | null;
  listings: MarketListing[];
}

export interface DraftInput {
  sourceKey: string;
  title: string;
  description: string | null;
  category: string | null;
  series: string | null;
  details: DraftDetails;
}

/** Text without control characters (a new line and a tab stay). */
const withoutControls = (value: string) =>
  [...value]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code === 9 || code === 10 || (code >= 32 && code !== 127);
    })
    .join('');

const text = (value: unknown, field: string, max: number, required = false): string | null => {
  if (value == null || value === '') {
    if (required) throw new AppError(`The draft needs a ${field}.`);
    return null;
  }
  if (typeof value !== 'string') throw new AppError(`The draft's ${field} must be text.`);
  const clean = withoutControls(value).trim();
  if (required && !clean) throw new AppError(`The draft needs a ${field}.`);
  return clean.slice(0, max) || null;
};

const list = (value: unknown, field: string, count: number, max: number): string[] => {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new AppError(`The draft's ${field} must be a list.`);
  return value
    .slice(0, count)
    .map((x) => text(typeof x === 'string' ? x : String(x), field, max))
    .filter((x): x is string => !!x);
};

const money = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n < 1_000_000 ? Math.round(n * 100) / 100 : null;
};

/** The market prices as sent, cut to known fields and sizes: only https listing links are kept, and nothing is kept without a price in CAD. */
function parseMarket(raw: unknown): MarketPrice | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const listings: MarketListing[] = [];
  for (const l of Array.isArray(m.listings) ? m.listings.slice(0, 12) : []) {
    if (!l || typeof l !== 'object') continue;
    const o = l as Record<string, unknown>;
    const url = text(o.url, 'listing link', 500);
    const price = money(o.price);
    const cad = money(o.cad);
    if (!url || !/^https:\/\//.test(url) || !price || !cad) continue;
    listings.push({
      title: text(o.title, 'listing title', 160) ?? '',
      url,
      site: text(o.site, 'listing site', 80) ?? '',
      price,
      currency: o.currency === 'USD' ? 'USD' : 'CAD',
      cad,
      condition: o.condition === 'new' || o.condition === 'used' ? o.condition : null,
      canadian: o.canadian === true,
    });
  }
  const low = money(m.low);
  const median = money(m.median);
  const high = money(m.high);
  if (!low || !median || !high || !listings.length) return null;
  const count = Number(m.count);
  const canadian = Number(m.canadian);
  const rate = Number(m.rate);
  return {
    low,
    median,
    high,
    count: Number.isInteger(count) && count > 0 ? Math.min(count, 1000) : listings.length,
    canadian: Number.isInteger(canadian) && canadian >= 0 ? Math.min(canadian, 1000) : 0,
    rate: Number.isFinite(rate) && rate > 0 && rate < 10 ? Math.round(rate * 10000) / 10000 : 0,
    rateIsEstimate: m.rateIsEstimate === true,
    note: text(m.note, 'market note', 300),
    listings,
  };
}

function parseOfficial(raw: unknown): OfficialPhoto | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const imageUrl = text(o.imageUrl, 'official photo', 500);
  const pageUrl = text(o.pageUrl, 'official page', 500);
  if (!imageUrl || !pageUrl || !isOfficialUrl(imageUrl) || !isOfficialUrl(pageUrl)) return null;
  return { imageUrl, pageUrl, site: new URL(pageUrl).hostname.replace(/^www\./, '') };
}

/** Reads and cleans a draft the sender made. Anything it sent beyond these fields is dropped. */
export function parseDraft(raw: unknown): DraftInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new AppError('The draft is not readable.');
  const d = raw as Record<string, unknown>;
  const sourceKey = text(d.sourceKey, 'source key', 128, true)!;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(sourceKey))
    throw new AppError("The draft's source key is not valid.");
  const lookup =
    d.lookup && typeof d.lookup === 'object' ? (d.lookup as Record<string, unknown>) : null;
  return {
    sourceKey,
    title: text(d.title, 'title', 200, true)!,
    description: text(d.description, 'description', 2500),
    category: text(d.category, 'category', 120),
    series: text(d.series, 'series', 120),
    details: {
      flags: list(d.flags, 'flags', 20, 300),
      highlights: list(d.highlights, 'highlights', 8, 200),
      unsupported: list(d.unsupported, 'unsupported', 8, 200),
      unverifiedNumbers: list(d.unverifiedNumbers, 'numbers', 20, 40),
      sources: list(d.sources, 'sources', 12, 500).filter((u) => /^https:\/\//.test(u)),
      lookup: lookup
        ? {
            state: text(lookup.state, 'lookup state', 20) ?? 'off',
            read: text(lookup.read, 'lookup reading', 200),
            detail: text(lookup.detail, 'lookup detail', 400) ?? '',
          }
        : null,
      market: parseMarket(d.market),
      official: parseOfficial(d.official),
      generator: text(d.generator, 'generator', 60),
    },
  };
}
