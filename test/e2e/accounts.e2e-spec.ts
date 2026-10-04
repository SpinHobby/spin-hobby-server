import { afterAll, describe, expect, it } from 'vitest';
import { JWT_SECRET, tokenFor } from '../support/harness.js';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, pglite, owner, shopper } = shop;

describe('accounts', () => {
  it('requires sign-in and rejects forged tokens', async () => {
    await http.get('/auth/me').expect(401, { success: false, error: 'Sign in is required.' });
    await http.get('/auth/me').set('Authorization', `Bearer ${shopper.token}x`).expect(401);
    const { SignJWT } = await import('jose');
    const foreign = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(shopper.id)
      .setAudience('authenticated')
      .setIssuer('https://other-project.supabase.co/auth/v1')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(JWT_SECRET));
    await http.get('/auth/me').set('Authorization', `Bearer ${foreign}`).expect(401);
  });

  it('returns the profile and promotes OWNER_EMAILS on sign-in', async () => {
    expect(
      (await http.get('/auth/me').set('Authorization', shopper.auth).expect(200)).body.user,
    ).toMatchObject({ email: 'fan@example.com', role: 'customer', firstName: null });
    const named = await tokenFor(shopper.id, 'fan@example.com', { full_name: '  Aki Tanaka ' });
    expect(
      (await http.get('/auth/me').set('Authorization', `Bearer ${named}`).expect(200)).body.user
        .firstName,
    ).toBe('Aki');
    expect(
      (await http.get('/auth/me').set('Authorization', owner.auth).expect(200)).body.user.role,
    ).toBe('owner');
    const row = await pglite.query<{ role: string }>(
      'select role from public.profiles where id = $1',
      [owner.id],
    );
    expect(row.rows[0].role).toBe('owner');
  });

  it('manages a wishlist', async () => {
    await http
      .post('/wishlist')
      .set('Authorization', shopper.auth)
      .send({ squareItemId: 'PRZ1' })
      .expect(200);
    await http
      .post('/wishlist')
      .set('Authorization', shopper.auth)
      .send({ squareItemId: 'PRZ1' })
      .expect(200); // idempotent
    await http
      .post('/wishlist')
      .set('Authorization', shopper.auth)
      .send({ squareItemId: 'HID1' })
      .expect(400);
    expect(
      (await http.get('/wishlist').set('Authorization', shopper.auth)).body.items.map(
        (p: any) => p.id,
      ),
    ).toEqual(['PRZ1']);
    await http.delete('/wishlist/PRZ1').set('Authorization', shopper.auth).expect(200);
    expect((await http.get('/wishlist').set('Authorization', shopper.auth)).body.items).toEqual([]);
  });

  it('records restock alerts for guests and validates input', async () => {
    await http
      .post('/alerts')
      .send({ email: 'Guest@Example.com', variationId: 'BDG1_V' })
      .expect(200);
    await http
      .post('/alerts')
      .send({ email: 'guest@example.com', variationId: 'BDG1_V' })
      .expect(200);
    await http
      .post('/alerts')
      .send({ email: 'not-an-email', variationId: 'BDG1_V' })
      .expect(400, { success: false, error: 'Enter a valid email address.' });
    await http.post('/alerts').send({ email: 'a@b.com', variationId: 'NOPE' }).expect(400);
    const rows = await pglite.query('select email from public.stock_alerts');
    expect(rows.rows).toEqual([{ email: 'guest@example.com' }]);
  });
});
