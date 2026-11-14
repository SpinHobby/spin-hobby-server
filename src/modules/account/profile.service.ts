import { Injectable } from '@nestjs/common';
import { Db, type Queryable } from '../../database/db.service.js';
import type { ProfileDto, SavedAddress } from './dto/profile.dto.js';

interface AddressRow {
  first_name: string;
  last_name: string;
  address1: string;
  address2: string | null;
  city: string;
  province: string;
  postal_code: string;
  country: 'CA' | 'US';
  phone: string | null;
}

/** A customer's own name, phone and saved shipping address, and whether they have been through the welcome step. */
@Injectable()
export class ProfileService {
  constructor(private readonly db: Db) {}

  /** Saves what was sent (a field left out stays as it is) and marks the welcome step as seen. */
  async update(userId: string, dto: ProfileDto) {
    return this.db.transaction(async (tx) => {
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
        tx,
      );
      if (dto.address) {
        const a: SavedAddress = dto.address;
        const values = [
          userId,
          row?.first_name ?? '',
          row?.last_name ?? '',
          a.address1,
          a.address2,
          a.city,
          a.province,
          a.postalCode,
          a.country,
          row?.phone ?? null,
        ];
        // The default address is replaced; any other saved addresses are left alone.
        const updated = await this.db.many(
          `update public.customer_addresses
              set first_name = $2, last_name = $3, address1 = $4, address2 = $5, city = $6, province = $7,
                  postal_code = $8, country = $9, phone = $10, updated_at = now()
            where user_id = $1 and is_default
            returning id`,
          values,
          tx,
        );
        if (!updated.length)
          await this.db.exec(
            `insert into public.customer_addresses
               (user_id, first_name, last_name, address1, address2, city, province, postal_code, country, phone, is_default)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)`,
            values,
            tx,
          );
      }
      return {
        firstName: row?.first_name ?? null,
        lastName: row?.last_name ?? null,
        phone: row?.phone ?? null,
        address: await this.address(userId, tx),
        welcomed: true,
      };
    });
  }

  /** The customer's default shipping address, for checkout to fill in; null when none is saved. */
  async address(userId: string, tx?: Queryable) {
    const a = await this.db.one<AddressRow>(
      `select first_name, last_name, address1, address2, city, province, postal_code, country, phone
         from public.customer_addresses where user_id = $1 and is_default`,
      [userId],
      tx,
    );
    if (!a) return null;
    return {
      firstName: a.first_name,
      lastName: a.last_name,
      address1: a.address1,
      address2: a.address2,
      city: a.city,
      province: a.province,
      postalCode: a.postal_code,
      country: a.country,
      phone: a.phone,
    };
  }
}
