import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AppError } from '../../../common/errors.js';
import { RateLimit } from '../../../common/guards/rate-limit.guard.js';
import { Access } from '../../auth/access.js';
import type { Upload } from '../../cashier/cashier.service.js';
import {
  ClaimJobDto,
  JobFailDto,
  JobProgressDto,
  JobResultDto,
  ListingResultDto,
  PairDto,
  ReceiveDraftDto,
} from './dto/imports.dto.js';
import { AppToken, GleamshelfTokenGuard } from './gleamshelf-token.guard.js';
import { ImportsService } from './imports.service.js';
import { ListingJobsService } from './listing-jobs.service.js';
import { DescribeJobsService } from './describe-jobs.service.js';
import { BarcodeFindingsService } from './barcode-findings.service.js';
import { DescribeResultDto } from './dto/describe.dto.js';
import { PhotoJobsService } from './photo-jobs.service.js';
import { AssistantService } from '../../assistant/assistant.service.js';
import {
  AssistantAnswerDto,
  AssistantClaimDto,
  AssistantProfileDto,
} from '../../assistant/dto/assistant.dto.js';

/** The finished photo, and (from Gleamshelf 0.2 on) the product alone on a transparent background, so the shop can put it on its own backgrounds. */
const PHOTO_AND_CUTOUT = FileFieldsInterceptor(
  [
    { name: 'photo', maxCount: 1 },
    { name: 'cutout', maxCount: 1 },
  ],
  { limits: { fileSize: 6 * 1024 * 1024 } },
);
type PhotoFiles = { photo?: Upload[]; cutout?: Upload[] };
const photoFiles = (files: PhotoFiles | undefined) => {
  const file = files?.photo?.[0];
  if (!file) throw new AppError('photo is required');
  return { file, cutout: files?.cutout?.[0] ?? null };
};

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
    private readonly describe: DescribeJobsService,
    private readonly barcodes: BarcodeFindingsService,
    private readonly assistant: AssistantService,
  ) {}

  /** The shop assistant: the app says it is on or off, and gives the assistant's name, portrait and whether it talks. */
  @Post('assistant/profile')
  @HttpCode(200)
  @UseGuards(GleamshelfTokenGuard)
  @ApiBearerAuth()
  assistantProfile(@AppToken() tokenId: string, @Body() dto: AssistantProfileDto) {
    return { success: true, ...this.assistant.setProfile(tokenId, dto) };
  }

  /** The shop assistant: waits (up to 25 s) for a visitor's question; `question` is null when none came. Waiting keeps it online. */
  @Post('assistant/claim')
  @HttpCode(200)
  @UseGuards(GleamshelfTokenGuard)
  @ApiBearerAuth()
  async assistantClaim(@AppToken() tokenId: string, @Body() dto: AssistantClaimDto) {
    return { success: true, question: await this.assistant.claim(tokenId, dto.wait) };
  }

  /** The shop assistant: the answer to a question it took, with the answer in its voice when it has one. */
  @Post('assistant/:id/answer')
  @HttpCode(200)
  @UseGuards(GleamshelfTokenGuard)
  @ApiBearerAuth()
  assistantAnswer(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssistantAnswerDto) {
    this.assistant.answer(id, dto);
    return { success: true };
  }

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
  @UseInterceptors(PHOTO_AND_CUTOUT)
  async receive(
    @AppToken() tokenId: string,
    @UploadedFiles() files: PhotoFiles | undefined,
    @Body() dto: ReceiveDraftDto,
  ) {
    const { file, cutout } = photoFiles(files);
    return { success: true, ...(await this.imports.receive(tokenId, dto.draft, file, cutout)) };
  }

  /** The next photo to improve, or no job. Asking also tells the shop this photo computer is awake and what it can do. */
  @Post('jobs/claim')
  @HttpCode(200)
  @UseGuards(GleamshelfTokenGuard)
  @ApiBearerAuth()
  async claim(@AppToken() tokenId: string, @Body() dto: ClaimJobDto) {
    return { success: true, job: await this.jobs.claim(tokenId, dto.features, dto.note) };
  }

  /** The improved photo of a job the app holds. */
  @Post('jobs/:id/result')
  @HttpCode(200)
  @UseGuards(GleamshelfTokenGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(PHOTO_AND_CUTOUT)
  async result(
    @AppToken() tokenId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: PhotoFiles | undefined,
    @Body() dto: JobResultDto,
  ) {
    const { file, cutout } = photoFiles(files);
    await this.jobs.submit(tokenId, id, dto.details, file, cutout);
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
    return { success: true, job: await this.listings.claim(tokenId, dto.features, dto.note) };
  }

  /** The draft and finished photo of a listing job the app holds: the draft goes into the Imports inbox. */
  @Post('listing-jobs/:id/result')
  @HttpCode(200)
  @UseGuards(GleamshelfTokenGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(PHOTO_AND_CUTOUT)
  async listingResult(
    @AppToken() tokenId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: PhotoFiles | undefined,
    @Body() dto: ListingResultDto,
  ) {
    const { file, cutout } = photoFiles(files);
    return {
      success: true,
      ...(await this.listings.submit(tokenId, id, dto.draft, dto.details, file, cutout)),
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

  /** How far the app has got with a photo it is improving: shown in the admin as a progress bar. */
  @Post('jobs/:id/progress')
  @HttpCode(200)
  @UseGuards(GleamshelfTokenGuard)
  @ApiBearerAuth()
  async photoProgress(
    @AppToken() tokenId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: JobProgressDto,
  ) {
    await this.jobs.progress(tokenId, id, dto.percent, dto.step);
    return { success: true };
  }

  /** How far the app has got with an uploaded photo it is making a listing from: shown in the admin as a progress bar. */
  @Post('listing-jobs/:id/progress')
  @HttpCode(200)
  @UseGuards(GleamshelfTokenGuard)
  @ApiBearerAuth()
  async listingProgress(
    @AppToken() tokenId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: JobProgressDto,
  ) {
    await this.listings.progress(tokenId, id, dto.percent, dto.step);
    return { success: true };
  }

  /** Up to 20 products shoppers can see that have no barcode, with their photo addresses, for the app to read barcodes off. Empty when none are left. */
  @Post('barcode-jobs/claim')
  @HttpCode(200)
  @UseGuards(GleamshelfTokenGuard)
  @ApiBearerAuth()
  async claimBarcodes() {
    return { success: true, products: await this.barcodes.claim() };
  }

  /** What the app found for the products it claimed: `{ results: [{ productId, code, source: "photo" | "page" | "both" }] }`, `code` null for none. */
  @Post('barcode-jobs/result')
  @HttpCode(200)
  @UseGuards(GleamshelfTokenGuard)
  @ApiBearerAuth()
  async barcodeResults(@Body() body: unknown) {
    const results = (body as { results?: unknown })?.results;
    if (!Array.isArray(results) || results.length > 50)
      throw new AppError('Send at most 50 results.');
    const clean = results.map((r) => {
      const { productId, code, source } = (r ?? {}) as Record<string, unknown>;
      if (typeof productId !== 'string' || !productId || productId.length > 120)
        throw new AppError('Each result needs a productId.');
      return { productId, code, source };
    });
    return { success: true, ...(await this.barcodes.report(clean)) };
  }

  /** The next shop product to describe, or no job. The app says what it can do ("describe" means it can read a photo, look the product up and write). */
  @Post('describe-jobs/claim')
  @HttpCode(200)
  @UseGuards(GleamshelfTokenGuard)
  @ApiBearerAuth()
  async claimDescribe(@AppToken() tokenId: string, @Body() dto: ClaimJobDto) {
    return { success: true, job: await this.describe.claim(tokenId, dto.features) };
  }

  /** The proposal for a product the app holds: it waits in the admin for a person to apply or skip it. */
  @Post('describe-jobs/:id/result')
  @HttpCode(200)
  @UseGuards(GleamshelfTokenGuard)
  @ApiBearerAuth()
  async describeResult(
    @AppToken() tokenId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DescribeResultDto,
  ) {
    await this.describe.submit(tokenId, id, dto.result);
    return { success: true };
  }

  /** The app could not describe this product. */
  @Post('describe-jobs/:id/fail')
  @HttpCode(200)
  @UseGuards(GleamshelfTokenGuard)
  @ApiBearerAuth()
  async failDescribe(
    @AppToken() tokenId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: JobFailDto,
  ) {
    await this.describe.fail(tokenId, id, dto.error ?? '');
    return { success: true };
  }

  /** How far the app has got with a product it is describing. */
  @Post('describe-jobs/:id/progress')
  @HttpCode(200)
  @UseGuards(GleamshelfTokenGuard)
  @ApiBearerAuth()
  async describeProgress(
    @AppToken() tokenId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: JobProgressDto,
  ) {
    await this.describe.progress(tokenId, id, dto.percent, dto.step);
    return { success: true };
  }
}
