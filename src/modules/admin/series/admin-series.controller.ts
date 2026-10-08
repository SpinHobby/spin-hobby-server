import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access, CurrentUser } from '../../auth/access.js';
import type { AppUser } from '../../auth/auth.service.js';
import { sentFields } from '../dto/defined-fields.js';
import { CreateSeriesDto, UpdateSeriesDto } from './dto/series.dto.js';
import { SeriesService } from './series.service.js';

/** The list of anime / franchises that products can be filed under (a product's series is optional). */
@ApiTags('Admin: series')
@Controller('admin/series')
@Access('staff')
export class AdminSeriesController {
  constructor(private readonly series: SeriesService) {}

  @Get()
  async list() {
    return { success: true, series: await this.series.list() };
  }

  /** Adds a series. If one with the same name (ignoring case, spacing and punctuation) exists, that one is returned. */
  @Post()
  @HttpCode(200)
  async create(@CurrentUser() admin: AppUser, @Body() dto: CreateSeriesDto) {
    return { success: true, series: await this.series.create(admin.id, dto.name, dto.aliases) };
  }

  @Put(':id')
  async update(
    @CurrentUser() admin: AppUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSeriesDto,
  ) {
    await this.series.update(admin.id, id, sentFields(dto));
    return { success: true };
  }
}
