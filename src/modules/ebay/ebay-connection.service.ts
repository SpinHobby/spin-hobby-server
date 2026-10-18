import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AppError } from '../../common/errors.js';
import { storefrontUrl } from '../../config/app.config.js';
import {
  ebayAdminReturnUrl,
  ebayIsProduction,
  ebayMarketplaceId,
  ebayTokenKey,
} from '../../config/ebay.config.js';
import { Db } from '../../database/db.service.js';
import { EbayClient } from '../../integrations/ebay/ebay.client.js';
import { sealToken } from '../../integrations/ebay/token-crypto.js';
import { AdminLog } from '../admin/admin-log.service.js';

export interface ConnectionRow {
  environment: 'sandbox' | 'production';
  marketplace_id: string;
  username: string | null;
  connected_at: string;
  refresh_expires_at: string | null;
  fulfillment_policy_id: string | null;
  payment_policy_id: string | null;
  return_policy_id: string | null;
  merchant_location_key: string | null;
  orders_read_until: string | null;
  last_order_check_at: string | null;
  last_push_at: string | null;
  last_reconcile_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
}

const STATE_MINUTES = 15;

/**
 * The shop's eBay seller account: connecting it (an owner signs in on eBay's own page and approves the shop's app; the tokens come back to
 * this server and are kept encrypted), the business policies and stock location every listing uses, and disconnecting.
 */
@Injectable()
export class EbayConnectionService {
  constructor(
    private readonly db: Db,
    private readonly ebay: EbayClient,
    private readonly log: AdminLog,
  ) {}

  row() {
    return this.db.one<ConnectionRow>('select * from public.ebay_connection where id = 1');
  }

  /** Everything the admin shows about eBay: set up on the server, connected, ready to list, and how the stock sync is doing. */
  async status() {
    const c = await this.row();
    const counts = await this.db.many<{ status: string; n: number }>(
      'select status, count(*)::int as n from public.ebay_listings group by status',
    );
    const recent = await this.db.many<{
      order_id: string;
      sku: string | null;
      quantity: number;
      status: string;
      error: string | null;
      ordered_at: string | null;
      created_at: string;
      updated_at: string;
      title: string | null;
    }>(
      `select l.order_id, l.sku, l.quantity, l.status, l.error, l.ordered_at, l.created_at, l.updated_at, p.name as title
         from public.ebay_order_lines l left join public.catalog_products p on p.square_item_id = l.square_item_id
        where l.status <> 'skipped' order by l.updated_at desc limit 20`,
    );
    const count = (s: string) => counts.find((x) => x.status === s)?.n ?? 0;
    const ready =
      !!c &&
      !!c.fulfillment_policy_id &&
      !!c.payment_policy_id &&
      !!c.return_policy_id &&
      !!c.merchant_location_key;
    return {
      configured: this.ebay.configured() && !!ebayTokenKey(),
      environment: ebayIsProduction() ? 'production' : 'sandbox',
      marketplace: ebayMarketplaceId(),
      connected: !!c,
      username: c?.username ?? null,
      connectedAt: c?.connected_at ?? null,
      expiresAt: c?.refresh_expires_at ?? null,
      // the connection was made against the other eBay (sandbox vs production): it cannot be used
      wrongEnvironment: !!c && c.environment !== (ebayIsProduction() ? 'production' : 'sandbox'),
      ready,
      setup: c
        ? {
            fulfillmentPolicyId: c.fulfillment_policy_id,
            paymentPolicyId: c.payment_policy_id,
            returnPolicyId: c.return_policy_id,
            merchantLocationKey: c.merchant_location_key,
          }
        : null,
      sync: c
        ? {
            lastOrderCheckAt: c.last_order_check_at,
            ordersReadUntil: c.orders_read_until,
            lastPushAt: c.last_push_at,
            lastReconcileAt: c.last_reconcile_at,
            lastError: c.last_error,
            lastErrorAt: c.last_error_at,
          }
        : null,
      listings: {
        active: count('active'),
        outOfStock: count('out_of_stock'),
        ended: count('ended'),
        problems: count('error'),
      },
      recentSales: recent.map((r) => ({
        orderId: r.order_id,
        sku: r.sku,
        title: r.title,
        quantity: r.quantity,
        status: r.status,
        error: r.error,
        orderedAt: r.ordered_at,
        updatedAt: r.updated_at,
      })),
    };
  }

  /** Starts connecting: a one-time state for this owner, and eBay's sign-in page to send them to. */
  async startConnect(adminId: string) {
    if (!ebayTokenKey())
      throw new AppError('eBay is not set up on the server (EBAY_TOKEN_KEY is missing).', 503);
    const state = randomBytes(24).toString('base64url');
    await this.db.exec('delete from public.ebay_oauth_states where expires_at < now()');
    await this.db.exec(
      `insert into public.ebay_oauth_states (state, created_by, expires_at) values ($1, $2, now() + interval '${STATE_MINUTES} minutes')`,
      [state, adminId],
    );
    return { url: this.ebay.authorizeUrl(state) };
  }

  /** eBay sent the owner back: the state must be one this server handed out, then the code becomes the seller's tokens. */
  async finishConnect(code: string, state: string) {
    const started = await this.db.one<{ created_by: string | null }>(
      'delete from public.ebay_oauth_states where state = $1 and expires_at > now() returning created_by',
      [state],
    );
    if (!started)
      throw new AppError(
        'This eBay sign-in link has expired or was already used. Start again from Settings.',
        400,
      );
    const tokens = await this.ebay.exchangeCode(code);
    const username = await this.ebay.username(tokens.access_token);
    const now = Date.now();
    await this.db.exec(
      `insert into public.ebay_connection (id, environment, marketplace_id, username, access_token, access_expires_at, refresh_token, refresh_expires_at, scopes, connected_by, connected_at, orders_read_until)
       values (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
       on conflict (id) do update set environment = excluded.environment, marketplace_id = excluded.marketplace_id, username = excluded.username,
         access_token = excluded.access_token, access_expires_at = excluded.access_expires_at, refresh_token = excluded.refresh_token,
         refresh_expires_at = excluded.refresh_expires_at, scopes = excluded.scopes, connected_by = excluded.connected_by, connected_at = now(),
         last_error = null, last_error_at = null`,
      [
        ebayIsProduction() ? 'production' : 'sandbox',
        ebayMarketplaceId(),
        username,
        sealToken(tokens.access_token),
        new Date(now + tokens.expires_in * 1000).toISOString(),
        sealToken(tokens.refresh_token ?? ''),
        tokens.refresh_token_expires_in
          ? new Date(now + tokens.refresh_token_expires_in * 1000).toISOString()
          : null,
        'sell.inventory sell.account sell.fulfillment commerce.identity.readonly',
        started.created_by,
      ],
    );
    if (started.created_by)
      await this.log.write(started.created_by, 'ebay.connected', username ?? 'eBay', {});
    return { username };
  }

  /** Where the owner lands after eBay's sign-in page. */
  adminUrl(outcome: string) {
    const base = ebayAdminReturnUrl() ?? `${storefrontUrl().replace(/\/$/, '')}/admin`;
    return `${base}?ebay=${encodeURIComponent(outcome)}#Settings`;
  }

  /**
   * Disconnects the seller account. Refused while listings are live on eBay: they would go on selling with nobody keeping their stock in step
   * with Square, so they must be ended first (or `force` given by an owner who has ended them on eBay by hand).
   */
  async disconnect(adminId: string, force = false) {
    const live = await this.db.one<{ n: number }>(
      "select count(*)::int as n from public.ebay_listings where status in ('active', 'out_of_stock')",
    );
    if ((live?.n ?? 0) > 0 && !force)
      throw new AppError(
        `${live!.n} product${live!.n === 1 ? ' is' : 's are'} listed on eBay. End ${live!.n === 1 ? 'it' : 'them'} first: after disconnecting, nothing keeps eBay's stock in step with the shop, so a sold-out item could sell again.`,
        409,
      );
    await this.db.exec('delete from public.ebay_connection where id = 1');
    if (force)
      await this.db.exec(
        "update public.ebay_listings set status = 'ended' where status in ('active', 'out_of_stock')",
      );
    await this.log.write(adminId, 'ebay.disconnected', 'eBay', { force });
  }

  /** The seller's business policies and stock locations, read from eBay now, to choose from. */
  async setupChoices() {
    await this.requireConnected();
    const [policies, locations] = await Promise.all([this.ebay.policies(), this.ebay.locations()]);
    return { policies, locations };
  }

  /** Saves the policies and location every listing uses. Each must be one the seller really has on eBay. */
  async saveSetup(
    adminId: string,
    choice: {
      fulfillmentPolicyId: string;
      paymentPolicyId: string;
      returnPolicyId: string;
      merchantLocationKey: string;
    },
  ) {
    const { policies, locations } = await this.setupChoices();
    if (!policies.fulfillment.some((p) => p.id === choice.fulfillmentPolicyId))
      throw new AppError('Choose one of your eBay shipping policies.');
    if (!policies.payment.some((p) => p.id === choice.paymentPolicyId))
      throw new AppError('Choose one of your eBay payment policies.');
    if (!policies.returns.some((p) => p.id === choice.returnPolicyId))
      throw new AppError('Choose one of your eBay return policies.');
    if (!locations.some((l) => l.key === choice.merchantLocationKey))
      throw new AppError('Choose one of your eBay locations.');
    await this.db.exec(
      'update public.ebay_connection set fulfillment_policy_id = $1, payment_policy_id = $2, return_policy_id = $3, merchant_location_key = $4 where id = 1',
      [
        choice.fulfillmentPolicyId,
        choice.paymentPolicyId,
        choice.returnPolicyId,
        choice.merchantLocationKey,
      ],
    );
    await this.log.write(adminId, 'ebay.setup_saved', 'eBay', choice);
    return this.status();
  }

  /** Creates the shop's stock location on eBay (where items ship from), and uses it. */
  async createLocation(
    adminId: string,
    address: {
      name: string;
      addressLine1: string;
      city: string;
      stateOrProvince: string;
      postalCode: string;
      country: string;
    },
  ) {
    await this.requireConnected();
    const key = `spinhobby-${randomBytes(3).toString('hex')}`;
    await this.ebay.createLocation(key, address);
    await this.db.exec(
      'update public.ebay_connection set merchant_location_key = $1 where id = 1',
      [key],
    );
    await this.log.write(adminId, 'ebay.location_created', key, { city: address.city });
    return { key };
  }

  async requireConnected(): Promise<ConnectionRow> {
    const c = await this.row();
    if (!c) throw new AppError('eBay is not connected. An owner can connect it in Settings.', 409);
    if (c.environment !== (ebayIsProduction() ? 'production' : 'sandbox'))
      throw new AppError(
        `eBay was connected to its ${c.environment} site, but the server now uses the other one. Connect eBay again.`,
        409,
      );
    return c;
  }

  async requireReady(): Promise<
    ConnectionRow & {
      fulfillment_policy_id: string;
      payment_policy_id: string;
      return_policy_id: string;
      merchant_location_key: string;
    }
  > {
    const c = await this.requireConnected();
    if (
      !c.fulfillment_policy_id ||
      !c.payment_policy_id ||
      !c.return_policy_id ||
      !c.merchant_location_key
    )
      throw new AppError(
        'Finish setting up eBay first (Settings → eBay: shipping, payment and return policies, and a location).',
        409,
      );
    return c as never;
  }
}
