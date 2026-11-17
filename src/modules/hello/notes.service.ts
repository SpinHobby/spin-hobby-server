import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import { Db } from '../../database/db.service.js';
import type { NoteRow } from '../../database/rows.js';

/** What a note looks like to the API's callers. */
export type Note = Pick<NoteRow, 'id' | 'text' | 'created_at'>;

/** The sample REST API's notes, kept in `public.notes`. All the SQL for notes lives here. */
@Injectable()
export class NotesService {
  constructor(private readonly db: Db) {}

  /** Every note, newest first. */
  list() {
    return this.db.many<Note>(
      'select id, text, created_at from public.notes order by created_at desc',
    );
  }

  /** Saves a new note and returns it as stored (with its id and time). */
  async create(text: string) {
    const note = await this.db.one<Note>(
      'insert into public.notes (text) values ($1) returning id, text, created_at',
      [text],
    );
    return note!;
  }

  /** Deletes one note. Answers 404 when there is no note with that id. */
  async remove(id: string) {
    const gone = await this.db.one<{ id: string }>(
      'delete from public.notes where id = $1 returning id',
      [id],
    );
    if (!gone) throw new AppError('There is no note with that id.', 404);
  }
}
