import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access, CurrentUser } from '../../auth/access.js';
import type { AppUser } from '../../auth/auth.service.js';
import { AdminHomepageService } from './admin-homepage.service.js';
import { CreateSlideDto, ReorderSlidesDto, UpdateSlideDto } from './dto/slide.dto.js';

/** The banners at the top of the storefront homepage. */
@ApiTags('Admin: homepage')
@Controller('admin/homepage/slides')
@Access('staff')
export class AdminHomepageController {
  constructor(private readonly homepage: AdminHomepageService) {}

  @Get()
  async list() {
    return { success: true, slides: await this.homepage.list() };
  }

  @Post()
  @HttpCode(200)
  async create(@CurrentUser() admin: AppUser, @Body() dto: CreateSlideDto) {
    return { success: true, slide: await this.homepage.create(admin.id, dto) };
  }

  /** Saves a new order. `PUT` is what the admin sends; `POST` is kept for callers of the original route. */
  @Put('reorder')
  @HttpCode(200)
  async reorderPut(@CurrentUser() admin: AppUser, @Body() dto: ReorderSlidesDto) {
    await this.homepage.reorder(admin.id, dto.ids);
    return { success: true };
  }

  @Post('reorder')
  @HttpCode(200)
  reorderPost(@CurrentUser() admin: AppUser, @Body() dto: ReorderSlidesDto) {
    return this.reorderPut(admin, dto);
  }

  @Put(':id')
  async update(
    @CurrentUser() admin: AppUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateSlideDto,
  ) {
    return { success: true, slide: await this.homepage.update(admin.id, id, dto) };
  }

  @Delete(':id')
  async remove(@CurrentUser() admin: AppUser, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.homepage.remove(admin.id, id);
    return { success: true };
  }
}
