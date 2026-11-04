import { Injectable } from '@nestjs/common';
import { AppError, notFound } from '../../../common/errors.js';
import { auditDriveFolderId } from '../../../config/google.config.js';
import { Db } from '../../../database/db.service.js';
import {
  FOLDER_MIME,
  GoogleDriveClient,
  type DriveFile,
} from '../../../integrations/google-drive/google-drive.client.js';
import { AdminLog } from '../admin-log.service.js';
import { atLeast, rolesFrom } from '../../auth/roles.js';

/** Roles that need the owner's say-so for Audit (staff and up, below owner, who always has it). */
const STAFF_BELOW_OWNER = rolesFrom('staff').filter((r) => !atLeast(r, 'owner'));
/** The shop's time zone: a "day" in the sales report starts and ends at midnight here. */
const SHOP_TIME_ZONE = 'America/Toronto';
/** The longest period one report covers. */
const MAX_DAYS = 400;
/** How far up the folder tree a file is looked for before it counts as outside the audit folder. */
const MAX_DEPTH = 25;

export interface SalesOrder {
  id: number;
  paid_at: string;
  status: string;
  provider: string;
  subtotal_cents: number;
  discount_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  refunded_cents: number;
  country: string | null;
  province: string | null;
  billing_email: string;
}

/**
 * Admin > Audit: the documents in the shop's Google Drive audit folder, and sales records for a period. Only owners and the staff
 * the owner allows (`profiles.can_audit`) get here; every document opened is written to admin_logs.
 */
@Injectable()
export class AdminAuditService {
  constructor(
    private readonly db: Db,
    private readonly drive: GoogleDriveClient,
    private readonly log: AdminLog,
  ) {}

  /** One folder of the audit folder (the top one when `folderId` is absent), with the path to it. */
  async folder(folderId?: string) {
    const root = auditDriveFolderId();
    if (!root || !this.drive.isConfigured()) return { connected: false as const };
    const path = await this.pathTo(folderId ?? root, root);
    const here = path.at(-1)!;
    if (here.mimeType !== FOLDER_MIME) throw new AppError('That is a file, not a folder.');
    const files = await this.drive.list(here.id);
    return {
      connected: true as const,
      path: path.map((f) => ({ id: f.id, name: f.name })),
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        folder: f.mimeType === FOLDER_MIME,
        size: f.size === undefined ? null : Number(f.size),
        modifiedTime: f.modifiedTime,
      })),
    };
  }

  /** A document's bytes, for the admin's viewer. Only files inside the audit folder; each opening is logged. */
  async document(adminId: string, fileId: string) {
    const root = auditDriveFolderId();
    if (!root || !this.drive.isConfigured())
      throw new AppError('Google Drive is not connected.', 503);
    const file = (await this.pathTo(fileId, root)).at(-1)!;
    if (file.mimeType === FOLDER_MIME) throw new AppError('That is a folder, not a document.');
    const download = await this.drive.download(file);
    await this.log.write(adminId, 'audit.document_viewed', file.id, { name: file.name });
    return download;
  }

  /**
   * Sales for a period: every order paid in it (with any refunds against it), the refunds made in it (which can be for orders
   * paid earlier), totals, and tax by province. Amounts are CAD cents.
   */
  async sales(from: string, to: string) {
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (days < 0) throw new AppError('The period ends before it starts.');
    if (days > MAX_DAYS) throw new AppError(`Choose a period of at most ${MAX_DAYS} days.`);
    const range = [from, to, SHOP_TIME_ZONE];
    const orders = await this.db.many<SalesOrder>(
      `select o.id, o.paid_at, o.status, o.provider, o.subtotal_cents, o.discount_cents, o.shipping_cents, o.tax_cents, o.total_cents,
              o.shipping_address->>'country' as country, upper(o.shipping_address->>'province') as province, o.billing_email,
              coalesce((select sum((e.data->>'amount_cents')::int) from public.order_events e
                         where e.order_id = o.id and e.event_type = 'refunded'), 0)::int as refunded_cents
         from public.orders o
        where o.paid_at >= ($1::date::timestamp at time zone $3)
          and o.paid_at < (($2::date + 1)::timestamp at time zone $3)
        order by o.paid_at, o.id`,
      range,
    );
    const refunds = await this.db.many<{
      order_id: number;
      created_at: string;
      amount_cents: number;
    }>(
      `select e.order_id, e.created_at, coalesce((e.data->>'amount_cents')::int, 0) as amount_cents
         from public.order_events e
        where e.event_type = 'refunded'
          and e.created_at >= ($1::date::timestamp at time zone $3)
          and e.created_at < (($2::date + 1)::timestamp at time zone $3)
        order by e.created_at`,
      range,
    );
    const sum = <T>(rows: T[], amount: (row: T) => number) =>
      rows.reduce((total, row) => total + Number(amount(row)), 0);
    const refundedCents = sum(refunds, (r) => r.amount_cents);
    const totals = {
      orders: orders.length,
      subtotalCents: sum(orders, (o) => o.subtotal_cents),
      discountCents: sum(orders, (o) => o.discount_cents),
      shippingCents: sum(orders, (o) => o.shipping_cents),
      taxCents: sum(orders, (o) => o.tax_cents),
      grossCents: sum(orders, (o) => o.total_cents),
      refunds: refunds.length,
      refundedCents,
      netCents: sum(orders, (o) => o.total_cents) - refundedCents,
    };
    const byRegion = new Map<
      string,
      {
        country: string | null;
        province: string | null;
        orders: number;
        taxCents: number;
        totalCents: number;
      }
    >();
    for (const o of orders) {
      const key = `${o.country ?? ''}|${o.province ?? ''}`;
      const row = byRegion.get(key) ?? {
        country: o.country,
        province: o.province,
        orders: 0,
        taxCents: 0,
        totalCents: 0,
      };
      row.orders += 1;
      row.taxCents += Number(o.tax_cents);
      row.totalCents += Number(o.total_cents);
      byRegion.set(key, row);
    }
    const taxByRegion = [...byRegion.values()].sort((a, b) => b.taxCents - a.taxCents);
    return { from, to, timeZone: SHOP_TIME_ZONE, totals, taxByRegion, orders, refunds };
  }

  /** Staff and owners, and who may open Audit (owners always can). */
  async access() {
    return this.db.many<{ id: string; email: string; role: string; can_audit: boolean }>(
      `select id, email, role, (role::text = any($2::text[]) or can_audit) as can_audit
         from public.profiles where role::text = any($1::text[]) order by array_position($1::text[], role::text) desc, email`,
      [rolesFrom('staff'), rolesFrom('owner')],
    );
  }

  /** Lets a staff account into Audit, or takes it away (owners always have it). */
  async setAccess(ownerId: string, profileId: string, canAudit: boolean) {
    const row = await this.db.one<{ id: string; email: string; role: string; can_audit: boolean }>(
      `update public.profiles set can_audit = $2 where id = $1 and role::text = any($3::text[])
       returning id, email, role, can_audit`,
      [profileId, canAudit, STAFF_BELOW_OWNER],
    );
    if (!row) throw notFound('Staff account');
    await this.log.write(
      ownerId,
      canAudit ? 'audit.access_granted' : 'audit.access_removed',
      row.id,
      { email: row.email },
    );
    return row;
  }

  /**
   * The folders from the audit folder down to `id` (its own entry last). A file that isn't inside the audit folder answers
   * "not found", so ids can't be used to read anything else the shop's Google account can see.
   */
  private async pathTo(id: string, root: string): Promise<DriveFile[]> {
    const path: DriveFile[] = [];
    let at: string | undefined = id;
    for (let depth = 0; at && depth < MAX_DEPTH; depth++) {
      const file = await this.drive.get(at);
      path.unshift(file);
      if (file.id === root) return path;
      at = file.parents?.[0];
    }
    throw notFound('Document');
  }
}
