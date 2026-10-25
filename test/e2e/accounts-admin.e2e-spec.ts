import { afterAll, describe, expect, it } from 'vitest';
import { mockFetch, signUp } from '../support/harness.js';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, pglite, owner, staff, shopper } = shop;
const other = await signUp(pglite, 'collector@example.com');

/** A day (YYYY-MM-DD) `days` from now. */
const day = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const as = (who: { auth: string }) => ({ Authorization: who.auth });

/** Signs `who` in with a password, the way the storefront does (Supabase faked). */
async function signIn(who: { token: string }, email: string) {
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  const auth = mockFetch({
    'grant_type=password': () => ({
      access_token: who.token,
      refresh_token: 'r',
      expires_in: 3600,
    }),
  });
  try {
    return await http.post('/auth/login').send({ email, password: 'right' });
  } finally {
    auth.restore();
  }
}

describe('admin accounts', () => {
  it('is for owners only', async () => {
    await http.get('/admin/accounts').expect(401);
    await http.get('/admin/accounts').set(as(shopper)).expect(403);
    await http.get('/admin/accounts').set(as(staff)).expect(403);
    await http
      .put(`/admin/accounts/${other.id}/role`)
      .set(as(staff))
      .send({ role: 'staff' })
      .expect(403);
  });

  it('lists the roles from lowest to highest', async () => {
    const { roles } = (await http.get('/admin/accounts/roles').set(as(owner)).expect(200)).body;
    expect(roles.map((r: any) => r.key)).toEqual(['customer', 'staff', 'owner']);
    expect(roles[2]).toMatchObject({ rank: 2, label: 'Owner' });
  });

  it('lists every account, highest role first, with filters', async () => {
    const all = (await http.get('/admin/accounts').set(as(owner)).expect(200)).body;
    expect(all.total).toBe(4);
    expect(all.accounts[0]).toMatchObject({
      email: 'boss@spinhobby.com',
      role: 'owner',
      status: 'active',
      roleFromEnv: 'owner',
    });
    expect(all.accounts.find((a: any) => a.id === staff.id)).toMatchObject({
      role: 'staff',
      canAudit: false,
    });

    const customers = (await http.get('/admin/accounts?role=customer').set(as(owner)).expect(200))
      .body;
    expect(customers.accounts.map((a: any) => a.email).sort()).toEqual([
      'collector@example.com',
      'fan@example.com',
    ]);
    const found = (await http.get('/admin/accounts?q=COLLECT').set(as(owner)).expect(200)).body;
    expect(found.accounts.map((a: any) => a.id)).toEqual([other.id]);
    await http.get('/admin/accounts?role=emperor').set(as(owner)).expect(400);
  });

  it('promotes and demotes, and audit access does not follow someone down', async () => {
    const up = await http
      .put(`/admin/accounts/${other.id}/role`)
      .set(as(owner))
      .send({ role: 'staff' })
      .expect(200);
    expect(up.body.account).toMatchObject({ role: 'staff' });
    await http.get('/admin/dashboard').set(as(other)).expect(200); // staff now, straight away

    await http
      .put(`/admin/audit/access/${other.id}`)
      .set(as(owner))
      .send({ canAudit: true })
      .expect(200);
    const down = await http
      .put(`/admin/accounts/${other.id}/role`)
      .set(as(owner))
      .send({ role: 'customer' })
      .expect(200);
    expect(down.body.account).toMatchObject({ role: 'customer', canAudit: false });
    await http.get('/admin/dashboard').set(as(other)).expect(403);
    const { rows } = await pglite.query<{ can_audit: boolean }>(
      'select can_audit from public.profiles where id = $1',
      [other.id],
    );
    expect(rows[0].can_audit).toBe(false);
  });

  it("protects owners: nobody changes their own account, and a role from the email lists can't be taken away", async () => {
    await http
      .put(`/admin/accounts/${owner.id}/role`)
      .set(as(owner))
      .send({ role: 'customer' })
      .expect(409, {
        success: false,
        error: "You can't change your own account here. Ask another owner.",
        code: 'own_account',
      });

    // a second owner can't demote the first, who is listed in OWNER_EMAILS (they'd be owner again at the next sign-in)
    await http
      .put(`/admin/accounts/${staff.id}/role`)
      .set(as(owner))
      .send({ role: 'owner' })
      .expect(200);
    const listed = await http
      .put(`/admin/accounts/${owner.id}/role`)
      .set(as(staff))
      .send({ role: 'staff' })
      .expect(409);
    expect(listed.body).toMatchObject({
      code: 'listed_in_env',
      error: expect.stringContaining('OWNER_EMAILS'),
    });
    await http
      .put(`/admin/accounts/${staff.id}/role`)
      .set(as(owner))
      .send({ role: 'staff' })
      .expect(200);
  });

  it('suspends until a day: sign-in and existing sessions are refused at once, until lifted', async () => {
    const res = await http
      .put(`/admin/accounts/${shopper.id}/restriction`)
      .set(as(owner))
      .send({ action: 'suspend', until: day(60), reason: 'Chargebacks' })
      .expect(200);
    expect(res.body.account).toMatchObject({
      status: 'suspended',
      restriction: { kind: 'suspended', lastDay: day(60), reason: 'Chargebacks' },
    });

    const me = await http.get('/auth/me').set(as(shopper)).expect(403);
    expect(me.body).toMatchObject({ code: 'account_suspended' });
    const last = new Date(`${day(60)}T12:00:00Z`).toLocaleDateString('en-CA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
    expect(me.body.error).toBe(
      `This account is suspended until the end of ${last}. Reason: Chargebacks`,
    );
    expect((await signIn(shopper, 'fan@example.com')).status).toBe(403);
    // public pages still work, as a guest
    await http.get('/products').set(as(shopper)).expect(200);

    await http
      .put(`/admin/accounts/${shopper.id}/restriction`)
      .set(as(owner))
      .send({ action: 'lift' })
      .expect(200);
    await http.get('/auth/me').set(as(shopper)).expect(200);
    expect((await signIn(shopper, 'fan@example.com')).status).toBe(200);
  });

  it('checks the suspension date', async () => {
    const put = (body: object) =>
      http.put(`/admin/accounts/${shopper.id}/restriction`).set(as(owner)).send(body);
    await put({ action: 'suspend' }).expect(400);
    await put({ action: 'suspend', until: day(-3) }).expect(400);
    await put({ action: 'suspend', until: day(365 * 6) }).expect(400);
    await put({ action: 'pause' }).expect(400);
  });

  it('bans for good, and keeps a history of every change', async () => {
    await http
      .put(`/admin/accounts/${other.id}/restriction`)
      .set(as(owner))
      .send({ action: 'ban', reason: 'Reselling bots' })
      .expect(200);
    const me = await http.get('/auth/me').set(as(other)).expect(403);
    expect(me.body).toMatchObject({
      code: 'account_banned',
      error: 'This account has been closed by Spin Hobby. Reason: Reselling bots',
    });

    const banned = (await http.get('/admin/accounts?status=banned').set(as(owner)).expect(200)).body
      .accounts;
    expect(banned.map((a: any) => a.id)).toEqual([other.id]);

    const { account } = (await http.get(`/admin/accounts/${other.id}`).set(as(owner)).expect(200))
      .body;
    expect(account.history.map((h: any) => h.action)).toEqual([
      'account.banned',
      'account.role_changed',
      'audit.access_granted',
      'account.role_changed',
    ]);
    expect(account.history[0]).toMatchObject({
      by: 'boss@spinhobby.com',
      data: { reason: 'Reselling bots' },
    });
  });
});
