import { exportPKCS8, generateKeyPair } from 'jose';
import { afterAll, describe, expect, it } from 'vitest';
import { mockFetch } from '../support/harness.js';
import { placeSampleOrders, startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(() => {
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.AUDIT_DRIVE_FOLDER_ID;
  return shop.close();
});
const { http, pglite, owner, staff, shopper } = shop;
await placeSampleOrders(shop);

/** A day in the shop's time zone, `offset` days from today. */
const shopDay = (offset = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(
    new Date(Date.now() + offset * 86_400_000),
  );

describe('admin audit', () => {
  it('is only for owners and the staff the owner allows', async () => {
    const sales = `/admin/audit/sales?from=${shopDay(-1)}&to=${shopDay(1)}`;
    await http.get(sales).expect(401);
    await http.get(sales).set('Authorization', shopper.auth).expect(403);
    await http.get(sales).set('Authorization', staff.auth).expect(403);
    await http.get(sales).set('Authorization', owner.auth).expect(200);

    const accounts = (
      await http.get('/admin/audit/access').set('Authorization', owner.auth).expect(200)
    ).body.accounts;
    expect(accounts.find((a: any) => a.id === staff.id)).toMatchObject({
      role: 'staff',
      can_audit: false,
    });
    expect(accounts.find((a: any) => a.id === owner.id)).toMatchObject({
      role: 'owner',
      can_audit: true,
    });
    await http.get('/admin/audit/access').set('Authorization', staff.auth).expect(403);

    await http
      .put(`/admin/audit/access/${staff.id}`)
      .set('Authorization', owner.auth)
      .send({ canAudit: true })
      .expect(200);
    expect((await http.get('/auth/me').set('Authorization', staff.auth)).body.user.canAudit).toBe(
      true,
    );
    await http.get(sales).set('Authorization', staff.auth).expect(200);
    // allowed staff still can't hand out access
    await http
      .put(`/admin/audit/access/${staff.id}`)
      .set('Authorization', staff.auth)
      .send({ canAudit: true })
      .expect(403);
    // owners can't be switched off
    await http
      .put(`/admin/audit/access/${owner.id}`)
      .set('Authorization', owner.auth)
      .send({ canAudit: false })
      .expect(404);

    await http
      .put(`/admin/audit/access/${staff.id}`)
      .set('Authorization', owner.auth)
      .send({ canAudit: false })
      .expect(200);
    await http.get(sales).set('Authorization', staff.auth).expect(403);
    const logged = await pglite.query<{ action: string }>(
      "select action from public.admin_logs where action like 'audit.access_%' order by created_at",
    );
    expect(logged.rows.map((r) => r.action)).toEqual([
      'audit.access_granted',
      'audit.access_removed',
    ]);
  });

  it('reports the sales paid in a period, refunds made in it, and tax by province', async () => {
    const paid = await pglite.query<{ id: number; total_cents: number; tax_cents: number }>(
      'select id, total_cents, tax_cents from public.orders where paid_at is not null order by id',
    );
    expect(paid.rows).toHaveLength(2);
    await pglite.query(
      "insert into public.order_events (order_id, event_type, data) values ($1, 'refunded', '{\"amount_cents\": 500}')",
      [paid.rows[0].id],
    );
    const gross = paid.rows.reduce((t, o) => t + Number(o.total_cents), 0);
    const tax = paid.rows.reduce((t, o) => t + Number(o.tax_cents), 0);

    const body = (
      await http
        .get(`/admin/audit/sales?from=${shopDay(-1)}&to=${shopDay(1)}`)
        .set('Authorization', owner.auth)
        .expect(200)
    ).body;
    expect(body.totals).toMatchObject({
      orders: 2,
      grossCents: gross,
      taxCents: tax,
      refunds: 1,
      refundedCents: 500,
      netCents: gross - 500,
    });
    expect(body.taxByRegion).toEqual([
      { country: 'CA', province: 'AB', orders: 2, taxCents: tax, totalCents: gross },
    ]);
    expect(body.orders.find((o: any) => o.id === paid.rows[0].id).refunded_cents).toBe(500);

    // a period with nothing in it
    const empty = (
      await http
        .get('/admin/audit/sales?from=2020-01-01&to=2020-01-31')
        .set('Authorization', owner.auth)
        .expect(200)
    ).body;
    expect(empty.totals).toMatchObject({ orders: 0, grossCents: 0, refunds: 0 });
  });

  it('checks the period', async () => {
    const get = (q: string) => http.get(`/admin/audit/sales?${q}`).set('Authorization', owner.auth);
    await get('from=yesterday&to=2026-10-01').expect(400);
    await get('from=2026-10-10&to=2026-10-01').expect(400, {
      success: false,
      error: 'The period ends before it starts.',
    });
    await get('from=2024-01-01&to=2026-01-01').expect(400);
  });

  it('says when Google Drive is not connected', async () => {
    const res = await http
      .get('/admin/audit/documents')
      .set('Authorization', owner.auth)
      .expect(200);
    expect(res.body).toEqual({ success: true, connected: false });
  });

  it('lists the audit folder and opens only documents inside it', async () => {
    const { privateKey } = await generateKeyPair('RS256', { extractable: true });
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: 'audit@shop.iam.gserviceaccount.com',
      private_key: await exportPKCS8(privateKey),
    });
    process.env.AUDIT_DRIVE_FOLDER_ID = 'ROOT';
    const files: Record<string, object> = {
      ROOT: { id: 'ROOT', name: 'Audit', mimeType: 'application/vnd.google-apps.folder' },
      Y2026: {
        id: 'Y2026',
        name: '2026',
        mimeType: 'application/vnd.google-apps.folder',
        parents: ['ROOT'],
      },
      INV: {
        id: 'INV',
        name: 'Invoice 12.pdf',
        mimeType: 'application/pdf',
        parents: ['Y2026'],
        size: '9',
      },
      SECRET: {
        id: 'SECRET',
        name: 'Payroll.pdf',
        mimeType: 'application/pdf',
        parents: ['ELSEWHERE'],
      },
      ELSEWHERE: {
        id: 'ELSEWHERE',
        name: 'Private',
        mimeType: 'application/vnd.google-apps.folder',
      },
    };
    const drive = mockFetch({
      'oauth2.googleapis.com/token': () => ({ access_token: 'drive-token', expires_in: 3600 }),
      '/drive/v3/files?': (_, url) =>
        new URL(url).searchParams.get('q')?.startsWith("'ROOT'")
          ? { files: [files.Y2026] }
          : { files: [files.INV] },
      '/drive/v3/files/': (init, url) => {
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer drive-token');
        const id = new URL(url).pathname.split('/').pop()!;
        if (url.includes('alt=media'))
          return new Response('%PDF-1.4', { headers: { 'content-type': 'application/pdf' } });
        return files[id] ?? new Response('{}', { status: 404 });
      },
    });
    try {
      const root = (
        await http.get('/admin/audit/documents').set('Authorization', owner.auth).expect(200)
      ).body;
      expect(root).toMatchObject({ connected: true, path: [{ id: 'ROOT', name: 'Audit' }] });
      expect(root.files).toEqual([expect.objectContaining({ id: 'Y2026', folder: true })]);

      const year = (
        await http.get('/admin/audit/folders/Y2026').set('Authorization', owner.auth).expect(200)
      ).body;
      expect(year.path.map((f: any) => f.name)).toEqual(['Audit', '2026']);
      expect(year.files).toEqual([expect.objectContaining({ id: 'INV', folder: false, size: 9 })]);

      const pdf = await http
        .get('/admin/audit/documents/INV')
        .set('Authorization', owner.auth)
        .expect(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
      expect(pdf.headers['content-disposition']).toContain('inline');
      expect(pdf.headers['cache-control']).toBe('private, no-store');

      // a file the shop's Google account can see, but outside the audit folder
      await http.get('/admin/audit/documents/SECRET').set('Authorization', owner.auth).expect(404);
      await http.get('/admin/audit/folders/ELSEWHERE').set('Authorization', owner.auth).expect(404);
      await http.get('/admin/audit/documents/INV').set('Authorization', staff.auth).expect(403);
      // only one sign-in for all of the above
      expect(drive.calls.filter((c) => c.url.includes('oauth2.googleapis.com')).length).toBe(1);
    } finally {
      drive.restore();
    }
    const viewed = await pglite.query<{ target: string }>(
      "select target from public.admin_logs where action = 'audit.document_viewed'",
    );
    expect(viewed.rows.map((r) => r.target)).toEqual(['INV']);
  });
});
