import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { EmailService } from '../../src/integrations/email/email.service.js';
import { mockFetch, signUp } from '../support/harness.js';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, pglite, owner, app } = shop;
const email = app.get(EmailService);

afterEach(async () => {
  delete process.env.RESEND_DAILY_LIMIT;
  delete process.env.RESEND_MONTHLY_LIMIT;
  process.env.RESEND_DAILY_LIMIT = '0';
  process.env.RESEND_MONTHLY_LIMIT = '0';
  await pglite.query('delete from public.email_usage');
  await pglite.query('delete from public.email_queue');
});

/** Pretends `n` emails already went out today. */
const sentToday = (n: number) =>
  pglite.query(
    `insert into public.email_usage (day, sent) values ((now() at time zone 'utc')::date, $1)
     on conflict (day) do update set sent = excluded.sent`,
    [n],
  );

describe("Resend's plan limits", () => {
  it('counts what it sends and shows it to staff', async () => {
    process.env.RESEND_DAILY_LIMIT = '100';
    process.env.RESEND_MONTHLY_LIMIT = '3000';
    const mail = mockFetch({ 'api.resend.com': () => ({ id: 'e' }) });
    try {
      expect(await email.send('fan@gmail.com', 'Your order', '<p>x</p>')).toBe(true);
    } finally {
      mail.restore();
    }
    await http.get('/admin/email-usage').expect(401);
    const res = await http.get('/admin/email-usage').set('Authorization', owner.auth).expect(200);
    expect(res.body).toMatchObject({
      transport: 'resend',
      today: 1,
      month: 1,
      dailyLimit: 100,
      monthlyLimit: 3000,
      waiting: { total: 0 },
    });
  });

  it('holds news back first, keeps codes and orders going, and sends the waiting ones after the reset', async () => {
    process.env.RESEND_DAILY_LIMIT = '10';
    await sentToday(8); // news stops at 80% (8 of 10); codes and orders still have 2
    const mail = mockFetch({ 'api.resend.com': () => ({ id: 'e' }) });
    try {
      expect(await email.deliver('a@gmail.com', 'Back in stock', '<p>x</p>', 'news')).toBe(
        'queued',
      );
      expect(await email.deliver('b@gmail.com', 'Your order', '<p>x</p>', 'order')).toBe('sent');
      expect(await email.deliver('c@gmail.com', 'Your order', '<p>x</p>', 'order')).toBe('sent');
      expect(await email.deliver('d@gmail.com', '123456 is your code', '<p>x</p>', 'code')).toBe(
        'queued',
      );
      expect(mail.calls.filter((c) => c.url.includes('resend'))).toHaveLength(2);

      const usage = await http
        .get('/admin/email-usage')
        .set('Authorization', owner.auth)
        .expect(200);
      expect(usage.body).toMatchObject({
        today: 10,
        waiting: { total: 2, byKind: { code: 1, news: 1, order: 0, welcome: 0 } },
      });

      // nothing goes while the limit holds
      expect(await email.drain()).toBe(0);
      // a new day: the code goes before the news
      await pglite.query('delete from public.email_usage');
      mail.calls.length = 0;
      expect(await email.drain()).toBe(2);
      expect(mail.calls.map((c) => c.body.subject)).toEqual([
        '123456 is your code',
        'Back in stock',
      ]);
      const left = await pglite.query('select 1 from public.email_queue where sent_at is null');
      expect(left.rows).toHaveLength(0);
    } finally {
      mail.restore();
    }
  });

  it('keeps an email that Resend turns away (429) instead of losing it', async () => {
    process.env.RESEND_DAILY_LIMIT = '100';
    const mail = mockFetch({
      'api.resend.com': () => new Response('{"name":"daily_quota_exceeded"}', { status: 429 }),
    });
    try {
      expect(await email.deliver('e@gmail.com', 'Your order', '<p>x</p>', 'order')).toBe('queued');
    } finally {
      mail.restore();
    }
    const q = await pglite.query<{ last_error: string }>(
      'select last_error from public.email_queue where sent_at is null',
    );
    expect(q.rows).toEqual([{ last_error: 'Resend 429' }]);
  });

  it('tells a new customer their code is on its way later, and makes it last until it arrives', async () => {
    process.env.RESEND_DAILY_LIMIT = '5';
    await sentToday(5);
    const fresh = await signUp(pglite, 'queued-fan@gmail.com', undefined, { fresh: true });
    const mail = mockFetch({ 'api.resend.com': () => ({ id: 'e' }) });
    try {
      const res = await http.post('/auth/email-code').set('Authorization', fresh.auth).expect(200);
      expect(res.body).toEqual({ success: true, verified: false, sent: false, queued: true });
      expect(mail.calls.filter((c) => c.url.includes('resend'))).toHaveLength(0);
    } finally {
      mail.restore();
    }
    const code = await pglite.query<{ hours: number }>(
      `select round(extract(epoch from expires_at - now()) / 3600)::int as hours
         from public.email_codes where user_id = $1`,
      [fresh.id],
    );
    expect(code.rows[0].hours).toBe(48);
    const queued = await pglite.query<{ html: string }>(
      "select html from public.email_queue where kind = 'code'",
    );
    expect(queued.rows[0].html).toContain('It works for 2 days');
  });
});
