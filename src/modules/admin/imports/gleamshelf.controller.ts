import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import { PairDto, ReceiveDraftDto } from './dto/imports.dto.js';
import { AppToken, GleamshelfTokenGuard } from './gleamshelf-token.guard.js';
import { ImportsService } from './imports.service.js';

/**
 * What a connected Gleamshelf app calls. Not for people: there is no sign-in here, the app proves itself with the token it got by trading the
 * code an owner showed in the admin. It can send drafts and read the category and series lists, nothing else.
 */
@ApiTags('Gleamshelf app')
@Controller('gleamshelf')
@Access('public')
export class GleamshelfController {
  constructor(private readonly imports: ImportsService) {}

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
}
