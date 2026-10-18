import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { errorText } from '../../common/errors.js';
import { inventoryEvents } from '../../common/inventory-events.js';
import { isTest } from '../../config/app.config.js';
import { ebayReconcileIntervalMinutes, ebaySyncIntervalMinutes } from '../../config/ebay.config.js';
import { Db } from '../../database/db.service.js';
import { EbayClient, EbayError, type EbayOrder } from '../../integrations/ebay/ebay.client.js';
import { SquareCatalogClient } from '../../integrations/square/square-catalog.client.js';

interface ListingRow {
  square_item_id: string;
  variation_id: string;
  sku: string;
  offer_id: string | null;
  listing_id: string | null;
  status: string;
  quantity: number;
}

/** Orders are read again from a little before where the last check stopped: a late write on eBay's side must not slip through. */
const OVERLAP_MS = 15 * 60_000;
/** eBay takes at most 25 listings per quantity update. */
const BATCH = 25;
/** Square stock changes are gathered for this long, so a burst (a sync of the whole catalog) makes one update to eBay. */
const DEBOUNCE_MS = 2_000;

/**
 * Keeps eBay and the shop selling the same units. Square holds the one count of what is on the shelf (the website and the till sell through
 * it). Two directions:
 *
 *  - An eBay sale takes the unit off Square. eBay's orders are read every few minutes; each order line is recorded once (`ebay_order_lines`),
 *    and the Square change carries an idempotency key made from the order line, so a line can never be counted twice, even if a check is
 *    repeated or stops halfway. A cancelled eBay order puts its units back, once.
 *  - Square's count goes to eBay. Whenever Square's stock changes (its webhook, the scheduled sync, an eBay sale just applied) the listings of
 *    those products get Square's count, read fresh from Square; and every half hour every listing is set again, so any drift is corrected.
 */
@Injectable()
export class EbaySyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('EbaySync');
  private timers: NodeJS.Timeout[] = [];
  private unsubscribe: (() => void) | null = null;
  private pending = new Set<string>();
  private debounce: NodeJS.Timeout | null = null;
  private checking: Promise<unknown> | null = null;
  private pushing: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: Db,
    private readonly ebay: EbayClient,
    private readonly square: SquareCatalogClient,
  ) {}

  onModuleInit() {
    this.unsubscribe = inventoryEvents.on((ids) => this.stockChanged(ids));
    if (isTest()) return;
    const orders = ebaySyncIntervalMinutes();
    if (orders > 0)
      this.timers.push(
        setInterval(() => void this.checkOrders().catch(() => undefined), orders * 60_000),
      );
    const reconcile = ebayReconcileIntervalMinutes();
    if (reconcile > 0)
      this.timers.push(
        setInterval(() => void this.reconcile().catch(() => undefined), reconcile * 60_000),
      );
    for (const t of this.timers) t.unref?.();
  }

  onModuleDestroy() {
    this.unsubscribe?.();
    for (const t of this.timers) clearInterval(t);
    if (this.debounce) clearTimeout(this.debounce);
  }

  private async connected(): Promise<boolean> {
    return !!(await this.db.one('select 1 from public.ebay_connection where id = 1'));
  }

  private async noteError(error: unknown) {
    const text = error instanceof Error ? error.message : errorText(error);
    this.logger.warn(`eBay sync: ${text}`);
    await this.db
      .exec(
        'update public.ebay_connection set last_error = $1, last_error_at = now() where id = 1',
        [text.slice(0, 500)],
      )
      .catch(() => undefined);
  }

  // ---- eBay sales -> Square ----------------------------------------------------------------------------------------------------------

  /** Reads eBay orders changed since the last check and applies every sale (and cancellation) to Square. One check at a time. */
  checkOrders(): Promise<{ applied: number; restocked: number; failed: number }> {
    this.checking ??= this.checkOrdersOnce().finally(() => {
      this.checking = null;
    });
    return this.checking as Promise<{ applied: number; restocked: number; failed: number }>;
  }

  private async checkOrdersOnce() {
    const result = { applied: 0, restocked: 0, failed: 0 };
    const c = await this.db.one<{ orders_read_until: string | null; connected_at: string }>(
      'select orders_read_until, connected_at from public.ebay_connection where id = 1',
    );
    if (!c) return result;
    const startedAt = new Date();
    try {
      const from = new Date(Date.parse(c.orders_read_until ?? c.connected_at) - OVERLAP_MS);
      const orders = await this.ebay.ordersChangedSince(from);
      const touched = new Set<string>();
      for (const order of orders) {
        for (const line of order.lineItems ?? []) {
          const outcome = await this.applyLine(order, line).catch(async (e: unknown) => {
            await this.noteError(e);
            return 'failed' as const;
          });
          if (outcome === 'applied') result.applied++;
          if (outcome === 'restocked') result.restocked++;
          if (outcome === 'failed') result.failed++;
          if (outcome !== 'none' && outcome !== 'failed' && line.sku) touched.add(line.sku);
        }
      }
      // lines that failed before (Square was down) are tried again even if their order did not change
      for (const retry of await this.db.many<{ order_id: string }>(
        "select distinct order_id from public.ebay_order_lines where status = 'failed'",
      )) {
        const again = orders.find((o) => o.orderId === retry.order_id);
        if (!again) result.failed += await this.retryFailed(retry.order_id);
      }
      await this.db.exec(
        `update public.ebay_connection set orders_read_until = $1, last_order_check_at = now()${result.failed ? '' : ', last_error = null, last_error_at = null'} where id = 1`,
        [startedAt.toISOString()],
      );
      // the listings of what sold: eBay already took its own unit; they get Square's new count (one unit may have sold on both at once)
      if (touched.size) {
        const variations = await this.db.many<{ variation_id: string }>(
          'select variation_id from public.ebay_listings where sku = any($1::text[])',
          [[...touched]],
        );
        await this.pushQuantities(variations.map((v) => v.variation_id));
      }
      return result;
    } catch (error) {
      await this.noteError(error);
      throw error;
    }
  }

  /**
   * One eBay order line, applied to Square exactly once. The Square change's idempotency key is made from the order line, so if this stops
   * after Square took the unit but before the line was recorded, the next check repeats the same change and Square counts it once.
   */
  private async applyLine(
    order: EbayOrder,
    line: NonNullable<EbayOrder['lineItems']>[number],
  ): Promise<'applied' | 'restocked' | 'failed' | 'none'> {
    const cancelled = order.cancelStatus?.cancelState === 'CANCELED';
    const seen = await this.db.one<{ status: string }>(
      'select status from public.ebay_order_lines where order_id = $1 and line_item_id = $2',
      [order.orderId, line.lineItemId],
    );
    if (seen?.status === 'restocked' || seen?.status === 'skipped') return 'none';
    if (seen?.status === 'applied' && !cancelled) return 'none';
    const listing = line.sku
      ? await this.db.one<ListingRow>('select * from public.ebay_listings where sku = $1', [
          line.sku,
        ])
      : null;
    if (!listing) {
      // not one of the shop's listings made here (an item listed on eBay by hand): recorded, left alone
      await this.record(order, line, null, 'skipped', null);
      return 'none';
    }
    const quantity = Math.max(1, Math.round(Number(line.quantity) || 1));
    if (seen?.status === 'applied' && cancelled) {
      await this.square.adjustStock(
        listing.variation_id,
        quantity,
        `ebay-restock-${order.orderId}-${line.lineItemId}`,
      );
      await this.record(order, line, listing, 'restocked', null);
      return 'restocked';
    }
    if (cancelled) {
      // cancelled before the shop ever counted it: nothing to put back
      await this.record(order, line, listing, 'skipped', 'cancelled before it was applied');
      return 'none';
    }
    try {
      await this.square.adjustStock(
        listing.variation_id,
        -quantity,
        `ebay-sale-${order.orderId}-${line.lineItemId}`,
        order.creationDate ?? new Date().toISOString(),
      );
    } catch (error) {
      await this.record(
        order,
        line,
        listing,
        'failed',
        `Square did not take the sale: ${errorText(error)}`.slice(0, 500),
      );
      throw error;
    }
    await this.record(order, line, listing, 'applied', null);
    return 'applied';
  }

  private async record(
    order: EbayOrder,
    line: NonNullable<EbayOrder['lineItems']>[number],
    listing: ListingRow | null,
    status: 'applied' | 'restocked' | 'skipped' | 'failed',
    error: string | null,
  ) {
    await this.db.exec(
      `insert into public.ebay_order_lines (order_id, line_item_id, sku, square_item_id, quantity, status, error, ordered_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (order_id, line_item_id) do update set status = excluded.status, error = excluded.error, square_item_id = excluded.square_item_id`,
      [
        order.orderId,
        line.lineItemId,
        line.sku ?? null,
        listing?.square_item_id ?? null,
        Math.max(1, Math.round(Number(line.quantity) || 1)),
        status,
        error,
        order.creationDate ?? null,
      ],
    );
  }

  /** A line Square refused earlier: tried again with the same idempotency key (so it still counts once). Returns how many still fail. */
  private async retryFailed(orderId: string): Promise<number> {
    const lines = await this.db.many<{
      line_item_id: string;
      sku: string | null;
      quantity: number;
      ordered_at: string | null;
    }>(
      "select line_item_id, sku, quantity, ordered_at from public.ebay_order_lines where order_id = $1 and status = 'failed'",
      [orderId],
    );
    let failed = 0;
    for (const l of lines) {
      const outcome = await this.applyLine(
        { orderId, creationDate: l.ordered_at ?? undefined, lineItems: [] },
        { lineItemId: l.line_item_id, sku: l.sku ?? undefined, quantity: l.quantity },
      ).catch(() => 'failed' as const);
      if (outcome === 'failed') failed++;
    }
    return failed;
  }

  // ---- Square -> eBay ----------------------------------------------------------------------------------------------------------------

  /** Square's count of these variations may have changed: their eBay listings are updated shortly (bursts are gathered into one update). */
  stockChanged(variationIds: string[]) {
    for (const id of variationIds) this.pending.add(id);
    if (this.debounce) return;
    this.debounce = setTimeout(() => {
      this.debounce = null;
      const ids = [...this.pending];
      this.pending.clear();
      void this.pushQuantities(ids).catch(() => undefined);
    }, DEBOUNCE_MS);
    this.debounce.unref?.();
  }

  /**
   * Sets the eBay quantity of the listings of these variations (all live listings when none are given) to Square's count, read fresh from
   * Square. Only changed quantities are sent unless `force`. Pushes run one after another, so two never race on the same listing.
   */
  pushQuantities(
    variationIds?: string[],
    force = false,
  ): Promise<{ updated: number; failed: number }> {
    const run = this.pushing.then(() => this.pushOnce(variationIds, force));
    this.pushing = run.catch(() => undefined);
    return run;
  }

  private async pushOnce(variationIds: string[] | undefined, force: boolean) {
    const out = { updated: 0, failed: 0 };
    if (!(await this.connected())) return out;
    const listings = await this.db.many<ListingRow>(
      `select * from public.ebay_listings where status in ('active', 'out_of_stock')${variationIds ? ' and variation_id = any($1::text[])' : ''}`,
      variationIds ? [variationIds] : [],
    );
    if (!listings.length) return out;
    try {
      const counts = await this.square.getInventoryCounts([
        ...new Set(listings.map((l) => l.variation_id)),
      ]);
      const changes = listings
        .map((l) => ({ l, quantity: Math.max(0, Math.floor(counts[l.variation_id] ?? 0)) }))
        .filter(({ l, quantity }) => force || quantity !== l.quantity);
      for (let i = 0; i < changes.length; i += BATCH) {
        const batch = changes.slice(i, i + BATCH);
        const answers = await this.ebay.setQuantities(
          batch.map(({ l, quantity }) => ({ sku: l.sku, offerId: l.offer_id, quantity })),
        );
        for (const { l, quantity } of batch) {
          const answer = answers.find((a) => a.sku === l.sku) ?? {
            ok: false,
            error: 'eBay did not answer for this listing',
          };
          if (answer.ok) {
            await this.settle(l, quantity);
            out.updated++;
          } else if (quantity > 0 && l.offer_id && (await this.republish(l, quantity))) {
            out.updated++;
          } else {
            out.failed++;
            await this.db.exec(
              'update public.ebay_listings set last_error = $2 where square_item_id = $1',
              [
                l.square_item_id,
                `eBay did not take the new quantity (${quantity}): ${answer.error ?? 'no reason given'}`.slice(
                  0,
                  500,
                ),
              ],
            );
          }
        }
      }
      await this.db.exec('update public.ebay_connection set last_push_at = now() where id = 1');
      if (out.failed)
        await this.noteError(
          new Error(
            `${out.failed} eBay listing${out.failed === 1 ? '' : 's'} did not take Square's quantity`,
          ),
        );
      return out;
    } catch (error) {
      await this.noteError(error);
      throw error;
    }
  }

  private async settle(l: ListingRow, quantity: number) {
    await this.db.exec(
      "update public.ebay_listings set quantity = $2, pushed_at = now(), last_error = null, status = case when $2 = 0 then 'out_of_stock' else 'active' end where square_item_id = $1",
      [l.square_item_id, quantity],
    );
  }

  /**
   * A listing eBay ended when it ran out (an account without eBay's "out-of-stock control" ends a listing at quantity 0) has stock again: its
   * offer is published again, which makes a new listing.
   */
  private async republish(l: ListingRow, quantity: number): Promise<boolean> {
    try {
      const offers = await this.ebay.offersFor(l.sku);
      const offer = offers.find((o) => o.offerId === l.offer_id) ?? offers[0];
      if (!offer || offer.status === 'PUBLISHED') return false;
      await this.ebay.setQuantities([{ sku: l.sku, offerId: offer.offerId, quantity }]);
      const listingId = await this.ebay.publishOffer(offer.offerId);
      await this.db.exec(
        "update public.ebay_listings set offer_id = $2, listing_id = $3, quantity = $4, pushed_at = now(), status = 'active', last_error = null where square_item_id = $1",
        [l.square_item_id, offer.offerId, listingId, quantity],
      );
      return true;
    } catch (error) {
      if (!(error instanceof EbayError)) throw error;
      return false;
    }
  }

  /** Sets every live listing to Square's count again, whether or not it seems to have changed: corrects any drift. */
  async reconcile() {
    if (!(await this.connected())) return { updated: 0, failed: 0 };
    const out = await this.pushQuantities(undefined, true);
    await this.db.exec('update public.ebay_connection set last_reconcile_at = now() where id = 1');
    return out;
  }

  /** "Check now" in the admin: eBay's orders first (sales come off Square), then every listing set to Square's count. */
  async syncNow() {
    const orders = await this.checkOrders();
    const stock = await this.reconcile();
    return { orders, stock };
  }
}
