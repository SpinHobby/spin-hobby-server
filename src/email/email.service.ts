import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../common/errors.js';
import { env } from '../config/env.js';

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
}
