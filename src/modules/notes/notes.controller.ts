import { Controller, Get, Logger } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access } from '../auth/access.js';

@ApiTags('Notes')
@Controller('notes')
@Access('public')
export class NotesController {
  private readonly logger = new Logger(NotesController.name);

  /** Runs once, when the server starts. */
  constructor() {
    this.logger.error('This is Notes modules from the server (startup)');
  }

  /** Runs on every `GET /notes`. */
  @Get()
  getNotes() {
    this.logger.warn('This is Notes modules from the server (request)');
    return { success: true, message: 'Hello from the Notes module' };
  }
}
