import { Module } from '@nestjs/common';
import { HelloController } from './hello.controller.js';
import { NotesController } from './notes.controller.js';
import { NotesService } from './notes.service.js';

/** The sample REST API: GET /hello, and notes kept in the database (/hello/notes). */
@Module({
  controllers: [HelloController, NotesController],
  providers: [NotesService],
})
export class HelloModule {}
