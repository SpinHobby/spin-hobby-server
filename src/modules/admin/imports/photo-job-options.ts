import { AppError } from '../../../common/errors.js';

/** What is done to every photo of a batch. Each step is on unless the admin turned it off; the cut-out onto white is the point of a batch and is always done. */
export interface PhotoJobOptions {
  /** `product` keeps the whole box (the safe choice for a batch); `character` cuts the figure out of a flat cover; `auto` picks. */
  mode: 'product' | 'character' | 'auto';
  /** Take the shop's own price stickers off the picture. */
  stickers: boolean;
  /** Make the picture bigger and sharper with the best model (slow: the point of leaving it overnight). */
  enlarge: boolean;
  /** The brighter, more lively look. */
  look: boolean;
  /**
   * Polish into a clean product photo: the figure alone, with no box print, logos or stickers, on a studio backdrop, drawn by the local model
   * (Gleamshelf's Clean product photo). For closed boxes with art on the front; a window box keeps its plastic. On unless turned off.
   */
  clean: boolean;
  /** Drafts: look for the maker's own official photos on its website, offered as photos to choose. On unless turned off. */
  official: boolean;
  /** How the clean product photo is made (with `clean`). The photo computer decides for each photo whether it is a printed box or a window box. */
  polish: PolishOptions;
}

/**
 * The clean product photo's choices. The photo computer tells a printed box (the character is artwork on the cover) from a window box, bag or
 * blister (the real figure is behind plastic) for each photo, and makes:
 * - a printed box: the character with the box art around it as on the cover (`printed: 'boxart'`), or the character alone (`'figure'`);
 * - a window box, bag or blister: always the figure alone, out of its packaging.
 */
export interface PolishOptions {
  /** A printed box: `boxart` keeps the cover's art around the character, polished; `figure` is the character alone on a backdrop. */
  printed: 'boxart' | 'figure';
  /** Take the title lettering, logos, maker marks and other printed text off (the box-art picture; the figure alone never has them). */
  removeText: boolean;
  /** Behind a figure alone: a soft backdrop in the box art's colours, a dark spotlight with a floor reflection, or plain white. */
  backdrop: 'artwork' | 'dark' | 'white';
  /** A window box, bag or blister: draw the figure from the maker's official photos (its legs and face are hidden by the plastic). */
  makerPhotos: boolean;
}

export const DEFAULT_POLISH: PolishOptions = {
  printed: 'boxart',
  removeText: true,
  backdrop: 'artwork',
  makerPhotos: true,
};

export const DEFAULT_PHOTO_OPTIONS: PhotoJobOptions = {
  mode: 'product',
  stickers: true,
  enlarge: true,
  look: true,
  clean: true,
  official: true,
  polish: { ...DEFAULT_POLISH },
};

const choice = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  name: string,
): T => {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value))
    throw new AppError(`${name} must be ${allowed.join(', ').replace(/, ([^,]*)$/, ' or $1')}.`);
  return value as T;
};

function parsePolish(raw: unknown): PolishOptions {
  if (raw === undefined || raw === null) return { ...DEFAULT_POLISH };
  if (typeof raw !== 'object' || Array.isArray(raw))
    throw new AppError('The polish options are not readable.');
  const p = raw as Record<string, unknown>;
  return {
    printed: choice(
      p.printed,
      ['boxart', 'figure'] as const,
      DEFAULT_POLISH.printed,
      'polish.printed',
    ),
    removeText: flag(p.removeText, DEFAULT_POLISH.removeText, 'polish.removeText'),
    backdrop: choice(
      p.backdrop,
      ['artwork', 'dark', 'white'] as const,
      DEFAULT_POLISH.backdrop,
      'polish.backdrop',
    ),
    makerPhotos: flag(p.makerPhotos, DEFAULT_POLISH.makerPhotos, 'polish.makerPhotos'),
  };
}

const flag = (value: unknown, fallback: boolean, name: string): boolean => {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new AppError(`${name} must be on or off.`);
  return value;
};

/** The options as sent, checked, with the defaults filled in. */
export function parsePhotoOptions(raw: unknown): PhotoJobOptions {
  if (raw === undefined || raw === null) return { ...DEFAULT_PHOTO_OPTIONS };
  if (typeof raw !== 'object' || Array.isArray(raw))
    throw new AppError('The options are not readable.');
  const o = raw as Record<string, unknown>;
  const mode = o.mode ?? DEFAULT_PHOTO_OPTIONS.mode;
  if (mode !== 'product' && mode !== 'character' && mode !== 'auto')
    throw new AppError('mode must be product, character or auto.');
  return {
    mode,
    stickers: flag(o.stickers, true, 'stickers'),
    enlarge: flag(o.enlarge, true, 'enlarge'),
    look: flag(o.look, true, 'look'),
    // options saved before the clean photo existed (or sent by an older admin) are read as they were done: no clean photo
    clean: flag(o.clean, false, 'clean'),
    official: flag(o.official, true, 'official'),
    polish: parsePolish(o.polish),
  };
}

/** What a worker says about a finished photo: only these, cut to size. */
export interface PhotoJobDetails {
  flags: string[];
  notes: string[];
  seconds: number | null;
  modeUsed: string | null;
  productRect: { x: number; y: number; width: number; height: number } | null;
}

const texts = (value: unknown, count: number, max: number): string[] =>
  Array.isArray(value)
    ? value
        .slice(0, count)
        .map((x) => String(x).replace(/\s+/g, ' ').trim().slice(0, max))
        .filter(Boolean)
    : [];

export function parseJobDetails(raw: unknown): PhotoJobDetails {
  const o =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const seconds = Number(o.seconds);
  return {
    flags: texts(o.flags, 20, 300),
    notes: texts(o.notes, 20, 300),
    seconds: Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 10) / 10 : null,
    modeUsed: typeof o.modeUsed === 'string' ? o.modeUsed.slice(0, 20) : null,
    productRect: rect(o.productRect),
  };
}

/** Where the product is in the photo as taken (fractions of its width and height), so the shop can offer a plain crop of it; null when unknown. */
function rect(raw: unknown): { x: number; y: number; width: number; height: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const [x, y, width, height] = [r.x, r.y, r.width, r.height].map(Number);
  const ok =
    [x, y, width, height].every((v) => Number.isFinite(v) && v >= 0 && v <= 1) &&
    width > 0.02 &&
    height > 0.02 &&
    x + width <= 1.001 &&
    y + height <= 1.001;
  return ok ? { x: x, y: y, width: width, height: height } : null;
}
