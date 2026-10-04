import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AppError } from '../../common/errors.js';
import { AiUsageService } from './ai-usage.service.js';
import type { ArtworkCrop } from './image-processing.js';
import { PRODUCT_CATEGORIES } from './product-categories.js';
import { anthropicConfigured } from '../../config/ai.config.js';

export const CASHIER_AI_TOOL = 'anthropic_cashier';
export const CASHIER_MODEL = 'claude-opus-5';

const IDENTIFY_SCHEMA = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description:
        "A short, customer-facing product title (character/series name + item type, e.g. 'Tanjiro Kamado Figure').",
    },
    description: {
      type: 'string',
      description: 'A 1-2 sentence description of the item for a price tag or receipt.',
    },
    category: {
      type: 'string',
      enum: [...PRODUCT_CATEGORIES],
      description: 'The single best-fitting product category for this item.',
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

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Clamps a model- or form-supplied crop into a safe, always-in-bounds box (or drops it). */
export function sanitizeArtworkCrop(raw: any): ArtworkCrop | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const x = clamp(Number(raw.x), 0, 0.95);
  const y = clamp(Number(raw.y), 0, 0.95);
  const width = clamp(Number(raw.width), 0.05, 1 - x);
  const height = clamp(Number(raw.height), 0.05, 1 - y);
  const rotationDegrees = clamp(Number(raw.rotationDegrees) || 0, -45, 45);
  if (![x, y, width, height, rotationDegrees].every(Number.isFinite)) return undefined;
  return { x, y, width, height, rotationDegrees };
}

type ImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
const SUPPORTED: ImageType[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

@Injectable()
export class IdentifyService {
  private readonly logger = new Logger(IdentifyService.name);
  private client?: Anthropic;

  constructor(private readonly usage: AiUsageService) {}

  async identify(photo: { buffer: Buffer; mimetype: string }, sealed: boolean) {
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
        output_config: {
          effort: 'low',
          format: {
            type: 'json_schema',
            schema: IDENTIFY_SCHEMA as unknown as Record<string, unknown>,
          },
        },
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
              {
                type: 'text',
                text: `This is a photo of anime/hobby merchandise being catalogued by a cashier, either at a convention booth or for the online store. Identify the item (character, series if recognizable, item type such as figure/keychain/plush/badge/shirt), write a short title and description for it, and classify it into exactly one of these categories: ${PRODUCT_CATEGORIES.join(', ')}. If you can't identify the specific character or series, describe what's visible instead of guessing. If nothing fits well, use "Other".\n\n${
                  sealed
                    ? "This item is SEALED in its box. Also locate the printed product photo/artwork panel on the box's face and return it as `artworkCrop`, so it can be cropped out and used as the product photo - this is the manufacturer's own professional photo of the figure, already on the packaging. Include a small margin around the panel and estimate any rotation needed to straighten it."
                    : "This item is not sealed (the actual product is what's photographed) - omit `artworkCrop` entirely."
                }`,
              },
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
    this.usage
      .record(CASHIER_AI_TOOL, this.usage.estimateCost(CASHIER_MODEL, input, output), input, output)
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
    const result = JSON.parse(text.text) as {
      title: string;
      description: string;
      category: string;
      artworkCrop?: unknown;
    };
    return {
      title: result.title,
      description: result.description,
      category: result.category,
      artworkCrop: sanitizeArtworkCrop(result.artworkCrop),
    };
  }
}
