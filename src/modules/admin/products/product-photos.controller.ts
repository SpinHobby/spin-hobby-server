import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { notFound } from '../../../common/errors.js';
import { Access } from '../../auth/access.js';
import { PhotoBackgroundsService } from './photo-backgrounds.service.js';

/**
 * A transparent product photo on the shop background, for the places that cannot show transparency: eBay (which fetches a listing's photos
 * itself) and link previews (Discord, Facebook, search results). Only the shop's own transparent product photos are answered.
 */
@ApiTags('Product photos')
@Controller('product-photos')
@Access('public')
export class ProductPhotosController {
  constructor(private readonly backgrounds: PhotoBackgroundsService) {}

  /** The photo by its Square id (`image`) or its address (`src`: in Square, or an eBay copy); `b` only tells caches the background changed. */
  @Get('on-background')
  @Header('Cache-Control', 'public, max-age=3600')
  async onBackground(
    @Query('src') src: string | undefined,
    @Query('image') imageId: string | undefined,
    @Res() res: Response,
  ) {
    const ok = (v: string | undefined, max: number) => (v && v.length <= max ? v : undefined);
    const photo =
      ok(src, 1000) || ok(imageId, 64)
        ? await this.backgrounds.onShopBackground({ src: ok(src, 1000), imageId: ok(imageId, 64) })
        : null;
    if (!photo) throw notFound('Photo');
    res.type('image/jpeg').send(photo);
  }
}
