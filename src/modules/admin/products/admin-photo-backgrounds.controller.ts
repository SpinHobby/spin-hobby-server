import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access, CurrentUser } from '../../auth/access.js';
import type { AppUser } from '../../auth/auth.service.js';
import {
  AddBackgroundDto,
  DefaultBackgroundDto,
  RenameBackgroundDto,
} from './dto/backgrounds.dto.js';
import { PhotoBackgroundsService } from './photo-backgrounds.service.js';

/** The shop's own backgrounds for product photos (kept in our storage, not Square's), the shop background, and making older photos transparent. */
@ApiTags('Admin: photo backgrounds')
@Controller('admin')
@Access('staff')
export class AdminPhotoBackgroundsController {
  constructor(private readonly backgrounds: PhotoBackgroundsService) {}

  /** The library (the default is the shop background), with how many product photos are transparent and how many older ones could be. */
  @Get('photo-backgrounds')
  async list() {
    return {
      success: true,
      backgrounds: await this.backgrounds.list(),
      photos: await this.backgrounds.counts(),
    };
  }

  /** Makes every older cut-out photo (one with a background baked in) transparent, so it shows on the shop background too. */
  @Post('photo-backgrounds/make-transparent')
  @HttpCode(200)
  async makeAllTransparent(@CurrentUser() admin: AppUser) {
    return { success: true, ...(await this.backgrounds.makeAllTransparent(admin.id)) };
  }

  @Post('photo-backgrounds')
  @HttpCode(200)
  async add(@CurrentUser() admin: AppUser, @Body() dto: AddBackgroundDto) {
    return {
      success: true,
      background: await this.backgrounds.create(
        admin.id,
        Buffer.from(dto.data, 'base64'),
        dto.contentType,
        dto.name,
      ),
    };
  }

  /** The shop background: every transparent product photo shows on it (null: plain white). */
  @Put('photo-backgrounds/default')
  @HttpCode(200)
  async setDefault(@CurrentUser() admin: AppUser, @Body() dto: DefaultBackgroundDto) {
    return { success: true, backgrounds: await this.backgrounds.setDefault(admin.id, dto.id) };
  }

  @Patch('photo-backgrounds/:id')
  async rename(
    @CurrentUser() admin: AppUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameBackgroundDto,
  ) {
    return { success: true, background: await this.backgrounds.rename(admin.id, id, dto.name) };
  }

  /** Deletes a background from the library. When it was the shop background, plain white is. */
  @Delete('photo-backgrounds/:id')
  async remove(@CurrentUser() admin: AppUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.backgrounds.remove(admin.id, id);
    return { success: true };
  }

  /** Makes one older photo of a product transparent (only photos made from a Gleamshelf cut-out). The new photo takes the old one's place. */
  @Post('products/:id/photos/:imageId/transparent')
  @HttpCode(200)
  async makeTransparent(
    @CurrentUser() admin: AppUser,
    @Param('id') squareItemId: string,
    @Param('imageId') imageId: string,
  ) {
    const result = await this.backgrounds.makeTransparent(admin.id, squareItemId, imageId);
    return { success: true, ...result, cutouts: await this.backgrounds.cutouts(squareItemId) };
  }
}
