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
import { AdminEventsService } from './admin-events.service.js';
import { EventDto } from './dto/event.dto.js';

/** Events for the "Meet us at the con" strip on the storefront. */
@ApiTags('Admin: events')
@Controller('admin/events')
@Access('staff')
export class AdminEventsController {
  constructor(private readonly events: AdminEventsService) {}

  @Get()
  async list() {
    return { success: true, events: await this.events.list() };
  }

  @Post()
  @HttpCode(200)
  async create(@CurrentUser() admin: AppUser, @Body() dto: EventDto) {
    return { success: true, event: await this.events.create(admin.id, dto) };
  }

  /** Replaces the whole event: send every field. */
  @Put(':id')
  async replace(
    @CurrentUser() admin: AppUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: EventDto,
  ) {
    return { success: true, event: await this.events.replace(admin.id, id, dto) };
  }

  @Delete(':id')
  async remove(@CurrentUser() admin: AppUser, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.events.remove(admin.id, id);
    return { success: true };
  }
}
