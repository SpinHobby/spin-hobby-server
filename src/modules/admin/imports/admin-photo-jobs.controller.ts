import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access, CurrentUser } from '../../auth/access.js';
import type { AppUser } from '../../auth/auth.service.js';
import { ApplyPhotosDto, CreatePhotoBatchDto } from './dto/imports.dto.js';
import { PhotoJobsService } from './photo-jobs.service.js';

/** Better photos for many products at once: send photos to the photo computer, look at the results, use the ones that are good. */
@ApiTags('Admin: photo improvements')
@Controller('admin/photo-batches')
@Access('staff')
export class AdminPhotoJobsController {
  constructor(private readonly jobs: PhotoJobsService) {}

  /** Sends the photos of these products to the photo computer. */
  @Post()
  @HttpCode(200)
  async create(@CurrentUser() admin: AppUser, @Body() dto: CreatePhotoBatchDto) {
    return {
      success: true,
      ...(await this.jobs.createBatch(admin.id, dto.productIds, dto.scope, dto.options)),
    };
  }

  /** Recent batches with how far each has got, and whether a photo computer is connected. */
  @Get()
  async list() {
    return {
      success: true,
      batches: await this.jobs.batches(),
      workers: await this.jobs.workers(),
    };
  }

  @Get(':id')
  async one(@Param('id', ParseUUIDPipe) id: string) {
    return { success: true, batch: await this.jobs.batch(id) };
  }

  /** Uses the finished photos of a batch (all of them, or the ones named). */
  @Post(':id/apply')
  @HttpCode(200)
  async applyMany(
    @CurrentUser() admin: AppUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyPhotosDto,
  ) {
    return { success: true, ...(await this.jobs.applyMany(admin.id, id, dto.jobIds ?? undefined)) };
  }

  /** Takes the photos that have not been started out of the queue. */
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@CurrentUser() admin: AppUser, @Param('id', ParseUUIDPipe) id: string) {
    return { success: true, ...(await this.jobs.cancelBatch(admin.id, id)) };
  }

  @Post('photos/:jobId/apply')
  @HttpCode(200)
  async apply(@CurrentUser() admin: AppUser, @Param('jobId', ParseUUIDPipe) jobId: string) {
    await this.jobs.apply(admin.id, jobId);
    return { success: true };
  }

  @Post('photos/:jobId/reject')
  @HttpCode(200)
  async reject(@CurrentUser() admin: AppUser, @Param('jobId', ParseUUIDPipe) jobId: string) {
    await this.jobs.reject(admin.id, jobId);
    return { success: true };
  }

  @Post('photos/:jobId/retry')
  @HttpCode(200)
  async retry(@CurrentUser() admin: AppUser, @Param('jobId', ParseUUIDPipe) jobId: string) {
    await this.jobs.retry(admin.id, jobId);
    return { success: true };
  }
}
