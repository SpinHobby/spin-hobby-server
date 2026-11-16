import { Injectable } from '@nestjs/common';
import { Db } from '../../database/db.service.js';

/** Saving a signed-in shopper's own name. */
@Injectable()
export class ProfileService {
  constructor(private readonly db: Db) {}

  /** Saves the signed-in person's own name. `null` clears a name. */
  async saveName(userId: string, name: { firstName: string | null; lastName: string | null }) {
    await this.db.exec('update public.profiles set first_name = $2, last_name = $3 where id = $1', [
      userId,
      name.firstName,
      name.lastName,
    ]);
  }
}
