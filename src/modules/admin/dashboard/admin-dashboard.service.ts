import { Injectable } from '@nestjs/common';
import { Db } from '../../../database/db.service.js';
import type { OrderRow, StorefrontProductRow } from '../../../database/rows.js';

const DAY_MS = 86_400_000;
/** Order statuses that count as a sale. */
const SALE_STATUSES = ['paid', 'preorder_reserved', 'fulfilled', 'shipped'];

/** The numbers and short lists on the admin dashboard. */
@Injectable()
export class AdminDashboardService {
  constructor(private readonly db: Db) {}

  async summary() {
    const [orders, alerts, products, reserved] = await Promise.all([
      this.db.many<
        Pick<OrderRow, 'id' | 'billing_email' | 'total_cents' | 'status' | 'created_at'>
      >(
        'select id, billing_email, total_cents, status, created_at from public.orders order by created_at desc limit 100',
      ),
      this.db.one<{ count: number }>(
        'select count(*)::int as count from public.stock_alerts where notified_at is null',
      ),
      this.db.many<
        Pick<
          StorefrontProductRow,
          'id' | 'name' | 'variation_id' | 'stock_count' | 'status' | 'order_by_date'
        >
      >(
        'select id, name, variation_id, stock_count, status, order_by_date from public.storefront_products',
      ),
      this.db.one<{ units: number }>(
        `select coalesce(sum(i.quantity), 0)::int as units from public.order_items i
           join public.orders o on o.id = i.order_id where o.status = 'preorder_reserved' and i.is_preorder`,
      ),
    ]);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const toShip = orders.filter((o) => o.status === 'paid');
    const preorders = orders.filter((o) => o.status === 'preorder_reserved');
    // The "Low stock" card leads with items that are running low, then the ones already sold out.
    const low = products
      .filter((p) => p.status === 'low' || p.status === 'out')
      .sort((a, b) => Number(a.status === 'out') - Number(b.status === 'out'));
    const lowStockList = low.slice(0, 8);
    const waiting = await this.alertsWaitingByVariation(lowStockList.map((p) => p.variation_id));
    return {
      salesTodayCents: orders
        .filter((o) => new Date(o.created_at) >= today && SALE_STATUSES.includes(o.status))
        .reduce((total, o) => total + Number(o.total_cents), 0),
      toShip: toShip.length,
      oldestToShipDays: toShip.length
        ? Math.floor(
            (Date.now() - Math.min(...toShip.map((o) => new Date(o.created_at).getTime()))) /
              DAY_MS,
          )
        : 0,
      openPreorders: preorders.length,
      preorderProducts: products.filter((p) => p.status === 'pre').length,
      ordersToday: orders.filter((o) => new Date(o.created_at) >= today).length,
      reservedUnits: reserved?.units ?? 0, // units, not orders
      lowStock: low.length,
      alertsWaiting: alerts?.count ?? 0,
      toShipList: toShip.slice(0, 8),
      lowStockList: lowStockList.map((p) => ({
        ...p,
        alerts_waiting: (p.variation_id && waiting.get(p.variation_id)) || 0,
      })),
      closingPreorders: products
        .filter((p) => p.status === 'pre' && p.order_by_date)
        .sort((a, b) => String(a.order_by_date).localeCompare(String(b.order_by_date)))
        .slice(0, 8),
    };
  }

  /** How many shoppers are waiting for a restock email, per variation. */
  private async alertsWaitingByVariation(variationIds: (string | null)[]) {
    const ids = variationIds.filter((id): id is string => Boolean(id));
    if (!ids.length) return new Map<string, number>();
    const rows = await this.db.many<{ square_variation_id: string; n: number }>(
      `select square_variation_id, count(*)::int as n from public.stock_alerts
        where notified_at is null and square_variation_id = any($1::text[]) group by 1`,
      [ids],
    );
    return new Map(rows.map((r) => [r.square_variation_id, r.n]));
  }
}
