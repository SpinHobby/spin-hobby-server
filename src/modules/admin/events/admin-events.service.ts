import { Injectable } from '@nestjs/common';
import { AppError, notFound } from '../../../common/errors.js';
import { Db } from '../../../database/db.service.js';
import { AdminLog } from '../admin-log.service.js';
import type { EventDto } from './dto/event.dto.js';

/** Conventions and pop-up events for the storefront's "Meet us at the con" strip. */
@Injectable()
export class AdminEventsService {
  constructor(
    private readonly db: Db,
    private readonly log: AdminLog,
  ) {}

  list() {
    return this.db.many('select * from public.store_events order by sort_order, created_at');
  }

  private values(dto: EventDto) {
    if (dto.startDate && dto.endDate && dto.endDate < dto.startDate)
      throw new AppError('End date must be on or after the start date.');
    return [
      dto.name,
      dto.city,
      dto.startDate,
      dto.endDate,
      dto.boothInfo,
      dto.isVisible,
      dto.sortOrder,
    ];
  }

  async create(adminId: string, dto: EventDto) {
    const event = await this.db.one(
      `insert into public.store_events (name, city, start_date, end_date, booth_info, is_visible, sort_order)
       values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      this.values(dto),
    );
    await this.log.write(adminId, 'event.created', event!.id, { name: dto.name });
    return event;
  }

  /** Replaces every field of the event (a field left out becomes blank). */
  async replace(adminId: string, id: string, dto: EventDto) {
    const event = await this.db.one(
      `update public.store_events set name = $2, city = $3, start_date = $4, end_date = $5, booth_info = $6, is_visible = $7, sort_order = $8
        where id = $1 returning *`,
      [id, ...this.values(dto)],
    );
    if (!event) throw notFound('Event');
    await this.log.write(adminId, 'event.updated', id, { name: dto.name });
    return event;
  }

  async remove(adminId: string, id: string) {
    await this.db.exec('delete from public.store_events where id = $1', [id]);
    await this.log.write(adminId, 'event.deleted', id);
  }
}
