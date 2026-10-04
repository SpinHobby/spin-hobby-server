import { Injectable } from '@nestjs/common';
import { env, paypalIsLive, squareEnvIsProduction } from '../../config/env.js';
import { StoreService } from '../store/store.service.js';

/** The public, non-secret values the checkout page needs to show the active payment method. */
@Injectable()
export class CheckoutConfigService {
  constructor(private readonly store: StoreService) {}

  async publicConfig() {
    const s = await this.store.settings();
    return {
      success: true,
      provider: s.payment_provider,
      paypalClientId: env('PAYPAL_CLIENT_ID') ?? null,
      paypalEnv: paypalIsLive() ? 'live' : 'sandbox',
      squareApplicationId: env('SQUARE_APPLICATION_ID') ?? null,
      squareLocationId: env('SQUARE_LOCATION_ID') ?? null,
      squareEnv: squareEnvIsProduction() ? 'production' : 'sandbox',
      shippingStandardCents: s.shipping_standard_cents,
      shippingExpressCents: s.shipping_express_cents,
      freeShippingThresholdCents: s.free_shipping_threshold_cents,
      handlingDaysMin: s.handling_days_min,
      handlingDaysMax: s.handling_days_max,
      fxCadUsd: Number(s.fx_cad_usd),
      maintenanceMode: s.maintenance_mode,
      maintenanceMessage: s.maintenance_message,
    };
  }
}
