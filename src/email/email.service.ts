import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../common/errors.js';
import { env } from '../config/env.js';
import type { Row } from '../db/db.service.js';

const money = (cents: unknown) => `$${(Number(cents) / 100).toFixed(2)}`;
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c] ?? c);

/** Transactional email through Resend (same provider the edge function used). */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  get configured() {
    return Boolean(env('RESEND_API_KEY') && env('FROM_EMAIL'));
  }

  async send(to: string, subject: string, html: string): Promise<boolean> {
    const apiKey = env('RESEND_API_KEY');
    const from = env('FROM_EMAIL');
    if (!apiKey || !from) throw new AppError('Email is not configured (RESEND_API_KEY, FROM_EMAIL).', 503);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html }),
      signal: AbortSignal.timeout(8_000), // a slow mail provider must never hold up the caller for long
    });
    if (!res.ok) this.logger.warn(`Resend rejected an email to ${to}: ${res.status}`);
    return res.ok;
  }

  restockHtml(productName: string) {
    const site = env('STOREFRONT_URL') ?? 'https://spinhobby.com';
    return `<p><strong>${escape(productName)}</strong> is back in stock at Spin Hobby.</p><p><a href="${escape(site)}">Shop now</a></p>`;
  }

  shippedHtml(orderId: number, carrier: string | null, tracking: string) {
    return `<p>Good news! Your Spin Hobby order <strong>#${orderId}</strong> is on its way.</p>` +
      `<p>${carrier ? `${escape(carrier)} tracking` : 'Tracking'}: <strong>${escape(tracking)}</strong></p>` +
      `<p>Questions? Reply to this email with your order number.</p>`;
  }

  /** Receipt sent once an order is paid. `order`/`items` are rows from orders / order_items. */
  confirmationHtml(order: Row, items: Row[], handling: { days_min: number; days_max: number }) {
    const site = env('STOREFRONT_URL') ?? 'https://spinhobby.com';
    const a = (order.shipping_address ?? {}) as Record<string, unknown>;
    const address = [
      [a.firstName, a.lastName].filter(Boolean).join(' '), a.address1, a.address2,
      [a.city, a.province].filter(Boolean).join(', ') + (a.postalCode ? ` ${a.postalCode}` : ''), a.country,
    ].filter((line) => typeof line === 'string' && line.trim()).map((line) => escape(line)).join('<br>');
    const rows = items.map((i) =>
      `<tr><td style="padding:4px 12px 4px 0">${escape(i.name)}${i.is_preorder ? ' <em>(pre-order)</em>' : ''}</td>` +
      `<td style="padding:4px 12px">× ${escape(i.quantity)}</td><td style="padding:4px 0;text-align:right">${money(Number(i.unit_price_cents) * Number(i.quantity))}</td></tr>`).join('');
    const total = (label: string, cents: unknown, bold = false) =>
      `<tr><td colspan="2" style="padding:2px 12px 2px 0;text-align:right">${bold ? `<strong>${label}</strong>` : label}</td><td style="padding:2px 0;text-align:right">${bold ? `<strong>${money(cents)}</strong>` : money(cents)}</td></tr>`;
    const hasPreorder = items.some((i) => i.is_preorder);
    const handling_ = handling.days_min === handling.days_max ? `${handling.days_min}` : `${handling.days_min}–${handling.days_max}`;
    return `<p>Thanks for your order! We've received your payment for order <strong>#${escape(order.id)}</strong>.</p>` +
      `<table style="border-collapse:collapse">${rows}${total('Subtotal', order.subtotal_cents)}${total(`Shipping (${order.shipping_method === 'express' ? 'express' : 'standard'})`, order.shipping_cents)}` +
      `${total('Tax', order.tax_cents)}${total('Total (CAD)', order.total_cents, true)}</table>` +
      (address ? `<p><strong>Shipping to</strong><br>${address}</p>` : '') +
      `<p>We'll pack your order within ${handling_} business days and email you tracking once it ships.</p>` +
      (hasPreorder ? `<p>Your pre-order items ship when they arrive from the manufacturer; we'll let you know as soon as we have a date.</p>` : '') +
      `<p>Questions? Reply to this email with your order number.</p><p><a href="${escape(site)}">Back to Spin Hobby</a></p>`;
  }
}
