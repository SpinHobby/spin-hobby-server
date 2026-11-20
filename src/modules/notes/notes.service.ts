import { Injectable, Logger } from '@nestjs/common';
import { Db } from '../../database/db.service.js';

/** Notes left on products. */
@Injectable()
export class NotesService {
  constructor(private readonly db: Db) {}

  /** Every note, newest first. */
  getNotes() {
    const a = new Logger('Hello world');
    a.error('This is a greeting from Notes module server');
    return [];
  }
}
