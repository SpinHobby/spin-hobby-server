import { Injectable } from '@nestjs/common';
import { Db } from '../../database/db.service.js';
import { StoreService } from '../store/store.service.js';
import { testPaymentsActive } from '../payments/test-payments.js';
import { paypalClientId, paypalIsLive } from '../../config/paypal.config.js';
import {
  squareApplicationId,
  squareIsProduction,
  squareLocationId,
} from '../../config/square.config.js';

/** The public, non-secret values the checkout page needs to show the active payment method. */
@Injectable()
export class CheckoutConfigService {
  constructor(
    private readonly store: StoreService,
    private readonly db: Db,
  ) {}

  async publicConfig() {
    const s = await this.store.settings();
    // the shop background: every transparent product photo is shown on it (null: plain white)
    const background = await this.db.one<{ id: string; image_url: string }>(
      'select id, image_url from public.photo_backgrounds where is_default limit 1',
    );
    return {
      success: true,
      // `test` on a local copy with no payment keys: checkout completes with a test payment (no money)
      provider: testPaymentsActive(s.payment_provider) ? 'test' : s.payment_provider,
      paypalClientId: paypalClientId() ?? null,
      paypalEnv: paypalIsLive() ? 'live' : 'sandbox',
      squareApplicationId: squareApplicationId() ?? null,
      squareLocationId: squareLocationId() ?? null,
      squareEnv: squareIsProduction() ? 'production' : 'sandbox',
      shippingStandardCents: s.shipping_standard_cents,
      shippingExpressCents: s.shipping_express_cents,
      freeShippingThresholdCents: s.free_shipping_threshold_cents,
      handlingDaysMin: s.handling_days_min,
      handlingDaysMax: s.handling_days_max,
      fxCadUsd: Number(s.fx_cad_usd),
      maintenanceMode: s.maintenance_mode,
      maintenanceMessage: s.maintenance_message,
      productBackground: background ? { id: background.id, url: background.image_url } : null,
    };
  }
}
