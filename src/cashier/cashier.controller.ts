import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Access } from '../auth/access.js';
import { AppError, notFound } from '../common/errors.js';
import { IdentifyService, sanitizeArtworkCrop } from './identify.service.js';
import { cropToArtworkRegion } from './image-processing.js';
import { CASHIER_CATEGORY_ID, SquareCatalogService } from './square-catalog.service.js';

type Upload = { buffer: Buffer; mimetype: string } | undefined;
type Fields = Record<string, string | undefined>;
const photoUpload = () => FileInterceptor('photo', { limits: { fileSize: 10 * 1024 * 1024 } });

function priceCents(price: unknown) {
  const cents = Math.round(Number(price) * 100);
  if (price == null || price === '' || !Number.isFinite(cents) || cents <= 0)
    throw new AppError('price must be a positive number');
  return cents;
}

/** In-store cataloguing tool: photo → Claude suggestion → Square item. Staff only. */
@Controller('cashier')
@Access('staff')
export class CashierController {
  private readonly logger = new Logger(CashierController.name);
  constructor(
    private readonly identifier: IdentifyService,
    private readonly square: SquareCatalogService,
  ) {}

  @Post('identify')
  @HttpCode(200)
  @UseInterceptors(photoUpload())
  async identify(@UploadedFile() file: Upload, @Body() body: Fields) {
    if (!file) throw new AppError('photo is required');
    if (!file.mimetype.startsWith('image/')) throw new AppError('file must be an image');
    return {
      success: true,
      ...(await this.identifier.identify(file, body.condition === 'sealed')),
    };
  }

  private async categoryId(category?: string) {
    if (!category) return undefined;
    try {
      return await this.square.getOrCreateCategoryId(category);
    } catch (error) {
      this.logger.warn(`Resolving category "${category}" failed, saving without one: ${error}`);
      return undefined;
    }
  }

  @Post('record')
  @HttpCode(200)
  @UseInterceptors(photoUpload())
  async record(@UploadedFile() file: Upload, @Body() body: Fields) {
    const { title, description, hidden, quantity, category, condition } = body;
    if (!title) throw new AppError('title and price are required');
    const price = priceCents(body.price);
    const conditionLabel =
      condition === 'sealed'
        ? 'Sealed / New in box'
        : condition === 'used'
          ? 'Opened / Used'
          : null;
    const fullDescription = conditionLabel
      ? [description, `Condition: ${conditionLabel}`].filter(Boolean).join('\n\n')
      : description;
    const isHidden = hidden !== 'false';
    let quantityValue: number | undefined;
    if (!isHidden) {
      quantityValue = Number(quantity);
      if (!Number.isFinite(quantityValue) || quantityValue < 0)
        throw new AppError('quantity must be a non-negative number');
    }
    let photo = file?.buffer;
    const crop = sanitizeArtworkCrop({
      x: body.artworkCropX,
      y: body.artworkCropY,
      width: body.artworkCropWidth,
      height: body.artworkCropHeight,
      rotationDegrees: body.artworkRotationDegrees,
    });
    if (photo && crop) photo = await cropToArtworkRegion(photo, crop);

    const item = await this.square.createLocationItem({
      name: title,
      description: fullDescription,
      price,
      hidden: isHidden,
      categoryId: await this.categoryId(category),
      photo: photo && file ? { buffer: photo, mimetype: file.mimetype } : undefined,
    });
    const variationId = item?.item_data?.variations?.[0]?.id;
    if (!isHidden && variationId && quantityValue != null) {
      await this.square
        .setInitialInventoryCount(variationId, quantityValue)
        .catch((e) => this.logger.warn(`Initial stock count failed: ${e}`));
    }
    return { success: true, itemId: item?.id };
  }

  @Get('search')
  async search(@Query('q') q?: string, @Query('cursor') cursor?: string) {
    const result = await this.square.searchAllItems(q || undefined, cursor || undefined, 100);
    const images = new Map<string, string>();
    for (const o of result.relatedObjects as any[])
      if (o.type === 'IMAGE' && o.imageData?.url) images.set(o.id, o.imageData.url);
    const items = result.items as any[];
    const categoryNames = new Map<string, string>();
    if (items.some((i) => (i.itemData?.categories ?? []).length)) {
      for (const c of (await this.square.listCategories()) as any[])
        if (c.id && c.categoryData?.name) categoryNames.set(c.id, c.categoryData.name);
    }
    const stock = await this.square.getInventoryCounts(
      items.map((i) => i.itemData?.variations?.[0]?.id).filter(Boolean),
    );
    return {
      success: true,
      cursor: result.cursor,
      items: items.map((item) => {
        const cats = item.itemData?.categories ?? [];
        const variationId = item.itemData?.variations?.[0]?.id;
        const categoryId = cats.find((c: any) => c.id !== CASHIER_CATEGORY_ID)?.id;
        const imageId = item.itemData?.imageIds?.[0];
        return {
          id: item.id,
          name: item.itemData?.name,
          priceCents: Number(
            item.itemData?.variations?.[0]?.itemVariationData?.priceMoney?.amount ?? 0,
          ),
          hidden: cats.some((c: any) => c.id === CASHIER_CATEGORY_ID),
          imageUrl: imageId ? images.get(imageId) : undefined,
          categoryId,
          categoryName: categoryId ? categoryNames.get(categoryId) : undefined,
          stockCount: variationId && variationId in stock ? stock[variationId] : null,
        };
      }),
    };
  }

  @Get('item/:id')
  async item(@Param('id') id: string) {
    const { item, relatedObjects } = await this.square.getItem(id);
    if (!item || item.type !== 'ITEM') throw notFound('Item');
    const it = item as any;
    const imageId = it.itemData?.imageIds?.[0];
    const variation = it.itemData?.variations?.[0];
    const variationId = variation?.type === 'ITEM_VARIATION' ? variation.id : undefined;
    const cats = it.itemData?.categories ?? [];
    const categoryId = cats.find((c: any) => c.id !== CASHIER_CATEGORY_ID)?.id;
    const categoryName = categoryId
      ? ((await this.square.listCategories()) as any[]).find((c) => c.id === categoryId)
          ?.categoryData?.name
      : undefined;
    const counts = variationId ? await this.square.getInventoryCounts([variationId]) : {};
    return {
      success: true,
      item: {
        id: it.id,
        name: it.itemData?.name,
        description: it.itemData?.description,
        priceCents:
          variation?.type === 'ITEM_VARIATION'
            ? Number(variation.itemVariationData?.priceMoney?.amount ?? 0)
            : 0,
        variationId,
        categoryId,
        categoryName,
        hidden: cats.some((c: any) => c.id === CASHIER_CATEGORY_ID),
        stockCount: variationId && variationId in counts ? counts[variationId] : null,
        imageUrl: imageId
          ? (relatedObjects as any[]).find((o) => o.type === 'IMAGE' && o.id === imageId)?.imageData
              ?.url
          : undefined,
      },
    };
  }

  @Put('item/:id')
  @UseInterceptors(photoUpload())
  async update(@Param('id') id: string, @UploadedFile() file: Upload, @Body() body: Fields) {
    const {
      title,
      description,
      hidden,
      quantity,
      category,
      categoryId: rawCategoryId,
      removePhoto,
    } = body;
    if (!title) throw new AppError('title and price are required');
    const price = priceCents(body.price);
    const isHidden = hidden !== 'false';
    // A named category wins; otherwise keep the item's existing raw category so editing other fields doesn't clear it.
    const categoryId = category ? await this.categoryId(category) : rawCategoryId || undefined;
    const item = await this.square.updateLocationItem({
      itemId: id,
      name: title,
      description,
      price,
      hidden: isHidden,
      categoryId,
      photo: file ? { buffer: file.buffer, mimetype: file.mimetype } : undefined,
      removePhoto: !file && removePhoto === 'true',
    });
    if (!isHidden && quantity != null && quantity !== '') {
      const q = Number(quantity);
      const variationId = item?.item_data?.variations?.[0]?.id;
      if (variationId && Number.isFinite(q) && q >= 0) {
        await this.square
          .setInitialInventoryCount(variationId, q)
          .catch((e) => this.logger.warn(`Stock count update failed: ${e}`));
      }
    }
    return { success: true, itemId: item?.id };
  }
}
