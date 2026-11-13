import { afterAll, describe, expect, it } from 'vitest';
import { mockFetch, signUp } from '../support/harness.js';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, pglite, owner, shopper } = shop;

/** Sends a code to `auth` and returns the 6 digits from the email. */
async function sendCode(auth: string) {
  const mail = mockFetch({ 'api.resend.com': () => ({ id: 'e' }) });
  try {
    const res = await http.post('/auth/email-code').set('Authorization', auth).expect(200);
    const sent = mail.calls.find((c) => c.url.includes('api.resend.com'));
    return { res, code: sent ? (/(\d{6}) is your/.exec(sent.body.subject)?.[1] ?? '') : '' };
  } finally {
    mail.restore();
  }
}

describe('registration', () => {
  it('confirms a new account with the code from the email', async () => {
    const fresh = await signUp(pglite, 'new-fan@example.com', undefined, { fresh: true });
    expect(
      (await http.get('/auth/me').set('Authorization', fresh.auth).expect(200)).body.user,
    ).toMatchObject({ emailVerified: false, welcomed: false, phone: null });

    const { res, code } = await sendCode(fresh.auth);
    expect(res.body).toEqual({ success: true, verified: false, sent: true });
    expect(code).toMatch(/^\d{6}$/);
    // a second code within the minute waits
    const again = await http.post('/auth/email-code').set('Authorization', fresh.auth).expect(429);
    expect(again.body.code).toBe('CODE_WAIT');

    const wrong = code === '000000' ? '111111' : '000000';
    await http
      .post('/auth/email-code/confirm')
      .set('Authorization', fresh.auth)
      .send({ code: wrong })
      .expect(400, {
        success: false,
        error: "That code isn't right. Check the email and try again.",
        code: 'CODE_WRONG',
      });
    await http
      .post('/auth/email-code/confirm')
      .set('Authorization', fresh.auth)
      .send({ code: 'abc' })
      .expect(400);
    await http
      .post('/auth/email-code/confirm')
      .set('Authorization', fresh.auth)
      .send({ code: `${code.slice(0, 3)} ${code.slice(3)}` })
      .expect(200, { success: true, verified: true });
    expect(
      (await http.get('/auth/me').set('Authorization', fresh.auth).expect(200)).body.user
        .emailVerified,
    ).toBe(true);
    // already confirmed: nothing more is sent
    expect(
      (await http.post('/auth/email-code').set('Authorization', fresh.auth).expect(200)).body,
    ).toEqual({ success: true, verified: true, sent: false });
  });

  it('stops a code after too many wrong tries, and after it expires', async () => {
    const fresh = await signUp(pglite, 'guesser@example.com', undefined, { fresh: true });
    const { code } = await sendCode(fresh.auth);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++)
      await http
        .post('/auth/email-code/confirm')
        .set('Authorization', fresh.auth)
        .send({ code: wrong })
        .expect(400);
    await http
      .post('/auth/email-code/confirm')
      .set('Authorization', fresh.auth)
      .send({ code })
      .expect(429);

    await pglite.query(
      "update public.email_codes set attempts = 0, expires_at = now() - interval '1 minute' where user_id = $1",
      [fresh.id],
    );
    const expired = await http
      .post('/auth/email-code/confirm')
      .set('Authorization', fresh.auth)
      .send({ code })
      .expect(400);
    expect(expired.body.code).toBe('CODE_EXPIRED');
  });

  it('counts staff and Google/Discord sign-ins as confirmed', async () => {
    expect(
      (await http.get('/auth/me').set('Authorization', owner.auth).expect(200)).body.user,
    ).toMatchObject({ emailVerified: true, welcomed: true });
    await pglite.query(
      'update public.profiles set email_verified_at = null, welcomed_at = null where id = $1',
      [owner.id],
    );
    expect(
      (await http.get('/auth/me').set('Authorization', owner.auth).expect(200)).body.user,
    ).toMatchObject({ emailVerified: true, welcomed: true });
  });

  it('saves the welcome step: name and phone, and only what was sent', async () => {
    const fresh = await signUp(pglite, 'welcome@example.com', undefined, { fresh: true });
    const save = (body: object) =>
      http.patch('/account/profile').set('Authorization', fresh.auth).send(body);
    await save({ phone: '12' }).expect(400, {
      success: false,
      error: 'Enter a phone number like 416 555 0123.',
    });
    await save({ firstName: ' ' }).expect(400);
    expect(
      (await save({ firstName: 'Hana', phone: '+1 (416) 555-0123' }).expect(200)).body,
    ).toEqual({
      success: true,
      profile: { firstName: 'Hana', lastName: null, phone: '+1 (416) 555-0123', welcomed: true },
    });
    // leaving a field out keeps it; an empty phone clears it
    expect((await save({ phone: '' }).expect(200)).body.profile).toEqual({
      firstName: 'Hana',
      lastName: null,
      phone: null,
      welcomed: true,
    });
    expect(
      (await http.get('/auth/me').set('Authorization', fresh.auth).expect(200)).body.user,
    ).toMatchObject({ firstName: 'Hana', welcomed: true });
  });

  it('lets an unconfirmed account shop, but not use points', async () => {
    const fresh = await signUp(pglite, 'points@example.com', undefined, { fresh: true });
    const redeem = await http
      .post('/account/rewards/redeem')
      .set('Authorization', fresh.auth)
      .send({ points: 500 })
      .expect(403);
    expect(redeem.body.code).toBe('EMAIL_UNCONFIRMED');
    await http.post('/account/rewards/link-code').set('Authorization', fresh.auth).expect(403);
    expect(
      (await http.get('/account/rewards').set('Authorization', fresh.auth).expect(200)).body
        .emailConfirmed,
    ).toBe(false);
    expect(
      (await http.get('/account/rewards').set('Authorization', shopper.auth).expect(200)).body
        .emailConfirmed,
    ).toBe(true);
  });

  it('lists the biggest series to follow', async () => {
    const res = await http.get('/follows/series').expect(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.series)).toBe(true);
  });
});
