import { Injectable } from '@nestjs/common';
import { StoreService } from '../store/store.service.js';
import { paypalClientId, paypalIsLive } from '../../config/paypal.config.js';
import {
  squareApplicationId,
  squareIsProduction,
  squareLocationId,
} from '../../config/square.config.js';

/** The public, non-secret values the checkout page needs to show the active payment method. */
@Injectable()
export class CheckoutConfigService {
  constructor(private readonly store: StoreService) {}

  async publicConfig() {
    const s = await this.store.settings();
    return {
      success: true,
      provider: s.payment_provider,
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
    };
  }
}
