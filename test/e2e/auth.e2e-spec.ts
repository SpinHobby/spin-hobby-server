import { afterAll, describe, expect, it } from 'vitest';
import { resetSignupLimits } from '../../src/modules/auth/sign-in.service.js';
import { mockFetch, tokenFor } from '../support/harness.js';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, pglite, shopper } = shop;

describe('sign-in through the API', () => {
  const gotrue = (status: number, body: unknown) => () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('lists the enabled providers', async () => {
    process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
    const auth = mockFetch({
      '/auth/v1/settings': () => ({ external: { email: true, google: true, discord: false } }),
    });
    try {
      expect((await http.get('/auth/providers').expect(200)).body).toEqual({
        success: true,
        password: true,
        signup: true,
        google: true,
        discord: false,
      });
    } finally {
      auth.restore();
    }
  });

  it('signs in with email + password and returns a session with the profile', async () => {
    const auth = mockFetch({
      'grant_type=password': (init) => {
        const body = JSON.parse(String(init?.body));
        return body.password === 'right'
          ? gotrue(200, { access_token: shopper.token, refresh_token: 'r1', expires_in: 3600 })()
          : gotrue(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' })();
      },
      'grant_type=refresh_token': gotrue(200, {
        access_token: shopper.token,
        refresh_token: 'r2',
        expires_at: 1900000000,
      }),
    });
    try {
      await http
        .post('/auth/login')
        .send({ email: 'fan@example.com', password: 'wrong' })
        .expect(401, { success: false, error: 'Wrong email or password.' });
      const ok = await http
        .post('/auth/login')
        .send({ email: 'Fan@Example.com', password: 'right' })
        .expect(200);
      expect(ok.body).toMatchObject({
        success: true,
        accessToken: shopper.token,
        refreshToken: 'r1',
        user: { email: 'fan@example.com', role: 'customer' },
      });
      expect(ok.body.expiresAt).toBeGreaterThan(Date.now() / 1000);
      expect(auth.calls[0].body).toEqual({ email: 'fan@example.com', password: 'wrong' });
      const refreshed = await http.post('/auth/refresh').send({ refreshToken: 'r1' }).expect(200);
      expect(refreshed.body).toMatchObject({ refreshToken: 'r2', expiresAt: 1900000000 });
    } finally {
      auth.restore();
    }
  });

  it('creates customer accounts that can sign in at once, and emails a code to confirm the address', async () => {
    resetSignupLimits();
    const newbie = { id: '00000000-0000-4000-8000-00000000abcd', email: 'newbie@example.com' };
    const auth = mockFetch({
      '/auth/v1/admin/users': async (init) => {
        const body = JSON.parse(String(init?.body));
        if (body.email === 'fan@example.com')
          return gotrue(422, {
            error_code: 'email_exists',
            msg: 'A user with this email address has already been registered',
          })();
        await pglite.query(
          'insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)',
          [newbie.id, body.email, JSON.stringify(body.user_metadata)],
        );
        return gotrue(200, { id: newbie.id, email: body.email })();
      },
      'api.resend.com': () => ({ id: 'code-email' }),
      'grant_type=password': async () =>
        gotrue(200, {
          access_token: await tokenFor(newbie.id, newbie.email),
          refresh_token: 'n1',
          expires_in: 3600,
        })(),
    });
    try {
      await http
        .post('/auth/signup')
        .send({ email: 'not-an-email', password: 'longenough' })
        .expect(400);
      await http
        .post('/auth/signup')
        .send({ email: 'x@example.com', password: 'short' })
        .expect(400, { success: false, error: 'Use a password with at least 8 characters.' });
      await http
        .post('/auth/signup')
        .send({ email: 'fan@example.com', password: 'longenough', firstName: 'Fan' })
        .expect(409);
      const ok = await http
        .post('/auth/signup')
        .send({ email: 'Newbie@Example.com', password: 'longenough', firstName: 'Nia' })
        .expect(201);
      expect(ok.body).toMatchObject({
        success: true,
        refreshToken: 'n1',
        user: { email: 'newbie@example.com', role: 'customer' },
      });
      const created = auth.calls.find(
        (c) => c.url.includes('/admin/users') && c.body.email === 'newbie@example.com',
      );
      expect(created?.body).toEqual({
        email: 'newbie@example.com',
        password: 'longenough',
        email_confirm: true,
        user_metadata: { first_name: 'Nia' },
      });
      const profile = await pglite.query<{ first_name: string }>(
        'select first_name from public.profiles where id = $1',
        [newbie.id],
      );
      expect(profile.rows[0].first_name).toBe('Nia');
      // not confirmed yet: a 6-digit code went out through the shop's mailer
      expect(ok.body.user).toMatchObject({
        emailVerified: false,
        welcomed: false,
        firstName: 'Nia',
      });
      const mail = auth.calls.find((c) => c.url.includes('api.resend.com'));
      expect(mail?.body.to).toEqual(['newbie@example.com']);
      expect(mail?.body.subject).toMatch(/^\d{6} is your Spin Hobby code$/);
      for (let i = 0; i < 3; i++)
        await http
          .post('/auth/signup')
          .send({ email: 'fan@example.com', password: 'longenough', firstName: 'Fan' })
          .expect(409);
      await http
        .post('/auth/signup')
        .send({ email: 'late@example.com', password: 'longenough', firstName: 'Late' })
        .expect(429);
    } finally {
      auth.restore();
      resetSignupLimits();
    }
  });

  it('remembers a staging device and signs it in with one click, as owner or staff', async () => {
    const stagingEnv = {
      APP_ENV: 'staging',
      STAGING_ADMIN_USERNAME: 'QuickBoss',
      STAGING_ADMIN_PASSWORD: 'quick-secret',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    };
    const ids: Record<string, string> = {
      'quickboss@staging.spinhobby.com': '00000000-0000-4000-8000-00000000b055',
      'quick-staff@staging.spinhobby.com': '00000000-0000-4000-8000-000000005aff',
    };
    const auth = mockFetch({
      '/auth/v1/settings': () => ({ external: { email: true } }),
      '/auth/v1/admin/users': async (init) => {
        const body = JSON.parse(String(init?.body));
        await pglite.query(
          'insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)',
          [ids[body.email], body.email, JSON.stringify(body.user_metadata)],
        );
        return gotrue(200, { id: ids[body.email], email: body.email })();
      },
      'grant_type=password': async (init) => {
        const body = JSON.parse(String(init?.body));
        if (ids[body.email] && body.password === process.env.STAGING_ADMIN_PASSWORD)
          return gotrue(200, {
            access_token: await tokenFor(ids[body.email], body.email, {}),
            refresh_token: `quick:${body.email}`,
            expires_in: 3600,
          })();
        return gotrue(400, {
          error_code: 'invalid_credentials',
          msg: 'Invalid login credentials',
        })();
      },
    });
    const before = Object.fromEntries(Object.keys(stagingEnv).map((k) => [k, process.env[k]]));
    try {
      // Not staging: the route does not exist for anyone.
      await http.post('/auth/staging/quick').send({ key: '1.abc', role: 'owner' }).expect(404);

      Object.assign(process.env, stagingEnv);
      expect((await http.get('/auth/providers').expect(200)).body).toMatchObject({ quick: true });
      // No key yet, a made-up key, and a bad role are all refused.
      await http.post('/auth/staging/quick').send({ key: '1.abc', role: 'owner' }).expect(401);
      await http
        .post('/auth/staging/quick')
        .send({ key: `${Date.now() + 60_000}.${'0'.repeat(64)}`, role: 'owner' })
        .expect(401);

      // Signing in once with the password lets this browser ask for a device key.
      const owner = await http
        .post('/auth/login')
        .send({ email: 'QuickBoss', password: 'quick-secret' })
        .expect(200);
      await http.post('/auth/staging/device').expect(401);
      const device = await http
        .post('/auth/staging/device')
        .set('Authorization', `Bearer ${owner.body.accessToken}`)
        .expect(200);
      expect(device.body.key).toMatch(/^\d+\.[0-9a-f]{64}$/);
      await http
        .post('/auth/staging/quick')
        .send({ key: device.body.key, role: 'boss' })
        .expect(400);

      // One click as the owner, and as the staff account (made on first use, kept staff).
      const asOwner = await http
        .post('/auth/staging/quick')
        .send({ key: device.body.key, role: 'owner' })
        .expect(200);
      expect(asOwner.body.user).toMatchObject({
        email: 'quickboss@staging.spinhobby.com',
        role: 'owner',
      });
      const asStaff = await http
        .post('/auth/staging/quick')
        .send({ key: device.body.key, role: 'staff' })
        .expect(200);
      expect(asStaff.body.user).toMatchObject({
        email: 'quick-staff@staging.spinhobby.com',
        role: 'staff',
      });
      // The staff account cannot hand out device keys, and nobody can sign up with a reserved address.
      await http
        .post('/auth/staging/device')
        .set('Authorization', `Bearer ${asStaff.body.accessToken}`)
        .expect(403);
      resetSignupLimits();
      await http
        .post('/auth/signup')
        .send({
          email: 'quick-staff@staging.spinhobby.com',
          password: 'longenough',
          firstName: 'X',
        })
        .expect(409);

      // A tampered key, and every key once the staging password changes, stop working.
      const [expiry, signature] = device.body.key.split('.');
      await http
        .post('/auth/staging/quick')
        .send({ key: `${Number(expiry) + 1}.${signature}`, role: 'owner' })
        .expect(401);
      process.env.STAGING_ADMIN_PASSWORD = 'changed';
      await http
        .post('/auth/staging/quick')
        .send({ key: device.body.key, role: 'owner' })
        .expect(401);
    } finally {
      for (const [k, v] of Object.entries(before)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      auth.restore();
      resetSignupLimits();
    }
  });

  it('signs the staging admin in by username, creating and repairing its owner account', async () => {
    const stagingEnv = {
      APP_ENV: 'staging',
      STAGING_ADMIN_USERNAME: 'SpinHobby',
      STAGING_ADMIN_PASSWORD: '123456',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    };
    const adminEmail = 'spinhobby@staging.spinhobby.com';
    const adminId = '00000000-0000-4000-8000-0000000ad314';
    let supabasePassword = '';
    const auth = mockFetch({
      '/auth/v1/settings': () => ({ external: { email: true } }),
      '/auth/v1/admin/users': async (init, url) => {
        const body = JSON.parse(String(init?.body));
        if (init?.method === 'PUT') {
          expect(url.endsWith(`/admin/users/${adminId}`)).toBe(true);
          supabasePassword = body.password;
          return gotrue(200, { id: adminId })();
        }
        await pglite.query(
          'insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)',
          [adminId, body.email, JSON.stringify(body.user_metadata)],
        );
        supabasePassword = body.password;
        return gotrue(200, { id: adminId, email: body.email })();
      },
      'grant_type=password': async (init) => {
        const body = JSON.parse(String(init?.body));
        if (body.email === adminEmail && body.password === supabasePassword)
          return gotrue(200, {
            access_token: await tokenFor(adminId, adminEmail, { first_name: 'SpinHobby' }),
            refresh_token: 'adm1',
            expires_in: 3600,
          })();
        return gotrue(400, {
          error_code: 'invalid_credentials',
          msg: 'Invalid login credentials',
        })();
      },
    });
    const before = Object.fromEntries(Object.keys(stagingEnv).map((k) => [k, process.env[k]]));
    const restoreEnv = () => {
      for (const [k, v] of Object.entries(before)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    };
    try {
      // Not staging: the username is just an unknown email.
      await http
        .post('/auth/login')
        .send({ email: 'SpinHobby', password: '123456' })
        .expect(401, { success: false, error: 'Wrong email or password.' });
      expect((await http.get('/auth/providers').expect(200)).body.username).toBeUndefined();

      Object.assign(process.env, stagingEnv);
      expect((await http.get('/auth/providers').expect(200)).body).toMatchObject({
        password: true,
        username: true,
      });
      await http
        .post('/auth/login')
        .send({ email: 'SpinHobby', password: 'wrong' })
        .expect(401, { success: false, error: 'Wrong email or password.' });
      expect(auth.calls.filter((c) => c.url.includes('/admin/users'))).toHaveLength(0);

      // First sign-in creates the account (confirmed, no email) and makes it an owner.
      const first = await http
        .post('/auth/login')
        .send({ email: 'spinhobby', password: '123456' })
        .expect(200);
      expect(first.body).toMatchObject({
        success: true,
        refreshToken: 'adm1',
        user: { email: adminEmail, role: 'owner', firstName: 'SpinHobby' },
      });
      const created = auth.calls.find((c) => c.url.endsWith('/auth/v1/admin/users'));
      expect(created?.body).toEqual({
        email: adminEmail,
        password: '123456',
        email_confirm: true,
        user_metadata: { first_name: 'SpinHobby' },
      });
      expect(
        (
          await http
            .get('/auth/me')
            .set('Authorization', `Bearer ${first.body.accessToken}`)
            .expect(200)
        ).body.user.role,
      ).toBe('owner');

      // Later sign-ins reuse it, even if someone demoted it by hand.
      await pglite.query("update public.profiles set role = 'customer' where id = $1", [adminId]);
      const again = await http
        .post('/auth/login')
        .send({ email: 'SpinHobby', password: '123456' })
        .expect(200);
      expect(again.body.user.role).toBe('owner');
      expect(auth.calls.filter((c) => c.url.endsWith('/auth/v1/admin/users'))).toHaveLength(1);

      // The password in the environment changed: Supabase is updated and the sign-in still succeeds.
      process.env.STAGING_ADMIN_PASSWORD = 'new-secret';
      await http.post('/auth/login').send({ email: 'SpinHobby', password: '123456' }).expect(401);
      const rotated = await http
        .post('/auth/login')
        .send({ email: 'SpinHobby', password: 'new-secret' })
        .expect(200);
      expect(rotated.body.user.email).toBe(adminEmail);
      expect(supabasePassword).toBe('new-secret');
      expect(auth.calls.filter((c) => c.url.includes(`/admin/users/${adminId}`))).toHaveLength(1);

      // Nobody can claim the reserved address through sign-up.
      resetSignupLimits();
      await http
        .post('/auth/signup')
        .send({ email: adminEmail, password: 'longenough', firstName: 'Admin' })
        .expect(409);

      // Never against the production project.
      process.env.SUPABASE_URL = 'https://zmlltsytckexrmybvnof.supabase.co';
      await http
        .post('/auth/login')
        .send({ email: 'SpinHobby', password: 'new-secret' })
        .expect(401);
      expect((await http.get('/auth/providers').expect(200)).body.username).toBeUndefined();
    } finally {
      auth.restore();
      restoreEnv();
      process.env.SUPABASE_URL = 'https://proj.supabase.co';
      resetSignupLimits();
    }
  });

  it('builds OAuth links only for allowed sites', async () => {
    const res = await http
      .get('/auth/oauth-url?provider=google&redirectTo=https://spinhobby.com/admin')
      .expect(200);
    expect(res.body.url).toBe(
      'https://proj.supabase.co/auth/v1/authorize?provider=google&redirect_to=https%3A%2F%2Fspinhobby.com%2Fadmin',
    );
    await http
      .get('/auth/oauth-url?provider=google&redirectTo=https://evil.example/steal')
      .expect(400);
    await http.get('/auth/oauth-url?provider=myspace&redirectTo=https://spinhobby.com').expect(400);
  });
});
