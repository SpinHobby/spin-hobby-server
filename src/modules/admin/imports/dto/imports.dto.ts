import { AppError } from '../../../../common/errors.js';
import { OptionalText, Rule, Text } from '../../../../common/validation/decorators.js';
import { backgroundChoice } from '../../products/dto/backgrounds.dto.js';
import { QuickAddDto } from '../../products/dto/quick-add.dto.js';

/** A Gleamshelf app trading the code shown in the admin for its token. */
export class PairDto {
  @Text('code', 20)
  code!: string;

  /** What to call this connection in the admin (the computer's name). */
  @OptionalText(80)
  label: string | null = null;
}

/** JSON sent as text next to a photo file (a rule runs twice, clean then check: the second time the text is already parsed). */
const jsonText = (what: string, max: number) => (value: unknown) => {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new AppError(`The ${what} is missing or too long.`);
  try {
    return JSON.parse(value);
  } catch {
    throw new AppError(`The ${what} is not valid JSON.`);
  }
};

/** A draft listing and its photo, sent by a connected app: the draft is JSON in a text field next to the photo file. */
export class ReceiveDraftDto {
  @Rule(jsonText('draft', 40_000))
  draft!: unknown;
}

/** The finished listing of an uploaded photo: the draft and what the app says about the work, next to the photo file. */
export class ListingResultDto {
  @Rule(jsonText('draft', 40_000))
  draft!: unknown;

  @Rule((v) => (v == null || v === '' ? {} : jsonText('details', 20_000)(v)))
  details: unknown = {};
}

/** Which steps to do to uploaded photos (see photo-job-options.ts), as JSON text next to the photo files; anything left out is on. */
export class UploadListingsDto {
  @Rule((v) => (v == null || v === '' ? null : jsonText('options', 2_000)(v)))
  options: unknown = null;
}

export class RejectImportDto {
  @OptionalText(300)
  reason: string | null = null;
}

export class ImportsQuery {
  @Rule((v) => (v === 'added' || v === 'rejected' ? v : 'draft'))
  status: 'draft' | 'added' | 'rejected' = 'draft';
}

const idList = (field: string, max: number) => (value: unknown) => {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > max ||
    value.some((x) => typeof x !== 'string' || !x.trim() || x.length > 64)
  )
    throw new AppError(`${field} must be a list of 1 to ${max} items.`);
  return [...new Set(value.map((x: string) => x.trim()))];
};

/** Photos to improve: some products, and whether to take just each one's main photo or all of its photos. */
export class CreatePhotoBatchDto {
  @Rule(idList('productIds', 100))
  productIds!: string[];

  @Rule((v) => (v === 'all' ? 'all' : 'main'))
  scope: 'main' | 'all' = 'main';

  /** Which steps to do (see photo-job-options.ts); anything left out is on. */
  @Rule((v) => v ?? null)
  options: unknown = null;
}

/** The finished photos to use: the ones named, or every finished photo of the batch when none are named. */
export class ApplyPhotosDto {
  @Rule((v) => (v == null ? null : idList('jobIds', 500)(v)))
  jobIds: string[] | null = null;

  /** The background to put the photos that have a cut-out on (left out: the shop's default; null: white). */
  @Rule(backgroundChoice)
  backgroundId?: string | null;
}

/** A photo computer asking for work: what it can do. */
export class ClaimJobDto {
  @Rule((v) => {
    if (!Array.isArray(v) || v.length > 10 || v.some((x) => typeof x !== 'string' || x.length > 20))
      throw new AppError('features must be a short list.');
    return v;
  })
  features: string[] = [];

  /** Why the app cannot do some of its work right now (web search down, no vision model); null when it can do everything it lists. */
  @OptionalText(200)
  note: string | null = null;
}

/** The improved photo's details, as JSON text next to the photo file. */
export class JobResultDto {
  @Rule((value) => {
    if (value && typeof value === 'object') return value; // a rule runs twice: the second time the text is already parsed
    if (typeof value !== 'string' || value.length > 20_000)
      throw new AppError('The details are missing or too long.');
    try {
      return JSON.parse(value);
    } catch {
      throw new AppError('The details are not valid JSON.');
    }
  })
  details: unknown = {};
}

export class JobFailDto {
  @OptionalText(500)
  error: string | null = null;
}

/** Adding a draft: the quick add's body, and which photo to use: the shop's own, the maker's official one, or both (own first). */
export class AddImportDto extends QuickAddDto {
  @Rule((v) => (v === 'official' || v === 'both' ? v : 'own'))
  photo: 'own' | 'official' | 'both' = 'own';

  /** The background to put the shop's own photo on, when the draft has a cut-out (left out: the shop's default; null: white). */
  @Rule(backgroundChoice)
  backgroundId?: string | null;
}

/** How far a photo computer has got with a job: a percentage and, optionally, the step it is on. */
export class JobProgressDto {
  @Rule((v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100)
      throw new AppError('percent must be a number from 0 to 100.');
    return n;
  })
  percent!: number;

  @OptionalText(80)
  step: string | null = null;
}

/** A draft that is a product the shop already has: how many units to add to that product's stock. */
export class RestockImportDto {
  @Text('productId', 64)
  productId!: string;

  @Rule((v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 10_000)
      throw new AppError('quantity must be a whole number from 1 to 10,000.');
    return n;
  })
  quantity!: number;
}
