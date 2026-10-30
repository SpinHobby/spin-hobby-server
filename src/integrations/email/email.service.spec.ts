import { describe, expect, it } from 'vitest';
import { EmailService } from './email.service.js';

describe('refund email', () => {
  const email = new EmailService();

  it('says a full refund cancels the order', () => {
    const html = email.refundedHtml(42, 5999, true);
    expect(html).toContain('#42');
    expect(html).toContain('cancelled and refunded in full');
    expect(html).toContain('$59.99');
  });

  it('gives the amount of a partial refund', () => {
    const html = email.refundedHtml(42, 1000, false);
    expect(html).toContain('refunded <strong>$10.00</strong>');
    expect(html).not.toContain('cancelled');
  });
});
