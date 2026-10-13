import {
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
import { QuickAddDto } from '../products/dto/quick-add.dto.js';
import { ImportsQuery, RejectImportDto } from './dto/imports.dto.js';
import { ImportsService } from './imports.service.js';

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

  /** Adds the draft as a product: the same body as the quick add (the draft's photo is used; any photos sent are ignored). */
  @Post(':id/add')
  @HttpCode(200)
  async add(
    @CurrentUser() admin: AppUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: QuickAddDto,
  ) {
    return { success: true, product: await this.imports.add(admin.id, id, dto) };
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
}
