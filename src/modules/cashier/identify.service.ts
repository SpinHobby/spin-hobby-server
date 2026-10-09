import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AppError } from '../../common/errors.js';
import { seriesKey } from '../../common/series-key.js';
import { Db } from '../../database/db.service.js';
import { AiUsageService } from './ai-usage.service.js';
import type { ArtworkCrop } from './image-processing.js';
import type { StickerBox } from './photo-polish.js';
import { PRODUCT_CATEGORIES } from './product-categories.js';
import { cleanBarcode } from '../../common/barcode.js';
import { anthropicConfigured } from '../../config/ai.config.js';

export const CASHIER_AI_TOOL = 'anthropic_cashier';
export const CASHIER_MODEL = 'claude-opus-5';

const IDENTIFY_SCHEMA = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description:
        "A short, customer-facing product title for an online store: character or product name, then the item type, with the series in parentheses when known (e.g. 'Tanjiro Kamado Figure (Demon Slayer)'). No marketing words, no all-caps, no emoji.",
    },
    description: {
      type: 'string',
      description:
        'A customer-facing description of 2-3 plain sentences: what the item is, who or what it depicts, and what is visible (packaging, pose, accessories). Never invent sizes, materials, makers, release dates or edition details that are not visible in the photo.',
    },
    category: {
      type: 'string',
      enum: [...PRODUCT_CATEGORIES],
      description: 'The single best-fitting product category for this item.',
    },
    series: {
      type: 'string',
      description:
        "The anime, manga, game or franchise the item is from. If one of the KNOWN SERIES in the prompt is the same series, return that name exactly as written. Otherwise return the series' official English title. Omit entirely when the item has no series (generic goods, supplies, unbranded items) or you are not sure.",
    },
    barcode: {
      type: 'string',
      description:
        'Only include this if a barcode is clearly visible in the photo AND its printed digits are fully legible: the digits exactly as printed under the bars (8, 12, 13 or 14 digits). Never guess or complete missing digits. Omit otherwise.',
    },
    artworkCrop: {
      type: 'object',
      description:
        "Only include this when the photo is of a SEALED box: the bounding box of the printed product photo/artwork panel on the box face, with a small margin so the full panel is included even if photographed at a slight angle. Coordinates are fractions (0-1) of the full photo's width/height, measured from the top-left corner. Omit entirely if the photo isn't a sealed box, or if no clear artwork panel is visible.",
      properties: {
        x: { type: 'number', description: 'Left edge, as a fraction of image width (0-1).' },
        y: { type: 'number', description: 'Top edge, as a fraction of image height (0-1).' },
        width: { type: 'number', description: 'Width, as a fraction of image width (0-1).' },
        height: { type: 'number', description: 'Height, as a fraction of image height (0-1).' },
        rotationDegrees: {
          type: 'number',
          description:
            "Degrees to rotate the cropped region clockwise to make the artwork's edges level/straight, between -45 and 45. 0 if it's already straight.",
        },
      },
      required: ['x', 'y', 'width', 'height', 'rotationDegrees'],
      additionalProperties: false,
    },
  },
  required: ['title', 'description', 'category'],
  additionalProperties: false,
} as const;

/** The series the AI named, matched to the list (so "Re Zero" becomes "Re:Zero"); flagged when it would be new. */
export function matchSeries(
  raw: unknown,
  known: string[],
): { series?: string; seriesIsNew?: boolean } {
  const name = typeof raw === 'string' ? raw.trim().slice(0, 120) : '';
  if (!name) return {};
  const match = known.find((k) => seriesKey(k) === seriesKey(name));
  return match ? { series: match, seriesIsNew: false } : { series: name, seriesIsNew: true };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Clamps a model- or form-supplied crop into a safe, always-in-bounds box (or drops it). */
export function sanitizeArtworkCrop(raw: unknown): ArtworkCrop | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const crop = raw as Record<string, unknown>;
  const x = clamp(Number(crop.x), 0, 0.95);
  const y = clamp(Number(crop.y), 0, 0.95);
  const width = clamp(Number(crop.width), 0.05, 1 - x);
  const height = clamp(Number(crop.height), 0.05, 1 - y);
  const rotationDegrees = clamp(Number(crop.rotationDegrees) || 0, -45, 45);
  if (![x, y, width, height, rotationDegrees].every(Number.isFinite)) return undefined;
  return { x, y, width, height, rotationDegrees };
}

const STICKERS_PROPERTY = {
  type: 'array',
  description:
    'Stickers or labels a SHOP added to the box after manufacture (price stickers, shop labels, tape). Empty when there are none.',
  items: {
    type: 'object',
    properties: {
      x: { type: 'number', description: 'Left edge, fraction of the photo width (0-1).' },
      y: { type: 'number', description: 'Top edge, fraction of the photo height (0-1).' },
      width: { type: 'number', description: 'Width, fraction of the photo width (0-1).' },
      height: { type: 'number', description: 'Height, fraction of the photo height (0-1).' },
    },
    required: ['x', 'y', 'width', 'height'],
    additionalProperties: false,
  },
} as const;

const STICKER_SCHEMA = {
  type: 'object',
  properties: { stickers: STICKERS_PROPERTY },
  required: ['stickers'],
  additionalProperties: false,
} as Record<string, unknown>;

const STICKER_PROMPT =
  'Find every sticker or label that a SHOP stuck on the box after manufacture: price stickers (a white or cream label with a handwritten or printed price such as $40 or $50), shop labels and tape. Do NOT include anything printed on the box by the manufacturer (logos, age-rating marks, titles, barcodes). Return a tight bounding box for each as fractions (0-1) of the full photo width and height from the top-left corner: x, y, width, height. Return an empty list if there are none. Put it in `stickers`.';

/** Boxes the AI named, clamped into the photo and limited to a few (a sticker is small). */
export function sanitizeStickers(raw: unknown): StickerBox[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 4)
    .map((b: Record<string, unknown>) => {
      const x = clamp(Number(b?.x), 0, 0.98);
      const y = clamp(Number(b?.y), 0, 0.98);
      return {
        x,
        y,
        width: clamp(Number(b?.width), 0.01, Math.min(0.4, 1 - x)),
        height: clamp(Number(b?.height), 0.01, Math.min(0.3, 1 - y)),
      };
    })
    .filter((b) => [b.x, b.y, b.width, b.height].every(Number.isFinite));
}

type ImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
const SUPPORTED: ImageType[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

@Injectable()
export class IdentifyService {
  private readonly logger = new Logger(IdentifyService.name);
  private client?: Anthropic;

  constructor(
    private readonly usage: AiUsageService,
    private readonly db: Db,
  ) {}

  /**
   * One question to Claude about one photo, answered as JSON in the given shape. Checks the monthly AI budget
   * first, records what the call cost, and turns every failure into a message the admin can act on.
   */
  private async ask(
    photo: { buffer: Buffer; mimetype: string },
    schema: Record<string, unknown>,
    prompt: string,
  ) {
    if (!SUPPORTED.includes(photo.mimetype as ImageType))
      throw new AppError('Photo must be a JPEG, PNG, WebP or GIF image.');
    const budget = await this.usage.status(CASHIER_AI_TOOL);
    if (budget.status === 'blocked') {
      throw new AppError(
        `Photo identification is disabled for the rest of the month - AI budget of $${budget.stopThresholdUsd} reached. Enter the title/description manually, or ask an admin to raise the budget in the Ops dashboard.`,
        429,
      );
    }
    if (!anthropicConfigured()) throw new AppError('Photo identification is not configured.', 503);
    this.client ??= new Anthropic();

    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create({
        model: CASHIER_MODEL,
        // Thinking is on by default for this model; leave room for it plus the JSON answer.
        max_tokens: 4096,
        // Opt in to server-side fallback so a classifier decline is retried on another model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        // Low effort: a quick visual labelling task, and every call counts against the monthly AI budget.
        output_config: { effort: 'low', format: { type: 'json_schema', schema } },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: photo.mimetype as ImageType,
                  data: photo.buffer.toString('base64'),
                },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      });
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError)
        throw new AppError('Photo identification is busy. Try again in a moment.', 429);
      if (error instanceof Anthropic.APIError) {
        this.logger.error(`Claude API error ${error.status}: ${error.message}`);
        throw new AppError('Photo identification failed. Enter the details manually.', 502);
      }
      throw error;
    }

    const input = response.usage.input_tokens ?? 0;
    const output = response.usage.output_tokens ?? 0;
    const costUsd = this.usage.estimateCost(CASHIER_MODEL, input, output);
    this.usage
      .record(CASHIER_AI_TOOL, costUsd, input, output)
      .catch((e) => this.logger.warn(`Recording AI usage failed: ${e}`));

    if (response.stop_reason === 'refusal')
      throw new AppError(
        "This photo couldn't be identified automatically. Enter the details manually.",
        422,
      );
    if (response.stop_reason === 'max_tokens')
      throw new AppError(
        'Photo identification ran out of room. Try again or enter the details manually.',
        502,
      );
    const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text');
    if (!text) throw new AppError('Photo identification returned no result.', 502);
    return {
      result: JSON.parse(text.text) as Record<string, unknown>,
      // What this one call cost, and the month so far against the stop limit, so the admin can see it.
      usage: {
        inputTokens: input,
        outputTokens: output,
        costUsd,
        monthSpendUsd: budget.spendUsd + costUsd,
        monthStopUsd: budget.stopThresholdUsd,
      },
    };
  }

  /**
   * Title, description, category, series, barcode and (for a sealed box) the artwork crop. With `findStickers` the
   * same single request also locates shop price stickers, which is cheaper than asking twice.
   */
  async identify(
    photo: { buffer: Buffer; mimetype: string },
    sealed: boolean,
    findStickers = false,
  ) {
    const known = (
      await this.db.many<{ name: string }>(
        'select name from public.series order by lower(name) limit 600',
      )
    ).map((r) => r.name);
    const schema = findStickers
      ? {
          ...IDENTIFY_SCHEMA,
          properties: { ...IDENTIFY_SCHEMA.properties, stickers: STICKERS_PROPERTY },
        }
      : IDENTIFY_SCHEMA;
    const prompt = `${known.length ? `KNOWN SERIES (use one of these exactly if it matches): ${known.join(' | ')}\n\n` : ''}This is a photo of anime/hobby merchandise being catalogued by a cashier, either at a convention booth or for the online store. Identify the item (character, series if recognizable, item type such as figure/keychain/plush/badge/shirt), write a short title and description for it, and classify it into exactly one of these categories: ${PRODUCT_CATEGORIES.join(', ')}. If you can't identify the specific character or series, describe what's visible instead of guessing. If nothing fits well, use "Other".\n\n${
      sealed
        ? "This item is SEALED in its box. Also locate the printed product photo/artwork panel on the box's face and return it as `artworkCrop`, so it can be cropped out and used as the product photo - this is the manufacturer's own professional photo of the figure, already on the packaging. Include a small margin around the panel and estimate any rotation needed to straighten it."
        : "This item is not sealed (the actual product is what's photographed) - omit `artworkCrop` entirely."
    }${findStickers ? `\n\n${STICKER_PROMPT}` : ''}`;
    const { result: raw, usage } = await this.ask(photo, schema, prompt);
    const result = raw as {
      title: string;
      description: string;
      category: string;
      artworkCrop?: unknown;
      barcode?: unknown;
      series?: unknown;
      stickers?: unknown;
    };
    return {
      title: result.title,
      description: result.description,
      category: result.category,
      artworkCrop: sanitizeArtworkCrop(result.artworkCrop),
      // Only a code with a correct check digit is passed on, so a misread never reaches a listing.
      barcode: cleanBarcode(result.barcode) ?? undefined,
      ...matchSeries(result.series, known),
      ...(findStickers ? { stickers: sanitizeStickers(result.stickers) } : {}),
      usage,
    };
  }

  /** Finds shop stickers (price labels, tape) on a photo of a box, so they can be painted over. */
  async findStickers(photo: { buffer: Buffer; mimetype: string }) {
    const { result, usage } = await this.ask(photo, STICKER_SCHEMA, STICKER_PROMPT);
    return { stickers: sanitizeStickers(result.stickers), usage };
  }
}
