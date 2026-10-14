import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AppError } from '../../../common/errors.js';
import { RateLimit } from '../../../common/guards/rate-limit.guard.js';
import { Access } from '../../auth/access.js';
import type { Upload } from '../../cashier/cashier.service.js';
import {
  ClaimJobDto,
  JobFailDto,
  JobResultDto,
  ListingResultDto,
  PairDto,
  ReceiveDraftDto,
} from './dto/imports.dto.js';
import { AppToken, GleamshelfTokenGuard } from './gleamshelf-token.guard.js';
import { ImportsService } from './imports.service.js';
import { ListingJobsService } from './listing-jobs.service.js';
import { PhotoJobsService } from './photo-jobs.service.js';

/**
 * What a connected Gleamshelf app calls. Not for people: there is no sign-in here, the app proves itself with the token it got by trading the
 * code an owner showed in the admin. It can send drafts and read the category and series lists, nothing else.
 */
@ApiTags('Gleamshelf app')
@Controller('gleamshelf')
@Access('public')
export class GleamshelfController {
  constructor(
    private readonly imports: ImportsService,
    private readonly jobs: PhotoJobsService,
    private readonly listings: ListingJobsService,
  ) {}

  /** Trades the 8-digit code from the admin for the app's token. The token is shown once. */
  @Post('pair')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowMs: 60_000 })
  async pair(@Body() dto: PairDto) {
    return { success: true, ...(await this.imports.pair(dto.code, dto.label)) };
  }

  /** Whether the token still works. */
  @Get('ping')
  @UseGuards(GleamshelfTokenGuard)
  @ApiBearerAuth()
  ping() {
    return { success: true };
  }

  /** The shop's category and series lists, so the app files its drafts under names the shop already uses. */
  @Get('config')
  @UseGuards(GleamshelfTokenGuard)
  @ApiBearerAuth()
  async config() {
    return { success: true, ...(await this.imports.config()) };
  }

  /** A draft and its finished photo. Sending the same source photo again replaces the draft while nobody has handled it. */
  @Post('imports')
  @HttpCode(200)
  @UseGuards(GleamshelfTokenGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 6 * 1024 * 1024 } }))
  async receive(
    @AppToken() tokenId: string,
    @UploadedFile() file: Upload | undefined,
    @Body() dto: ReceiveDraftDto,
  ) {
    if (!file) throw new AppError('photo is required');
    return { success: true, ...(await this.imports.receive(tokenId, dto.draft, file)) };
  }

  /** The next photo to improve, or no job. Asking also tells the shop this photo computer is awake and what it can do. */
  @Post('jobs/claim')
  @HttpCode(200)
  @UseGuards(GleamshelfTokenGuard)
  @ApiBearerAuth()
  async claim(@AppToken() tokenId: string, @Body() dto: ClaimJobDto) {
    return { success: true, job: await this.jobs.claim(tokenId, dto.features) };
  }

  /** The improved photo of a job the app holds. */
  @Post('jobs/:id/result')
  @HttpCode(200)
  @UseGuards(GleamshelfTokenGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 6 * 1024 * 1024 } }))
  async result(
    @AppToken() tokenId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Upload | undefined,
    @Body() dto: JobResultDto,
  ) {
    if (!file) throw new AppError('photo is required');
    await this.jobs.submit(tokenId, id, dto.details, file);
    return { success: true };
  }

  /** The app could not do this photo. */
  @Post('jobs/:id/fail')
  @HttpCode(200)
  @UseGuards(GleamshelfTokenGuard)
  @ApiBearerAuth()
  async fail(
    @AppToken() tokenId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: JobFailDto,
  ) {
    await this.jobs.fail(tokenId, id, dto.error ?? '');
    return { success: true };
  }

  /** The next uploaded photo to make a listing from, or no job. The app says what it can do ("listing" means it can read a box and write a draft). */
  @Post('listing-jobs/claim')
  @HttpCode(200)
  @UseGuards(GleamshelfTokenGuard)
  @ApiBearerAuth()
  async claimListing(@AppToken() tokenId: string, @Body() dto: ClaimJobDto) {
    return { success: true, job: await this.listings.claim(tokenId, dto.features) };
  }

  /** The draft and finished photo of a listing job the app holds: the draft goes into the Imports inbox. */
  @Post('listing-jobs/:id/result')
  @HttpCode(200)
  @UseGuards(GleamshelfTokenGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 6 * 1024 * 1024 } }))
  async listingResult(
    @AppToken() tokenId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Upload | undefined,
    @Body() dto: ListingResultDto,
  ) {
    if (!file) throw new AppError('photo is required');
    return {
      success: true,
      ...(await this.listings.submit(tokenId, id, dto.draft, dto.details, file)),
    };
  }

  /** The app could not make a listing from this photo. */
  @Post('listing-jobs/:id/fail')
  @HttpCode(200)
  @UseGuards(GleamshelfTokenGuard)
  @ApiBearerAuth()
  async failListing(
    @AppToken() tokenId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: JobFailDto,
  ) {
    await this.listings.fail(tokenId, id, dto.error ?? '');
    return { success: true };
  }
}
