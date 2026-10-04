import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import {
  paypalBaseUrl,
  paypalClientId,
  paypalClientSecret,
  paypalWebhookId,
} from '../../config/paypal.config.js';

const base = () => paypalBaseUrl();
const dollars = (cents: number) => (cents / 100).toFixed(2);

@Injectable()
export class PayPalClient {
  private async token() {
    const id = paypalClientId();
    const secret = paypalClientSecret();
    if (!id || !secret) throw new AppError('PayPal checkout is not configured.', 503);
    const res = await fetch(`${base()}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new AppError('PayPal authentication failed.', 502);
    return ((await res.json()) as { access_token: string }).access_token;
  }

  private async post(path: string, body: unknown, requestId: string) {
    return fetch(`${base()}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': requestId,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async createOrder(orderId: number, totalCents: number): Promise<string> {
    const res = await this.post(
      '/v2/checkout/orders',
      {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: String(orderId),
            amount: { currency_code: 'CAD', value: dollars(totalCents) },
            description: `Spin Hobby order #${orderId}`,
          },
        ],
      },
      `spin-hobby-${orderId}`,
    );
    if (!res.ok) throw new AppError('PayPal could not create a checkout order.', 502);
    return ((await res.json()) as { id: string }).id;
  }

  async capture(paypalOrderId: string, orderId: number) {
    const res = await this.post(
      `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
      undefined,
      `spin-hobby-capture-${orderId}`,
    );
    if (!res.ok) throw new AppError('PayPal could not capture this payment.', 502);
    return (await res.json()) as any;
  }

  async refund(captureId: string, orderId: number, amountCents: number) {
    const res = await this.post(
      `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
      { amount: { currency_code: 'CAD', value: dollars(amountCents) } },
      `spin-hobby-refund-${orderId}-${amountCents}`,
    );
    if (!res.ok) throw new AppError('PayPal rejected the refund.', 502);
  }

  async verifyWebhook(
    headers: Record<string, string | undefined>,
    event: unknown,
  ): Promise<boolean> {
    const webhookId = paypalWebhookId();
    if (!webhookId || !paypalClientId() || !paypalClientSecret()) return false;
    const res = await this.post(
      '/v1/notifications/verify-webhook-signature',
      {
        auth_algo: headers['paypal-auth-algo'],
        cert_url: headers['paypal-cert-url'],
        transmission_id: headers['paypal-transmission-id'],
        transmission_sig: headers['paypal-transmission-sig'],
        transmission_time: headers['paypal-transmission-time'],
        webhook_id: webhookId,
        webhook_event: event,
      },
      `spin-hobby-webhook-${headers['paypal-transmission-id'] ?? Date.now()}`,
    );
    if (!res.ok) return false;
    return (
      ((await res.json()) as { verification_status?: string }).verification_status === 'SUCCESS'
    );
  }
}
