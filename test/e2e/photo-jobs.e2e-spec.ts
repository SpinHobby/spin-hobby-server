import { afterAll, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/common/errors.js';
import { SquarePhotosService } from '../../src/modules/admin/products/square-photos.service.js';
import { mockFetch } from '../support/harness.js';
import { startShop } from '../support/shop.js';

const shop = await startShop();
/** Our photo storage stands in: uploads and deletes succeed, and a stored photo reads back as bytes. */
const storage = mockFetch({
  'https://proj.supabase.co/storage/v1/object/public/': () =>
    new Response(Buffer.from('improved-photo'), { headers: { 'content-type': 'image/jpeg' } }),
  'https://proj.supabase.co/storage/v1/object/product-images': () => [],
});
afterAll(() => {
  storage.restore();
  return shop.close();
});
const { http, owner, staff, shopper, pglite } = shop;
const photos = shop.app.get(SquarePhotosService);
const asStaff = { Authorization: staff.auth };

const PHOTOS: Record<string, { id: string; url: string }[]> = {
  FIG1: [
    { id: 'IMG_A', url: 'https://sq.example/a.jpg' },
    { id: 'IMG_B', url: 'https://sq.example/b.jpg' },
  ],
  PRZ1: [{ id: 'IMG_C', url: 'https://sq.example/c.jpg' }],
  CHB1: [],
};
vi.spyOn(photos, 'list').mockImplementation(async (id: string) => {
  if (!PHOTOS[id]) throw new AppError('Product not found.', 404);
  return { shown: PHOTOS[id], hidden: [] };
});
const add = vi.spyOn(photos, 'add').mockResolvedValue({ created: 'NEW', shown: [], hidden: [] });

/** A connected photo computer. */
async function worker(label = 'Gaming PC') {
  const code = (await http.post('/admin/imports/pairing').set({ Authorization: owner.auth })).body
    .code as string;
  const token = (await http.post('/gleamshelf/pair').send({ code, label })).body.token as string;
  const as = { Authorization: `Bearer ${token}` };
  return {
    token,
    claim: async (features: string[] = ['photo']) =>
      (await http.post('/gleamshelf/jobs/claim').set(as).send({ features }).expect(200)).body
        .job as {
        id: string;
        sourceUrl: string;
        options: Record<string, unknown>;
        productName: string;
      } | null,
    submit: (id: string, details: unknown = { flags: [], seconds: 12 }) =>
      http
        .post(`/gleamshelf/jobs/${id}/result`)
        .set(as)
        .field('details', JSON.stringify(details))
        .attach('photo', Buffer.from('jpegbytes'), {
          filename: 'p.jpg',
          contentType: 'image/jpeg',
        }),
    fail: (id: string, error = 'the model crashed') =>
      http.post(`/gleamshelf/jobs/${id}/fail`).set(as).send({ error }),
  };
}
const batch = async (productIds: string[], extra: Record<string, unknown> = {}) =>
  (
    await http
      .post('/admin/photo-batches')
      .set(asStaff)
      .send({ productIds, ...extra })
      .expect(200)
  ).body;
const jobsOf = async (id: string) =>
  (await http.get(`/admin/photo-batches/${id}`).set(asStaff).expect(200)).body.batch.jobs as {
    id: string;
    status: string;
    productId: string;
    before: string;
    after: string | null;
    flags: string[];
    error: string | null;
  }[];

describe('sending photos to be improved', () => {
  it('is for staff only', async () => {
    await http
      .post('/admin/photo-batches')
      .send({ productIds: ['FIG1'] })
      .expect(401);
    await http
      .post('/admin/photo-batches')
      .set({ Authorization: shopper.auth })
      .send({ productIds: ['FIG1'] })
      .expect(403);
    await http.get('/admin/photo-batches').set({ Authorization: shopper.auth }).expect(403);
  });

  it('queues the main photo of each product, says which products were skipped and why, and never queues a photo twice', async () => {
    const first = await batch(['FIG1', 'PRZ1', 'CHB1', 'NOPE']);
    expect(first).toMatchObject({ queued: 2, alreadyQueued: 0 });
    expect(
      first.skipped.map((s: { productId: string; reason: string }) => [s.productId, s.reason]),
    ).toEqual([
      ['CHB1', 'it has no photos'],
      ['NOPE', 'Product not found.'],
    ]);
    expect((await jobsOf(first.batchId)).map((j) => j.status)).toEqual(['queued', 'queued']);
    // asking for all photos: FIG1's main and PRZ1's only photo are already waiting, its second photo is new
    const second = await batch(['FIG1', 'PRZ1'], { scope: 'all' });
    expect(second).toMatchObject({ queued: 1, alreadyQueued: 2 });
    // everything already waiting: no empty batch is left behind
    const third = await batch(['FIG1', 'PRZ1'], { scope: 'all' });
    expect(third).toMatchObject({ batchId: null, queued: 0, alreadyQueued: 3 });
  });

  it('refuses nothing chosen, too many, and nonsense options', async () => {
    await http.post('/admin/photo-batches').set(asStaff).send({ productIds: [] }).expect(400);
    await http
      .post('/admin/photo-batches')
      .set(asStaff)
      .send({ productIds: Array.from({ length: 101 }, (_, i) => `P${i}`) })
      .expect(400);
    expect(
      (
        await http
          .post('/admin/photo-batches')
          .set(asStaff)
          .send({ productIds: ['FIG1'], options: { mode: 'weird' } })
          .expect(400)
      ).body.error,
    ).toMatch(/mode must be/);
  });
});

describe('the photo computer', () => {
  it('needs its token, and is handed nothing when it cannot do photos', async () => {
    await http
      .post('/gleamshelf/jobs/claim')
      .send({ features: ['photo'] })
      .expect(401);
    await pglite.exec(
      "update public.photo_jobs set status = 'cancelled' where status in ('queued', 'running')",
    );
    await batch(['PRZ1']);
    const w = await worker();
    expect(await w.claim([])).toBeNull();
  });

  it('hands out a job once, with the options of its batch, and then nothing', async () => {
    await pglite.exec(
      "update public.photo_jobs set status = 'cancelled' where status in ('queued', 'running')",
    );
    const b = await batch(['FIG1'], { options: { enlarge: false, mode: 'auto', stickers: false } });
    const w = await worker('Back office PC');
    const job = await w.claim();
    expect(job).toMatchObject({
      sourceUrl: 'https://sq.example/a.jpg',
      productName: expect.any(String),
      options: { mode: 'auto', stickers: false, enlarge: false, look: true },
    });
    expect(await w.claim()).toBeNull();
    expect((await jobsOf(b.batchId))[0].status).toBe('running');
  });

  it('shows the owner which photo computers are awake', async () => {
    const list = (await http.get('/admin/photo-batches').set(asStaff).expect(200)).body.workers as {
      label: string;
      online: boolean;
      canImprovePhotos: boolean;
      working: number;
    }[];
    const mine = list.find((w) => w.label === 'Back office PC')!;
    expect(mine).toMatchObject({ online: true, canImprovePhotos: true, working: 1 });
    expect(list.find((w) => w.label === 'Gaming PC')).toMatchObject({ canImprovePhotos: false });
  });

  it('takes the improved photo with what it noticed, and refuses a worker that does not hold the job', async () => {
    await pglite.exec(
      "update public.photo_jobs set status = 'cancelled' where status in ('queued', 'running')",
    );
    const b = await batch(['PRZ1']);
    const w = await worker();
    const other = await worker('Another PC');
    const job = (await w.claim())!;
    expect((await other.submit(job.id).expect(409)).body.error).toMatch(/not yours/);
    await w
      .submit(job.id, {
        flags: ['one printed line was left'],
        notes: ['an angled box'],
        seconds: 31.4,
        modeUsed: 'product',
        unknown: 'dropped',
      })
      .expect(200);
    const [done] = await jobsOf(b.batchId);
    expect(done).toMatchObject({
      status: 'done',
      flags: ['one printed line was left'],
      before: 'https://sq.example/c.jpg',
    });
    expect(done.after).toMatch(/^https?:\/\//);
    await w.submit(job.id).expect(409); // it was already handed in
  });

  it('puts a failed photo back in the queue, and gives up after three tries', async () => {
    await pglite.exec(
      "update public.photo_jobs set status = 'cancelled' where status in ('queued', 'running', 'done')",
    );
    const b = await batch(['PRZ1']);
    const w = await worker();
    for (let attempt = 1; attempt <= 3; attempt++) {
      const job = (await w.claim())!;
      expect(job).not.toBeNull();
      await w.fail(job.id, `try ${attempt} failed`).expect(200);
    }
    const [job] = await jobsOf(b.batchId);
    expect(job).toMatchObject({ status: 'failed', error: 'try 3 failed' });
    expect(await w.claim()).toBeNull();
  });

  it('gives a job back to the queue when its worker disappears, up to three times', async () => {
    await pglite.exec(
      "update public.photo_jobs set status = 'cancelled' where status in ('queued', 'running', 'done', 'failed')",
    );
    const b = await batch(['PRZ1']);
    const w = await worker();
    const first = (await w.claim())!;
    await pglite.exec(
      "update public.photo_jobs set lease_until = now() - interval '1 hour' where status = 'running'",
    );
    expect((await w.claim())!.id).toBe(first.id); // the lease ran out: it is handed out again
    await pglite.exec(
      "update public.photo_jobs set lease_until = now() - interval '1 hour' where status = 'running'",
    );
    expect((await w.claim())!.id).toBe(first.id);
    await pglite.exec(
      "update public.photo_jobs set lease_until = now() - interval '1 hour' where status = 'running'",
    );
    expect(await w.claim()).toBeNull(); // three attempts and nobody answered
    expect((await jobsOf(b.batchId))[0]).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/stopped answering/),
    });
  });
});

describe('deciding on improved photos', () => {
  async function doneJob(productId = 'FIG1') {
    await pglite.exec(
      "update public.photo_jobs set status = 'cancelled' where status in ('queued', 'running', 'done', 'failed')",
    );
    const b = await batch([productId]);
    const w = await worker();
    const job = (await w.claim())!;
    await w.submit(job.id).expect(200);
    return { batchId: b.batchId as string, jobId: job.id };
  }

  it("uses a photo: the new one takes the old one's place, and nothing is applied twice", async () => {
    add.mockClear();
    const { batchId, jobId } = await doneJob('FIG1');
    await http
      .post(`/admin/photo-batches/photos/${jobId}/apply`)
      .set({ Authorization: shopper.auth })
      .expect(403);
    await http.post(`/admin/photo-batches/photos/${jobId}/apply`).set(asStaff).expect(200);
    expect(add).toHaveBeenCalledOnce();
    expect(add.mock.calls[0][1]).toBe('FIG1');
    expect(Buffer.from(add.mock.calls[0][2]).toString()).toBe('improved-photo');
    expect(add.mock.calls[0][3]).toBe('IMG_A'); // the original photo it replaces
    expect((await jobsOf(batchId))[0]).toMatchObject({ status: 'applied', after: null });
    expect(
      (await http.post(`/admin/photo-batches/photos/${jobId}/apply`).set(asStaff).expect(409)).body
        .error,
    ).toMatch(/already used/);
  });

  it('keeps the photo waiting when the shop cannot take it, so it can be tried again', async () => {
    const { batchId, jobId } = await doneJob('FIG1');
    add.mockRejectedValueOnce(new AppError('The photo being edited is no longer on this product.'));
    expect(
      (await http.post(`/admin/photo-batches/photos/${jobId}/apply`).set(asStaff).expect(400)).body
        .error,
    ).toMatch(/no longer on this product/);
    expect((await jobsOf(batchId))[0].status).toBe('done');
    await http.post(`/admin/photo-batches/photos/${jobId}/apply`).set(asStaff).expect(200);
  });

  it('uses all the finished photos of a batch at once and reports the ones that did not go', async () => {
    await pglite.exec(
      "update public.photo_jobs set status = 'cancelled' where status in ('queued', 'running', 'done', 'failed')",
    );
    const b = await batch(['FIG1', 'PRZ1']);
    const w = await worker();
    for (let i = 0; i < 2; i++) await w.submit((await w.claim())!.id).expect(200);
    add
      .mockResolvedValueOnce({ created: 'N1', shown: [], hidden: [] })
      .mockRejectedValueOnce(new AppError('Square said no.'));
    const r = (
      await http.post(`/admin/photo-batches/${b.batchId}/apply`).set(asStaff).send({}).expect(200)
    ).body;
    expect(r.applied).toBe(1);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].error).toBe('Square said no.');
    const states = (await jobsOf(b.batchId)).map((j) => j.status).sort();
    expect(states).toEqual(['applied', 'done']);
  });

  it('rejects a photo, drops it from storage, and lets it be queued again', async () => {
    const { batchId, jobId } = await doneJob('FIG1');
    await http.post(`/admin/photo-batches/photos/${jobId}/reject`).set(asStaff).expect(200);
    expect((await jobsOf(batchId))[0]).toMatchObject({ status: 'rejected', after: null });
    expect(JSON.stringify(storage.calls.filter((c) => c.body?.prefixes))).toMatch(/imports\//);
    await http.post(`/admin/photo-batches/photos/${jobId}/reject`).set(asStaff).expect(409);
    await http.post(`/admin/photo-batches/photos/${jobId}/retry`).set(asStaff).expect(200);
    expect((await jobsOf(batchId))[0].status).toBe('queued');
    await http.post(`/admin/photo-batches/photos/${jobId}/retry`).set(asStaff).expect(409); // it is not failed or rejected any more
  });

  it('cancels what has not started, and leaves what has', async () => {
    await pglite.exec(
      "update public.photo_jobs set status = 'cancelled' where status in ('queued', 'running', 'done', 'failed')",
    );
    const b = await batch(['FIG1', 'PRZ1']);
    const w = await worker();
    await w.claim(); // one is now running
    const r = (await http.post(`/admin/photo-batches/${b.batchId}/cancel`).set(asStaff).expect(200))
      .body;
    expect(r.cancelled).toBe(1);
    expect((await jobsOf(b.batchId)).map((j) => j.status).sort()).toEqual(['cancelled', 'running']);
  });

  it('lists the recent batches with how far each has got', async () => {
    const list = (await http.get('/admin/photo-batches').set(asStaff).expect(200)).body.batches as {
      counts: Record<string, number>;
    }[];
    expect(list.length).toBeGreaterThan(3);
    expect(Object.keys(list[0].counts)).toEqual([
      'queued',
      'running',
      'done',
      'failed',
      'applied',
      'rejected',
      'cancelled',
    ]);
  });
});
