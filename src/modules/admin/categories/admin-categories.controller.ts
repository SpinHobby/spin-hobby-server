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
import { AdminCategoriesService } from './admin-categories.service.js';
import { CreateCategoryDto, ReorderCategoriesDto, UpdateCategoryDto } from './dto/category.dto.js';

/** The shop category tree that products are filed under. */
@ApiTags('Admin: categories')
@Controller('admin/categories')
@Access('staff')
export class AdminCategoriesController {
  constructor(private readonly categories: AdminCategoriesService) {}

  /** Every category (hidden too) with how many products sit directly in it. */
  @Get()
  async list() {
    return { success: true, categories: await this.categories.list() };
  }

  @Post()
  @HttpCode(200)
  async create(@CurrentUser() admin: AppUser, @Body() dto: CreateCategoryDto) {
    return { success: true, category: await this.categories.create(admin.id, dto) };
  }

  /** Saves a new order. Declared before `:id` so "reorder" isn't read as an id. */
  @Put('reorder')
  async reorder(@CurrentUser() admin: AppUser, @Body() dto: ReorderCategoriesDto) {
    await this.categories.reorder(admin.id, dto.ids);
    return { success: true };
  }

  @Put(':id')
  async update(
    @CurrentUser() admin: AppUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    await this.categories.update(admin.id, id, dto);
    return { success: true };
  }

  /** Deletes the category and all of its subcategories; their products become uncategorised. */
  @Delete(':id')
  async remove(@CurrentUser() admin: AppUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return { success: true, ...(await this.categories.remove(admin.id, id)) };
  }
}
