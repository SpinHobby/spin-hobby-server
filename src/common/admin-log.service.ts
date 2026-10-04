import { Injectable } from '@nestjs/common';
import { Db, type Queryable } from '../db/db.service.js';

@Injectable()
export class AdminLog {
  constructor(private readonly db: Db) {}
  write(
    adminId: string,
    action: string,
    target: string,
    data: Record<string, unknown> = {},
    tx?: Queryable,
  ) {
    return this.db.exec(
      'insert into public.admin_logs (admin_id, action, target, data) values ($1, $2, $3, $4)',
      [adminId, action, target, JSON.stringify(data)],
      tx,
    );
  }
}
