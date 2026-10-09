import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AppError } from '../../common/errors.js';
import { Access } from '../auth/access.js';
import { CashierService, type Upload } from './cashier.service.js';
import {
  CashierSearchQuery,
  IdentifyDto,
  PolishDto,
  RecordItemDto,
  UpdateItemDto,
} from './dto/cashier.dto.js';
import { IdentifyService, sanitizeStickers } from './identify.service.js';
import { polishPhoto } from './photo-polish.js';

/** Sticker boxes arrive as JSON text in a multipart field; anything unreadable counts as none. */
const parseJson = (text: string | undefined): unknown => {
  try {
    return text ? JSON.parse(text) : [];
  } catch {
    return [];
  }
};

const photoUpload = () => FileInterceptor('photo', { limits: { fileSize: 10 * 1024 * 1024 } });

/** In-store cataloguing tool: photo → Claude suggestion → Square item. Staff only. */
@ApiTags('Cashier')
@Controller('cashier')
@Access('staff')
export class CashierController {
  constructor(
    private readonly identifier: IdentifyService,
    private readonly cashier: CashierService,
  ) {}

  /** Asks Claude to suggest a title, description and category from a photo. */
  @Post('identify')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(photoUpload())
  async identify(@UploadedFile() file: Upload | undefined, @Body() dto: IdentifyDto) {
    if (!file) throw new AppError('photo is required');
    if (!file.mimetype.startsWith('image/')) throw new AppError('file must be an image');
    return {
      success: true,
      ...(await this.identifier.identify(
        file,
        dto.condition === 'sealed',
        dto.findStickers === 'true',
      )),
    };
  }

  /**
   * Tidies a product photo and returns it as a PNG: shop stickers painted over and/or a green backdrop removed (so
   * the background is transparent). Cutting out the backdrop is free; only finding stickers with the AI costs money,
   * and only when no sticker boxes are sent. What happened is in the `x-polish` header as JSON.
   */
  @Post('polish')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(photoUpload())
  async polish(
    @UploadedFile() file: Upload | undefined,
    @Body() dto: PolishDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!file) throw new AppError('photo is required');
    if (!file.mimetype.startsWith('image/')) throw new AppError('file must be an image');
    let stickers = sanitizeStickers(parseJson(dto.stickers));
    let usage: unknown;
    if (dto.removeStickers === 'true' && !dto.stickers) {
      const found = await this.identifier.findStickers(file);
      stickers = found.stickers;
      usage = found.usage;
    }
    const result = await polishPhoto(file.buffer, {
      removeBackground: dto.removeBackground === 'true',
      stickers: dto.removeStickers === 'true' ? stickers : [],
    });
    res.setHeader(
      'x-polish',
      JSON.stringify({
        backgroundRemoved: result.backgroundRemoved,
        stickersFilled: result.stickersFilled,
        usage,
      }),
    );
    return new StreamableFile(result.data, { type: result.contentType });
  }

  /** Creates a Square item. The `photo` file is optional. */
  @Post('record')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(photoUpload())
  async record(@UploadedFile() file: Upload | undefined, @Body() dto: RecordItemDto) {
    return { success: true, ...(await this.cashier.record(dto, file)) };
  }

  @Get('search')
  async search(@Query() query: CashierSearchQuery) {
    return { success: true, ...(await this.cashier.search(query.q, query.cursor)) };
  }

  @Get('item/:id')
  async item(@Param('id') id: string) {
    return { success: true, item: await this.cashier.item(id) };
  }

  /** Saves edits to a Square item. Send the whole form; a new `photo` replaces the old one. */
  @Put('item/:id')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(photoUpload())
  async update(
    @Param('id') id: string,
    @UploadedFile() file: Upload | undefined,
    @Body() dto: UpdateItemDto,
  ) {
    return { success: true, ...(await this.cashier.update(id, dto, file)) };
  }
}
