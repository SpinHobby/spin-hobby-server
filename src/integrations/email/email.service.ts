import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import { escapeHtml as escape } from '../../common/html.js';
import type { OrderItemRow, OrderRow, StorefrontProductRow } from '../../database/rows.js';
import { slugify } from '../../modules/catalog/slug.js';
import { port, publicApiUrl, renderExternalUrl, storefrontUrl } from '../../config/app.config.js';
import { fromEmail, resendApiKey } from '../../config/email.config.js';

const money = (cents: unknown) =>
  `${Number(cents) < 0 ? '-' : ''}$${(Math.abs(Number(cents)) / 100).toFixed(2)}`;
/** A link to the website's order-status page with the order number filled in (the shopper adds their email there). */
const statusLink = (orderId: number) =>
  `<p><a href="${escape(`${storefrontUrl().replace(/\/$/, '')}/order-status?order=${orderId}`)}">Check your order status</a></p>`;
const site = () => storefrontUrl().replace(/\/$/, '');
/** Where a stop link lands: a small page on the API itself (works even if the website is down). */
const api = () =>
  (publicApiUrl() ?? renderExternalUrl() ?? `http://localhost:${port()}`).replace(/\/$/, '');
const productUrl = (p: StorefrontProductRow) => {
  const slug = slugify(p.name);
  return `${site()}/product/${encodeURIComponent(p.id)}${slug ? `/${slug}` : ''}`;
};
/** One product as an email row: picture, name (linked) and price. */
const productRow = (p: StorefrontProductRow, quantity?: number) =>
  `<tr><td style="padding:6px 12px 6px 0">${p.images?.[0] ? `<img src="${escape(p.images[0])}" alt="" width="64" height="64" style="object-fit:contain">` : ''}</td>` +
  `<td style="padding:6px 0"><a href="${escape(productUrl(p))}">${escape(p.name)}</a>${quantity && quantity > 1 ? ` × ${quantity}` : ''}<br>${money(p.price_cents)} ${escape(p.currency || 'CAD')}</td></tr>`;
/** Every email a shopper opted in to says who sent it and why (Canada's anti-spam law). */
const optInFooter = (why: string, stopUrl: string, stopText: string) =>
  `<p style="font-size:12px">${why} <a href="${escape(stopUrl)}">${stopText}</a>. Spin Hobby, Canada · ${escape(site())}</p>`;

/** Transactional email through Resend: order confirmations, shipping and refund notices, and restock alerts. */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  get configured() {
    return Boolean(resendApiKey() && fromEmail());
  }

  async send(to: string, subject: string, html: string): Promise<boolean> {
    const apiKey = resendApiKey();
    const from = fromEmail();
    if (!apiKey || !from)
      throw new AppError('Email is not configured (RESEND_API_KEY, FROM_EMAIL).', 503);
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
    const site = storefrontUrl();
    return `<p><strong>${escape(productName)}</strong> is back in stock at Spin Hobby.</p><p><a href="${escape(site)}">Shop now</a></p>`;
  }

  /** "You left something in your cart": the items still for sale, a link that opens the same cart again, and a stop link. */
  cartReminderHtml(items: { product: StorefrontProductRow; quantity: number }[], token: string) {
    return (
      `<p>You left these in your Spin Hobby cart. They're still here, but popular items and pre-orders can go fast.</p>` +
      `<table style="border-collapse:collapse">${items.map((i) => productRow(i.product, i.quantity)).join('')}</table>` +
      `<p><a href="${escape(`${site()}/checkout?restore=${token}`)}"><strong>Finish checking out</strong></a></p>` +
      optInFooter(
        "You're getting this one reminder because you asked for it at checkout.",
        `${api()}/reminders/stop?token=${token}`,
        'Stop cart reminders',
      )
    );
  }

  /** New pre-orders from the series and makers someone follows; a stop link for each follow. */
  preorderNewsHtml(
    products: StorefrontProductRow[],
    follows: { kind: string; name: string; token: string }[],
  ) {
    const rows = products
      .map((p) => {
        const until = p.order_by_date
          ? ` · order by ${new Date(p.order_by_date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}`
          : '';
        return productRow(p).replace('</td></tr>', `${until}</td></tr>`);
      })
      .join('');
    const stops = follows
      .map(
        (f) =>
          `<a href="${escape(`${api()}/follows/stop?token=${f.token}`)}">Stop news about ${escape(f.name)}</a>`,
      )
      .join(' · ');
    return (
      `<p>New pre-order${products.length === 1 ? '' : 's'} at Spin Hobby from what you follow:</p>` +
      `<table style="border-collapse:collapse">${rows}</table>` +
      `<p>Pre-orders are reserved now and ship on release.</p>` +
      `<p style="font-size:12px">You're getting this because you asked for news about ${follows.map((f) => escape(f.name)).join(', ')}. ${stops}. Spin Hobby, Canada · ${escape(site())}</p>`
    );
  }

  shippedHtml(orderId: number, carrier: string | null, tracking: string) {
    return (
      `<p>Good news! Your Spin Hobby order <strong>#${orderId}</strong> is on its way.</p>` +
      `<p>${carrier ? `${escape(carrier)} tracking` : 'Tracking'}: <strong>${escape(tracking)}</strong></p>` +
      statusLink(orderId) +
      `<p>Questions? Reply to this email with your order number.</p>`
    );
  }

  /** Sent when an order is refunded: in full (the order is cancelled) or in part. */
  refundedHtml(orderId: number, amountCents: number, full: boolean) {
    return (
      (full
        ? `<p>Your Spin Hobby order <strong>#${orderId}</strong> has been cancelled and refunded in full: <strong>${money(amountCents)}</strong>.</p>`
        : `<p>We've refunded <strong>${money(amountCents)}</strong> of your Spin Hobby order <strong>#${orderId}</strong>.</p>`) +
      `<p>The money goes back to the card or PayPal account you paid with. Depending on your bank it can take 5 to 10 business days to show.</p>` +
      `<p>Questions? Reply to this email with your order number.</p>`
    );
  }

  /** Receipt sent once an order is paid. `order`/`items` are rows from orders / order_items. */
  confirmationHtml(
    order: OrderRow,
    items: Pick<OrderItemRow, 'name' | 'quantity' | 'unit_price_cents' | 'is_preorder'>[],
    handling: { days_min: number; days_max: number },
  ) {
    const site = storefrontUrl();
    const a = order.shipping_address ?? {};
    const address = [
      [a.firstName, a.lastName].filter(Boolean).join(' '),
      a.address1,
      a.address2,
      [a.city, a.province].filter(Boolean).join(', ') + (a.postalCode ? ` ${a.postalCode}` : ''),
      a.country,
    ]
      .filter((line) => typeof line === 'string' && line.trim())
      .map((line) => escape(line))
      .join('<br>');
    const rows = items
      .map(
        (i) =>
          `<tr><td style="padding:4px 12px 4px 0">${escape(i.name)}${i.is_preorder ? ' <em>(pre-order)</em>' : ''}</td>` +
          `<td style="padding:4px 12px">× ${escape(i.quantity)}</td><td style="padding:4px 0;text-align:right">${money(Number(i.unit_price_cents) * Number(i.quantity))}</td></tr>`,
      )
      .join('');
    const total = (label: string, cents: unknown, bold = false) =>
      `<tr><td colspan="2" style="padding:2px 12px 2px 0;text-align:right">${bold ? `<strong>${label}</strong>` : label}</td><td style="padding:2px 0;text-align:right">${bold ? `<strong>${money(cents)}</strong>` : money(cents)}</td></tr>`;
    const hasPreorder = items.some((i) => i.is_preorder);
    const handling_ =
      handling.days_min === handling.days_max
        ? `${handling.days_min}`
        : `${handling.days_min}–${handling.days_max}`;
    return (
      `<p>Thanks for your order! We've received your payment for order <strong>#${escape(order.id)}</strong>.</p>` +
      `<table style="border-collapse:collapse">${rows}${total('Subtotal', order.subtotal_cents)}${Number(order.discount_cents) ? total(`Discount${order.discount_code ? ` (${escape(order.discount_code)})` : ''}`, -Number(order.discount_cents)) : ''}${total(`Shipping (${order.shipping_carrier ? escape(`${order.shipping_carrier} ${order.shipping_service ?? ''}`.trim()) : order.shipping_method === 'express' ? 'express' : 'standard'})`, order.shipping_cents)}` +
      `${total('Tax', order.tax_cents)}${total('Total (CAD)', order.total_cents, true)}</table>` +
      (address ? `<p><strong>Shipping to</strong><br>${address}</p>` : '') +
      `<p>We'll pack your order within ${handling_} business days and email you tracking once it ships.</p>` +
      (hasPreorder
        ? `<p>Your pre-order items ship when they arrive from the manufacturer; we'll let you know as soon as we have a date.</p>`
        : '') +
      statusLink(Number(order.id)) +
      `<p>Questions? Reply to this email with your order number.</p><p><a href="${escape(site)}">Back to Spin Hobby</a></p>`
    );
  }
}
