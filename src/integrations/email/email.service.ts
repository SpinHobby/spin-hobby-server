import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import { escapeHtml as escape } from '../../common/html.js';
import type { OrderItemRow, OrderRow, StorefrontProductRow } from '../../database/rows.js';
import { slugify } from '../../modules/catalog/slug.js';
import {
  discordUrl,
  instagramUrl,
  port,
  publicApiUrl,
  renderExternalUrl,
  rewardsAllowed,
  storefrontUrl,
} from '../../config/app.config.js';
import { ownerEmails, staffEmails } from '../../config/auth.config.js';
import {
  emailAllowlist,
  emailAllowlistOn,
  fromEmail,
  mailpitUrl,
  mailTransport,
  resendApiKey,
  supportEmail,
} from '../../config/email.config.js';
import { EMAIL_COLORS, emailButton, emailLayout, trackingUrl } from './layout.js';

const money = (cents: unknown) =>
  `${Number(cents) < 0 ? '-' : ''}$${(Math.abs(Number(cents)) / 100).toFixed(2)}`;
/** A link to the website's order-status page with the order number filled in (the shopper adds their email there). */
const statusLink = (orderId: number) =>
  emailButton(
    `${storefrontUrl().replace(/\/$/, '')}/order-status?order=${orderId}`,
    'Check your order status',
  );
/** The inbox preview line: the email's first words, without the markup. */
const preheaderOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
const site = () => storefrontUrl().replace(/\/$/, '');
/**
 * Official mascot art for emails, centred: the web copies in the website's public/assets/mascot (originals in
 * SpinHobby/official-assets). Official art only, never generated pictures.
 */
const mascotImage = (file: string, alt: string, width: number) =>
  `<img src="${site()}/assets/mascot/${file}" alt="${alt}" width="${width}" style="display:block;margin:0 auto 12px;width:${width}px;height:auto;border:0">`;
/**
 * A small hand-drawn sparkle or heart cut from Aidi's clover drawing (website public/assets/mascot), used inline as a
 * bullet or divider instead of emoji: `height` in px, the width follows.
 */
const doodle = (file: 'sparkle' | 'sparkle-small' | 'heart-pink' | 'heart-red', height: number) =>
  `<img src="${site()}/assets/mascot/${file}.png" alt="" height="${height}" style="height:${height}px;width:auto;border:0;vertical-align:middle;display:inline-block">`;
/** Aidi's sparkle · heart · sparkle, centred: a soft divider under a heading or greeting. */
const doodleDivider = () =>
  `<p style="margin:0 0 6px;text-align:center">${doodle('sparkle', 18)}&nbsp;&nbsp;${doodle('heart-pink', 16)}&nbsp;&nbsp;${doodle('sparkle-small', 18)}</p>`;
/** One round Discord or Instagram icon with its name under it, linked (icons in the website's public/assets/email). */
const socialIcon = (href: string, icon: string, label: string) =>
  `<td style="padding:0 14px;text-align:center;vertical-align:top">` +
  `<a href="${escape(href)}" style="text-decoration:none;color:${EMAIL_COLORS.primary};font-weight:700;font-size:13px">` +
  `<img src="${site()}/assets/email/${icon}.png" alt="${label}" width="48" height="48" style="display:block;margin:0 auto 6px;width:48px;height:48px;border:0">${label}</a></td>`;
/** "Join our community": the Discord and Instagram invites with their icons, in a soft box (welcome and order emails). */
const communityBox = () =>
  `<div style="margin:22px 0;padding:18px;border-radius:12px;background:${EMAIL_COLORS.bg};border:1px solid ${EMAIL_COLORS.border};text-align:center">` +
  `<p style="margin:0 0 4px;font-weight:700;font-size:18px">${doodle('heart-red', 18)}&nbsp; Join our community &nbsp;${doodle('heart-pink', 18)}</p>` +
  `<p style="margin:0 0 14px;font-size:14px;color:${EMAIL_COLORS.text}">Shelf photos, restock news and con meetups on Discord. New arrivals and moments from the shop on Instagram.</p>` +
  `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="border-collapse:collapse;margin:0 auto"><tr>` +
  socialIcon(discordUrl(), 'discord', 'Discord') +
  socialIcon(instagramUrl(), 'instagram', 'Instagram') +
  `</tr></table>` +
  `</div>`;
const COUNTRY_NAMES: Record<string, string> = { CA: 'Canada', US: 'United States' };
/** Where a stop link lands: a small page on the API itself (works even if the website is down). */
const api = () =>
  (publicApiUrl() ?? renderExternalUrl() ?? `http://localhost:${port()}`).replace(/\/$/, '');
const productUrl = (p: StorefrontProductRow) => {
  const slug = slugify(p.name);
  return `${site()}/product/${encodeURIComponent(p.id.toLowerCase())}${slug ? `/${slug}` : ''}`;
};
/** One product as an email row: picture, name (linked) and price. */
const productRow = (p: StorefrontProductRow, quantity?: number) =>
  `<tr><td style="padding:6px 12px 6px 0">${p.images?.[0] ? `<img src="${escape(p.images[0])}" alt="" width="64" height="64" style="object-fit:contain">` : ''}</td>` +
  `<td style="padding:6px 0"><a href="${escape(productUrl(p))}">${escape(p.name)}</a>${quantity && quantity > 1 ? ` × ${quantity}` : ''}<br>${money(p.price_cents)} ${escape(p.currency || 'CAD')}</td></tr>`;
/** Every email a shopper opted in to says who sent it and why (Canada's anti-spam law). */
const optInFooter = (why: string, stopUrl: string, stopText: string) =>
  `<p style="font-size:12px">${why} <a href="${escape(stopUrl)}">${stopText}</a>. Spin Hobby, Canada · ${escape(site())}</p>`;

/** "Spin Hobby <shop@x.com>" or "shop@x.com" as Mailpit's { Name, Email }. */
export function addressParts(value: string) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  return m
    ? { Name: m[1].replace(/^"|"$/g, ''), Email: m[2].trim() }
    : { Name: '', Email: value.trim() };
}

/** May real email reach this address? Always, unless EMAIL_ALLOWLIST applies (staging, or set by hand). */
export function mayEmail(to: string) {
  if (!emailAllowlistOn()) return true;
  const address = to.trim().toLowerCase();
  const domain = address.slice(address.lastIndexOf('@'));
  const allowed = [...emailAllowlist(), ...ownerEmails(), ...staffEmails()].map((e) =>
    e.toLowerCase(),
  );
  return allowed.includes(address) || allowed.includes(domain);
}

/** Hides most of an address for logs: "ha***@example.com". */
const masked = (to: string) => to.replace(/^(.{0,2})[^@]*/, '$1***');

/**
 * Transactional email: order confirmations, shipping and refund notices, sign-up codes and restock alerts. Sent through Resend, or
 * to a Mailpit inbox on this computer when MAIL_TRANSPORT=mailpit (see config/email.config.ts and docs/EMAIL.md).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  get configured() {
    return mailTransport() !== 'off';
  }

  async send(to: string, subject: string, html: string): Promise<boolean> {
    const transport = mailTransport();
    if (transport === 'off')
      throw new AppError('Email is not configured (RESEND_API_KEY, FROM_EMAIL).', 503);
    const page = emailLayout({
      body: html,
      preheader: preheaderOf(html),
      site: site(),
      supportEmail: supportEmail(),
    });
    if (transport === 'mailpit') return this.toMailpit(to, subject, page);
    if (!mayEmail(to)) {
      // staging: a copy of a real customer's address must never get a test email
      this.logger.log(`Held back "${subject}" to ${masked(to)}: not on EMAIL_ALLOWLIST.`);
      return true;
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromEmail(),
        to: [to],
        reply_to: supportEmail(), // "reply to this email" reaches the shop even when From is a no-reply address
        subject,
        html: page,
      }),
      signal: AbortSignal.timeout(8_000), // a slow mail provider must never hold up the caller for long
    });
    if (!res.ok) this.logger.warn(`Resend rejected an email to ${masked(to)}: ${res.status}`);
    return res.ok;
  }

  /** Local: drops the email into Mailpit's inbox (open MAILPIT_URL in a browser to read it). */
  private async toMailpit(to: string, subject: string, html: string) {
    try {
      const res = await fetch(`${mailpitUrl()}/api/v1/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          From: addressParts(fromEmail() ?? 'Spin Hobby <shop@spinhobby.test>'),
          To: [{ Email: to }],
          ReplyTo: [{ Email: supportEmail() }],
          Subject: subject,
          HTML: html,
        }),
        signal: AbortSignal.timeout(4_000),
      });
      if (!res.ok) this.logger.warn(`Mailpit refused an email to ${to}: ${res.status}`);
      return res.ok;
    } catch {
      this.logger.warn(
        `Mailpit isn't running at ${mailpitUrl()}, so "${subject}" to ${to} was not delivered. Start it with: mailpit`,
      );
      return false;
    }
  }

  /** "It's back": the product's photo, name and price when it's on the shop, and a button straight to it. */
  restockHtml(productName: string, product?: StorefrontProductRow | null) {
    return (
      `<p><strong>${escape(productName)}</strong> is back in stock at Spin Hobby. Restocks can sell out again quickly.</p>` +
      (product ? `<table style="border-collapse:collapse">${productRow(product)}</table>` : '') +
      emailButton(
        product ? productUrl(product) : site(),
        product ? 'View the product' : 'Shop now',
      ) +
      `<p style="font-size:12px">You asked us to tell you when this came back. This was a one-time alert.</p>`
    );
  }

  /** "You left something in your cart": the items still for sale, a link that opens the same cart again, and a stop link. */
  cartReminderHtml(items: { product: StorefrontProductRow; quantity: number }[], token: string) {
    return (
      `<p>You left these in your Spin Hobby cart. They're still here, but popular items and pre-orders can go fast.</p>` +
      `<table style="border-collapse:collapse">${items.map((i) => productRow(i.product, i.quantity)).join('')}</table>` +
      emailButton(`${site()}/checkout?restore=${token}`, 'Finish checking out') +
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
      (follows.some((f) => f.kind === 'all')
        ? `<p>New pre-order${products.length === 1 ? '' : 's'} at Spin Hobby:</p>`
        : `<p>New pre-order${products.length === 1 ? '' : 's'} at Spin Hobby from what you follow:</p>`) +
      `<table style="border-collapse:collapse">${rows}</table>` +
      `<p>Pre-orders are reserved now and ship on release.</p>` +
      emailButton(`${site()}/pre-orders`, 'See all pre-orders') +
      `<p style="font-size:12px">You're getting this because you asked for news about ${follows.map((f) => escape(f.name)).join(', ')}. ${stops}. Spin Hobby, Canada · ${escape(site())}</p>`
    );
  }

  /**
   * The welcome email, sent once when a new customer finishes (or skips) the welcome step after signing up: the mascot, a warm
   * hello, the Discord and Instagram icons near the top (so a quick glance finds them), and where to start. Few emoji on purpose:
   * a wall of them reads as machine-written. Colours only from EMAIL_COLORS; the icon PNGs (website public/assets/email) are drawn
   * in EMAIL_COLORS.primary.
   */
  welcomeEmail(firstName: string | null) {
    const C = EMAIL_COLORS;
    const name = firstName?.trim() ? escape(firstName.trim()) : '';
    const mascot = `${site()}/assets/mascot/mascot-wave.png`; // by frui2par10r, from SpinHobby/official-assets
    const step = (
      bullet: Parameters<typeof doodle>[0],
      title: string,
      text: string,
      href: string,
    ) =>
      `<tr><td style="padding:10px 12px 8px 0;vertical-align:top;width:24px;text-align:center">${doodle(bullet, 22)}</td>` +
      `<td style="padding:8px 0;vertical-align:top"><a href="${escape(href)}" style="color:${C.primary};font-weight:700;text-decoration:none">${title} →</a>` +
      `<br><span style="color:${C.muted};font-size:14px">${text}</span></td></tr>`;
    const html =
      `<div style="text-align:center">` +
      `<p style="margin:0 0 4px;font-size:13px;letter-spacing:3px;color:${C.muted};font-weight:700">ようこそ · WELCOME</p>` +
      `<img src="${escape(mascot)}" alt="" width="180" height="180" style="width:180px;height:auto;display:block;margin:8px auto 4px;border:0">` +
      `<h1 style="margin:8px 0 6px;font-size:26px;line-height:1.25;color:${C.text}">${name ? `Welcome to the Spin Hobby family, ${name}!` : 'Welcome to the Spin Hobby family!'}</h1>` +
      doodleDivider() +
      `</div>` +
      `<p>We're so happy you're here. Spin Hobby is a small Canadian shop run by anime fans, for anime fans. Every figure, plush and card is the real, officially licensed thing, packed with care as if it were going on our own shelf.</p>` +
      communityBox() +
      `<p style="margin:20px 0 4px;font-weight:700;font-size:17px">Where to start</p>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse">` +
      step(
        'sparkle',
        'Pre-orders',
        'Reserve upcoming figures before they sell out. They ship on release.',
        `${site()}/pre-orders`,
      ) +
      step(
        'heart-pink',
        'New arrivals',
        'Fresh figures, plushies and goods, ready to ship.',
        `${site()}/new-arrivals`,
      ) +
      step(
        'heart-red',
        'Meet us at conventions',
        'Come say hi at our booth at anime cons across Canada.',
        `${site()}/events`,
      ) +
      `</table>` +
      emailButton(site(), 'Start exploring') +
      mascotImage('clover-good-luck.png', 'Good luck!', 120) +
      `<p style="margin:0;text-align:center">Happy hunting, and welcome home!<br><strong>The Spin Hobby team</strong></p>` +
      `<p style="font-size:12px;color:${C.muted};margin-top:20px">You're getting this one-time email because you just made an account at Spin Hobby. Questions? Just reply, a real person will answer.</p>`;
    return {
      subject: name ? `Welcome to Spin Hobby, ${firstName!.trim()}!` : 'Welcome to Spin Hobby!',
      html,
    };
  }

  /** The 6-digit code that confirms a new account's email. */
  emailCodeHtml(code: string, firstName: string | null, minutes: number) {
    return (
      `<p>${firstName ? `Hi ${escape(firstName)},` : 'Hi,'}</p>` +
      `<p>Here is your code to confirm your email at Spin Hobby:</p>` +
      `<p style="font-size:28px;letter-spacing:6px;margin:16px 0"><strong>${escape(code)}</strong></p>` +
      `<p>It works for ${minutes} minutes. Once your email is confirmed you can buy limited releases${rewardsAllowed() ? ' and use your rewards points' : ''}.</p>` +
      `<p style="font-size:12px">If you didn't make an account at Spin Hobby, you can ignore this email.</p>`
    );
  }

  shippedHtml(orderId: number, carrier: string | null, tracking: string) {
    const track = trackingUrl(carrier, tracking);
    return (
      mascotImage('clover.png', '', 110) +
      doodleDivider() +
      `<p>Good news! Your Spin Hobby order <strong>#${orderId}</strong> is on its way.</p>` +
      `<p>${doodle('sparkle', 18)}&nbsp; ${carrier ? `${escape(carrier)} tracking` : 'Tracking'}: <strong>${escape(tracking)}</strong></p>` +
      (track ? emailButton(track, 'Track your package') : statusLink(orderId)) +
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
      COUNTRY_NAMES[a.country as string] ?? a.country,
    ]
      .filter((line) => typeof line === 'string' && line.trim())
      .map((line) => escape(line))
      .join('<br>');
    const rows = items
      .map(
        (i) =>
          `<tr><td style="padding:4px 8px 4px 0;vertical-align:middle;width:20px">${doodle(i.is_preorder ? 'sparkle' : 'heart-pink', 16)}</td>` +
          `<td style="padding:4px 12px 4px 0">${escape(i.name)}${i.is_preorder ? ' <em>(pre-order)</em>' : ''}</td>` +
          `<td style="padding:4px 12px;white-space:nowrap">× ${escape(i.quantity)}</td><td style="padding:4px 0;text-align:right;white-space:nowrap">${money(Number(i.unit_price_cents) * Number(i.quantity))}</td></tr>`,
      )
      .join('');
    const total = (label: string, cents: unknown, bold = false) =>
      `<tr><td colspan="3" style="padding:2px 12px 2px 0;text-align:right">${bold ? `<strong>${label}</strong>` : label}</td><td style="padding:2px 0;text-align:right">${bold ? `<strong>${money(cents)}</strong>` : money(cents)}</td></tr>`;
    const hasPreorder = items.some((i) => i.is_preorder);
    const handling_ =
      handling.days_min === handling.days_max
        ? `${handling.days_min}`
        : `${handling.days_min}–${handling.days_max}`;
    return (
      mascotImage('clover-thank-you.png', 'Thank you!', 140) +
      doodleDivider() +
      `<p>Thanks for your order! We've received your payment for order <strong>#${escape(order.id)}</strong>.</p>` +
      `<table style="border-collapse:collapse">${rows}${total('Subtotal', order.subtotal_cents)}${Number(order.discount_cents) ? total(`Discount${order.discount_code ? ` (${escape(order.discount_code)})` : ''}`, -Number(order.discount_cents)) : ''}${total(`Shipping (${order.shipping_carrier ? escape(`${order.shipping_carrier} ${order.shipping_service ?? ''}`.trim()) : order.shipping_method === 'express' ? 'express' : 'standard'})`, order.shipping_cents)}` +
      `${total('Tax', order.tax_cents)}${total('Total (CAD)', order.total_cents, true)}</table>` +
      (address
        ? `<p>${doodle('heart-red', 16)}&nbsp; <strong>Shipping to</strong><br>${address}</p>`
        : '') +
      `<p>We'll pack your order within ${handling_} business days and email you tracking once it ships.</p>` +
      (hasPreorder
        ? `<p>Your pre-order items ship when they arrive from the manufacturer; we'll let you know as soon as we have a date.</p>`
        : '') +
      statusLink(Number(order.id)) +
      communityBox() +
      `<p>Questions? Reply to this email with your order number.</p><p><a href="${escape(site)}">Back to Spin Hobby</a></p>`
    );
  }
}
