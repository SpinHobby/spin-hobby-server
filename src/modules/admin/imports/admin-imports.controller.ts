import {
  StreamableFile,
  Put,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access, CurrentUser } from '../../auth/access.js';
import type { AppUser } from '../../auth/auth.service.js';
import {
  AddImportDto,
  ImportsQuery,
  RejectImportDto,
  RestockImportDto,
} from './dto/imports.dto.js';
import { ImportsService } from './imports.service.js';
import { AddPhotoDto } from '../products/dto/photos.dto.js';
import { AppError } from '../../../common/errors.js';

/** Drafts sent by Gleamshelf, waiting for a person: look at each, type the price and stock, add it or reject it. */
@ApiTags('Admin: Gleamshelf imports')
@Controller('admin/imports')
@Access('staff')
export class AdminImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get()
  async list(@Query() query: ImportsQuery) {
    return { success: true, ...(await this.imports.list(query.status)) };
  }

  /** A new 8-digit code to type into the Gleamshelf app (owner only). It works once, for ten minutes. */
  @Post('pairing')
  @HttpCode(200)
  @Access('owner')
  async pairing(@CurrentUser() admin: AppUser) {
    return { success: true, ...(await this.imports.startPairing(admin.id)) };
  }

  /** The apps that are connected (owner only). */
  @Get('connections')
  @Access('owner')
  async connections() {
    return { success: true, connections: await this.imports.tokens() };
  }

  @Delete('connections/:id')
  @Access('owner')
  async disconnect(@CurrentUser() admin: AppUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.imports.revoke(admin.id, id);
    return { success: true };
  }

  @Get(':id')
  async one(@Param('id', ParseUUIDPipe) id: string) {
    return { success: true, draft: await this.imports.get(id) };
  }

  /** Adds the draft as a product: the same body as the quick add, and which photo to use (the draft's own, the maker's official one, or both). */
  @Post(':id/add')
  @HttpCode(200)
  async add(
    @CurrentUser() admin: AppUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddImportDto,
  ) {
    return {
      success: true,
      product: await this.imports.add(admin.id, id, dto, dto.photo, dto.backgroundId, dto.photos),
    };
  }

  /** The draft is a product the shop already has: adds its units to that product's stock instead of making a second listing. */
  @Post(':id/restock')
  @HttpCode(200)
  async restock(
    @CurrentUser() admin: AppUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RestockImportDto,
  ) {
    return {
      success: true,
      ...(await this.imports.restock(admin.id, id, dto.productId, dto.quantity)),
    };
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(
    @CurrentUser() admin: AppUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectImportDto,
  ) {
    await this.imports.reject(admin.id, id, dto.reason);
    return { success: true };
  }

  /** One of the draft's photos, for the photo editor (`?asOffered=1`: the photo as offered, without the person's edit). */
  @Get(':id/photos/:key/file')
  async photoFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
    @Query('asOffered') asOffered?: string,
  ) {
    const file = await this.imports.photoFile(id, photoKey(key), asOffered === '1');
    return new StreamableFile(file.bytes, { type: file.type });
  }

  /** Keeps an edit of one of the draft's photos (cropped, straightened, retouched in the photo editor). */
  @Put(':id/photos/:key')
  @HttpCode(200)
  async editPhoto(
    @CurrentUser() admin: AppUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
    @Body() dto: AddPhotoDto,
  ) {
    return {
      success: true,
      draft: await this.imports.editPhoto(
        admin.id,
        id,
        photoKey(key),
        Buffer.from(dto.data, 'base64'),
        dto.contentType,
      ),
    };
  }

  /** Undoes the edit: the photo as offered is used again. */
  @Delete(':id/photos/:key/edit')
  async undoEdit(
    @CurrentUser() admin: AppUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
  ) {
    return { success: true, draft: await this.imports.undoEdit(admin.id, id, photoKey(key)) };
  }
}

const PHOTO_KEYS = ['studio', 'background', 'original', 'cropped', 'official'] as const;
function photoKey(key: string): (typeof PHOTO_KEYS)[number] {
  if (!(PHOTO_KEYS as readonly string[]).includes(key)) throw new AppError('No such photo.', 404);
  return key as (typeof PHOTO_KEYS)[number];
}
