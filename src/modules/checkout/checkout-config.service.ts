import { Injectable } from '@nestjs/common';
import { Db } from '../../database/db.service.js';
import { StoreService } from '../store/store.service.js';
import { ExchangeRateService } from '../../integrations/fx/exchange-rate.service.js';
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
    private readonly fx: ExchangeRateService,
  ) {}

  async publicConfig() {
    const [s, live] = await Promise.all([this.store.settings(), this.fx.cadToUsd()]);
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
      // the US dollar estimate: the Bank of Canada's latest rate, or the rate set in Settings when the bank can't be reached
      fxCadUsd: live?.cadUsd ?? Number(s.fx_cad_usd),
      fxSource: live ? 'bank-of-canada' : 'settings',
      fxDate: live?.date ?? null,
      maintenanceMode: s.maintenance_mode,
      maintenanceMessage: s.maintenance_message,
      // the Shop playlist button (a YouTube playlist id); null hides it
      musicPlaylistId: s.music_playlist_id ?? null,
      productBackground: background ? { id: background.id, url: background.image_url } : null,
    };
  }
}
