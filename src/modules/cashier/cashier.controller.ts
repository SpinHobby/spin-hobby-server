import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AppError } from '../../common/errors.js';
import { Access } from '../auth/access.js';
import { CashierService, type Upload } from './cashier.service.js';
import {
  CashierSearchQuery,
  IdentifyDto,
  RecordItemDto,
  UpdateItemDto,
} from './dto/cashier.dto.js';
import { IdentifyService } from './identify.service.js';

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
    return { success: true, ...(await this.identifier.identify(file, dto.condition === 'sealed')) };
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
