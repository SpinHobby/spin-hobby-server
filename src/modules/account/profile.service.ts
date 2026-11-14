import { Injectable, Logger } from '@nestjs/common';
import { Db, type Queryable } from '../../database/db.service.js';
import { EmailService } from '../../integrations/email/email.service.js';
import type { ProfileDto, SaveAddressDto, SavedAddress } from './dto/profile.dto.js';

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
  private readonly logger = new Logger(ProfileService.name);
  constructor(
    private readonly db: Db,
    private readonly email: EmailService,
  ) {}

  /**
   * Saves what was sent (a field left out stays as it is) and marks the welcome step as seen. The first time it is seen, the
   * welcome email goes out (once per account, after the transaction, never holding up the save).
   */
  async update(userId: string, dto: ProfileDto) {
    const result = await this.db.transaction(async (tx) => {
      const before = await this.db.one<{ welcomed_at: string | null; email: string | null }>(
        'select welcomed_at, email from public.profiles where id = $1 for update',
        [userId],
        tx,
      );
      const row = await this.db.one<{
        first_name: string | null;
        last_name: string | null;
        phone: string | null;
        birth_month: number | null;
        birth_day: number | null;
      }>(
        `update public.profiles
            set first_name = case when $2 then $3 else first_name end,
                last_name = case when $4 then $5 else last_name end,
                phone = case when $6 then $7 else phone end,
                birth_month = case when $8 then $9::smallint else birth_month end,
                birth_day = case when $8 then $10::smallint else birth_day end,
                welcomed_at = coalesce(welcomed_at, now())
          where id = $1
          returning first_name, last_name, phone, birth_month, birth_day`,
        [
          userId,
          dto.firstName !== undefined,
          dto.firstName ?? null,
          dto.lastName !== undefined,
          dto.lastName ?? null,
          dto.phone !== undefined,
          dto.phone ?? null,
          dto.birthday !== undefined,
          dto.birthday?.month ?? null,
          dto.birthday?.day ?? null,
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
        profile: {
          firstName: row?.first_name ?? null,
          lastName: row?.last_name ?? null,
          phone: row?.phone ?? null,
          birthday:
            row?.birth_month && row.birth_day
              ? { month: row.birth_month, day: row.birth_day }
              : null,
          address: await this.address(userId, tx),
          welcomed: true,
        },
        firstWelcome: !before?.welcomed_at && before?.email ? before.email : null,
      };
    });
    if (result.firstWelcome) void this.sendWelcome(result.firstWelcome, result.profile.firstName);
    return result.profile;
  }

  /** The welcome email: best effort, a failure is only logged. */
  private async sendWelcome(to: string, firstName: string | null) {
    try {
      const { subject, html } = this.email.welcomeEmail(firstName);
      await this.email.send(to, subject, html);
    } catch (e) {
      this.logger.warn(`Welcome email not sent: ${String(e)}`);
    }
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

  /** What checkout fills in for a signed-in customer: their saved address, and their own name and phone (for when no address is saved). */
  async checkoutDetails(userId: string) {
    const [address, profile] = await Promise.all([
      this.address(userId),
      this.db.one<{ first_name: string | null; last_name: string | null; phone: string | null }>(
        'select first_name, last_name, phone from public.profiles where id = $1',
        [userId],
      ),
    ]);
    return {
      address,
      profile: {
        firstName: profile?.first_name ?? null,
        lastName: profile?.last_name ?? null,
        phone: profile?.phone ?? null,
      },
    };
  }

  /** Checkout's "Save for next time": replaces the default shipping address (recipient, phone and address); the profile is untouched. */
  async saveAddress(userId: string, dto: SaveAddressDto) {
    const a = dto.address;
    const values = [
      userId,
      dto.firstName,
      dto.lastName,
      a.address1,
      a.address2,
      a.city,
      a.province,
      a.postalCode,
      a.country,
      dto.phone ?? null,
    ];
    await this.db.transaction(async (tx) => {
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
    });
    return this.address(userId);
  }
}
