import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access } from '../auth/access.js';
import { CreateNoteDto } from './dto/note.dto.js';
import { NotesService } from './notes.service.js';

/** Sample REST API on top of a database table: anyone may read the notes, staff may add and delete them. */
@ApiTags('Hello')
@Controller('hello/notes')
@Access('public')
export class NotesController {
  private readonly logger = new Logger(NotesController.name);

  constructor(private readonly notes: NotesService) {}

  /** Every note, newest first. */
  @Get()
  async list() {
    return { success: true, notes: await this.notes.list() };
  }

  /** Adds a note. Staff only (`@Access` on a method wins over the one on the class). */
  @Post()
  @HttpCode(200)
  @Access('staff')
  async create(@Body() dto: CreateNoteDto) {
    const note = await this.notes.create(dto.text);
    this.logger.log(`note added: ${note.id}`);
    return { success: true, note };
  }

  /** Deletes a note. Staff only. Answers 404 when it is not there. */
  @Delete(':id')
  @Access('staff')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.notes.remove(id);
    return { success: true };
  }
}
