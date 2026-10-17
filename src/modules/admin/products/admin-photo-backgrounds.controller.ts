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
  ChangeBackgroundDto,
  DefaultBackgroundDto,
  RenameBackgroundDto,
} from './dto/backgrounds.dto.js';
import { PhotoBackgroundsService } from './photo-backgrounds.service.js';

/** The shop's own backgrounds for product photos (kept in our storage, not Square's), and changing the background of a product photo. */
@ApiTags('Admin: photo backgrounds')
@Controller('admin')
@Access('staff')
export class AdminPhotoBackgroundsController {
  constructor(private readonly backgrounds: PhotoBackgroundsService) {}

  @Get('photo-backgrounds')
  async list() {
    return { success: true, backgrounds: await this.backgrounds.list() };
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

  /** Which background is picked first when a photo is used (null: plain white). */
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

  /** Deletes a background from the library. Photos already made with it are not changed. */
  @Delete('photo-backgrounds/:id')
  async remove(@CurrentUser() admin: AppUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.backgrounds.remove(admin.id, id);
    return { success: true };
  }

  /** Puts one photo of a product on another background (only photos made from a Gleamshelf cut-out). The new photo takes the old one's place. */
  @Put('products/:id/photos/:imageId/background')
  @HttpCode(200)
  async change(
    @CurrentUser() admin: AppUser,
    @Param('id') squareItemId: string,
    @Param('imageId') imageId: string,
    @Body() dto: ChangeBackgroundDto,
  ) {
    const result = await this.backgrounds.changeBackground(
      admin.id,
      squareItemId,
      imageId,
      dto.backgroundId,
    );
    return { success: true, ...result, cutouts: await this.backgrounds.cutouts(squareItemId) };
  }
}
