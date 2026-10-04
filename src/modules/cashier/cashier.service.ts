import { Injectable, Logger } from '@nestjs/common';
import { AppError, notFound } from '../../common/errors.js';
import { SquareCatalogClient } from '../../integrations/square/square-catalog.client.js';
import {
  categoryNames,
  classify,
  firstVariationId,
  imageUrls,
  toDetail,
  toSearchResult,
  type SquareCategory,
  type SquareItem,
  type SquareRelated,
} from './cashier-items.mapper.js';
import type { RecordItemDto, UpdateItemDto } from './dto/cashier.dto.js';
import { sanitizeArtworkCrop } from './identify.service.js';
import { cropToArtworkRegion } from './image-processing.js';
import { dollarsToCents } from './price.js';

export interface Upload {
  buffer: Buffer;
  mimetype: string;
}

const CONDITION_LABELS: Record<string, string> = {
  sealed: 'Sealed / New in box',
  used: 'Opened / Used',
};

// The Square SDK's catalog types are a huge union; the cashier only reads the fields in the mapper's
// interfaces, so the narrowing happens once, here.
const asItems = (objects: unknown) => objects as SquareItem[];
const asRelated = (objects: unknown) => objects as SquareRelated[];
const asCategories = (objects: unknown) => objects as SquareCategory[];

/** The in-store cataloguing tool: searching, creating and editing Square items. */
@Injectable()
export class CashierService {
  private readonly logger = new Logger(CashierService.name);

  constructor(private readonly square: SquareCatalogClient) {}

  /** Creates a Square item (hidden by default), with its photo and starting stock. */
  async record(dto: RecordItemDto, file?: Upload) {
    const price = dollarsToCents(dto.price);
    const description =
      dto.condition && CONDITION_LABELS[dto.condition]
        ? [dto.description, `Condition: ${CONDITION_LABELS[dto.condition]}`]
            .filter(Boolean)
            .join('\n\n')
        : dto.description;
    let quantity: number | undefined;
    if (!dto.hidden) {
      quantity = Number(dto.quantity);
      if (!Number.isFinite(quantity) || quantity < 0)
        throw new AppError('quantity must be a non-negative number');
    }

    let photo = file?.buffer;
    const crop = sanitizeArtworkCrop({
      x: dto.artworkCropX,
      y: dto.artworkCropY,
      width: dto.artworkCropWidth,
      height: dto.artworkCropHeight,
      rotationDegrees: dto.artworkRotationDegrees,
    });
    if (photo && crop) photo = await cropToArtworkRegion(photo, crop);

    const item = await this.square.createLocationItem({
      name: dto.title,
      description,
      price,
      hidden: dto.hidden,
      categoryId: await this.categoryId(dto.category),
      photo: photo && file ? { buffer: photo, mimetype: file.mimetype } : undefined,
    });
    const variationId = item?.item_data?.variations?.[0]?.id;
    if (!dto.hidden && variationId && quantity != null) {
      await this.square
        .setInitialInventoryCount(variationId, quantity)
        .catch((e) => this.logger.warn(`Initial stock count failed: ${e}`));
    }
    return { itemId: item?.id };
  }

  /** One page (up to 100) of every Square item, hidden ones included, with stock and category names. */
  async search(q?: string, cursor?: string) {
    const result = await this.square.searchAllItems(q || undefined, cursor || undefined, 100);
    const items = asItems(result.items);
    const images = imageUrls(asRelated(result.relatedObjects));
    // Category names cost a Square call, so only fetch them when some item has a category.
    const names = items.some((i) => (i.itemData?.categories ?? []).length)
      ? categoryNames(asCategories(await this.square.listCategories()))
      : new Map<string, string>();
    const stock = await this.square.getInventoryCounts(
      items.map(firstVariationId).filter((id): id is string => !!id),
    );
    return {
      cursor: result.cursor,
      items: items.map((item) => toSearchResult(item, images, names, stock)),
    };
  }

  /** The full item the cashier edits. */
  async item(id: string) {
    const { item, relatedObjects } = await this.square.getItem(id);
    if (!item || item.type !== 'ITEM') throw notFound('Item');
    const found = item as unknown as SquareItem;
    const { categoryId } = classify(found);
    const categories = categoryId ? asCategories(await this.square.listCategories()) : [];
    const variation = found.itemData?.variations?.[0];
    const variationId = variation?.type === 'ITEM_VARIATION' ? variation.id : undefined;
    const stock = variationId ? await this.square.getInventoryCounts([variationId]) : {};
    return toDetail(found, asRelated(relatedObjects), categories, stock);
  }

  /** Saves the cashier's edits to an item, and its stock when it is visible in the shop. */
  async update(id: string, dto: UpdateItemDto, file?: Upload) {
    const price = dollarsToCents(dto.price);
    // A named category wins; otherwise keep the item's existing category so editing other fields doesn't clear it.
    const categoryId = dto.category
      ? await this.categoryId(dto.category)
      : dto.categoryId || undefined;
    const item = await this.square.updateLocationItem({
      itemId: id,
      name: dto.title,
      description: dto.description,
      price,
      hidden: dto.hidden,
      categoryId,
      photo: file ? { buffer: file.buffer, mimetype: file.mimetype } : undefined,
      removePhoto: !file && dto.removePhoto === 'true',
    });
    if (!dto.hidden && dto.quantity != null && dto.quantity !== '') {
      const quantity = Number(dto.quantity);
      const variationId = item?.item_data?.variations?.[0]?.id;
      if (variationId && Number.isFinite(quantity) && quantity >= 0) {
        await this.square
          .setInitialInventoryCount(variationId, quantity)
          .catch((e) => this.logger.warn(`Stock count update failed: ${e}`));
      }
    }
    return { itemId: item?.id };
  }

  /** The Square category id for a name, creating it if needed. A failure saves the item without one. */
  private async categoryId(category?: string) {
    if (!category) return undefined;
    try {
      return await this.square.getOrCreateCategoryId(category);
    } catch (error) {
      this.logger.warn(`Resolving category "${category}" failed, saving without one: ${error}`);
      return undefined;
    }
  }
}
