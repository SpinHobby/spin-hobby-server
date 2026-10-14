import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Access, CurrentUser } from '../../auth/access.js';
import type { AppUser } from '../../auth/auth.service.js';
import type { Upload } from '../../cashier/cashier.service.js';
import { UploadListingsDto } from './dto/imports.dto.js';
import { ListingJobsService } from './listing-jobs.service.js';

/** New listings from photos: upload photos of products that are not in the shop yet, and a photo computer makes a draft listing of each for the Imports inbox. */
@ApiTags('Admin: new listings from photos')
@Controller('admin/listing-jobs')
@Access('staff')
export class AdminListingJobsController {
  constructor(private readonly jobs: ListingJobsService) {}

  /** Sends the photos to the photo computer. Photos are WebP, JPEG or PNG, up to 5 MB each, at most 40 at a time. */
  @Post()
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('photos', 40, { limits: { fileSize: 5 * 1024 * 1024 } }))
  async upload(
    @CurrentUser() admin: AppUser,
    @UploadedFiles() files: Upload[] | undefined,
    @Body() dto: UploadListingsDto,
  ) {
    return { success: true, ...(await this.jobs.createBatch(admin.id, files ?? [], dto.options)) };
  }

  /** Recent photos with how far each has got, and whether a photo computer that can write listings is connected. */
  @Get()
  async list() {
    return { success: true, ...(await this.jobs.list()) };
  }

  /** Takes a photo that has not started out of the queue. */
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@CurrentUser() admin: AppUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.jobs.cancel(admin.id, id);
    return { success: true };
  }

  /** Puts a failed photo back in the queue. */
  @Post(':id/retry')
  @HttpCode(200)
  async retry(@CurrentUser() admin: AppUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.jobs.retry(admin.id, id);
    return { success: true };
  }
}
