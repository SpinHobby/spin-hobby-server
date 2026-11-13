import { Injectable } from '@nestjs/common';
import { Db } from '../../database/db.service.js';
import type { ProfileDto } from './dto/profile.dto.js';

/** A customer's own name and phone, and whether they have been through the welcome step. */
@Injectable()
export class ProfileService {
  constructor(private readonly db: Db) {}

  /** Saves what was sent (a field left out stays as it is) and marks the welcome step as seen. */
  async update(userId: string, dto: ProfileDto) {
    const row = await this.db.one<{
      first_name: string | null;
      last_name: string | null;
      phone: string | null;
    }>(
      `update public.profiles
          set first_name = case when $2 then $3 else first_name end,
              last_name = case when $4 then $5 else last_name end,
              phone = case when $6 then $7 else phone end,
              welcomed_at = coalesce(welcomed_at, now())
        where id = $1
        returning first_name, last_name, phone`,
      [
        userId,
        dto.firstName !== undefined,
        dto.firstName ?? null,
        dto.lastName !== undefined,
        dto.lastName ?? null,
        dto.phone !== undefined,
        dto.phone ?? null,
      ],
    );
    return {
      firstName: row?.first_name ?? null,
      lastName: row?.last_name ?? null,
      phone: row?.phone ?? null,
      welcomed: true,
    };
  }
}
