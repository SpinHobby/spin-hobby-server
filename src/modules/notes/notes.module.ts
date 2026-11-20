import { Module } from '@nestjs/common';
import { NotesController } from './notes.controller.js';
import { NotesService } from './notes.service.js';

/** Notes on products: listed and added through the API. */
@Module({
  controllers: [NotesController],
  providers: [NotesService],
})
export class NotesModule {}
