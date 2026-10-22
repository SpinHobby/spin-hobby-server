import { afterAll, describe, expect, it } from 'vitest';
import { mockFetch } from '../support/harness.js';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, owner, staff, shopper, pglite } = shop;
const asStaff = { Authorization: staff.auth };

/** A connected photo computer. */
async function worker(label = 'Gaming PC') {
  const code = (await http.post('/admin/imports/pairing').set({ Authorization: owner.auth })).body
    .code as string;
  const token = (await http.post('/gleamshelf/pair').send({ code, label })).body.token as string;
  const as = { Authorization: `Bearer ${token}` };
  return {
    claim: async (features: string[] = ['photo', 'listing', 'describe']) =>
      (await http.post('/gleamshelf/describe-jobs/claim').set(as).send({ features }).expect(200))
        .body.job,
    submit: (id: string, result: unknown) =>
      http.post(`/gleamshelf/describe-jobs/${id}/result`).set(as).send({ result }),
    fail: (id: string, error = 'the model crashed') =>
      http.post(`/gleamshelf/describe-jobs/${id}/fail`).set(as).send({ error }),
    progress: (id: string, percent: number, step?: string) =>
      http.post(`/gleamshelf/describe-jobs/${id}/progress`).set(as).send({ percent, step }),
  };
}

const proposal = {
  description:
    'A 1/7 scale figure of Rem from Re:Zero, in her maid outfit.\n\nAbout 23 cm tall, made by KADOKAWA.',
  series: 'Re:ZERO -Starting Life in Another World-',
  manufacturer: 'KADOKAWA',
  category: 'Scale Figures',
  highlights: ['1/7 scale', 'about 23 cm'],
  unsupported: ['release date'],
  flags: [],
  sources: ['https://example.com/rem', 'not a link'],
  lookup: { state: 'found', detail: '3 of 5 pictures show this cover.' },
  seconds: 95,
};

describe('product descriptions from the photo computer', () => {
  it('is for staff only', async () => {
    await http.get('/admin/describe-jobs').set({ Authorization: shopper.auth }).expect(403);
    await http.post('/admin/describe-jobs').send({ missing: true }).expect(401);
  });

  it('queues every visible product without a description that has a photo, once', async () => {
    const before = (await http.get('/admin/describe-jobs').set(asStaff).expect(200)).body;
    expect(before.missing).toBe(5); // the hidden product is not counted
    const res = await http
      .post('/admin/describe-jobs')
      .set(asStaff)
      .send({ missing: true })
      .expect(200);
    expect(res.body).toMatchObject({ queued: 1, noPhoto: 4, alreadyQueued: 0 }); // only FIG1 has a photo
    const again = await http
      .post('/admin/describe-jobs')
      .set(asStaff)
      .send({ ids: ['FIG1'] })
      .expect(200);
    expect(again.body).toMatchObject({ queued: 0, alreadyQueued: 1 });
    await http.post('/admin/describe-jobs').set(asStaff).send({}).expect(400);
  });

  it('gives a job only to a worker that can describe, with what the shop knows', async () => {
    const w = await worker();
    expect(await w.claim(['photo', 'listing'])).toBeNull();
    const job = await w.claim();
    expect(job).toMatchObject({
      productId: 'FIG1',
      productName: 'Rem 1/7 Scale Figure',
      photoUrl: 'https://img/fig1.jpg',
      hints: { category: 'Scale Figures', series: 'Re:Zero' },
    });
    expect(await w.claim()).toBeNull(); // nothing else waiting
    await w.progress(job.id, 40, 'Looking the product up online').expect(200);
    const running = (await http.get('/admin/describe-jobs').set(asStaff)).body.jobs[0];
    expect(running).toMatchObject({
      status: 'running',
      progress: 40,
      step: 'Looking the product up online',
      proposal: null,
    });

    await w.submit(job.id, { ...proposal, description: '  ' }).expect(400);
    await w.submit(job.id, proposal).expect(200);
    await w.submit(job.id, proposal).expect(409); // already handed in

    const list = (await http.get('/admin/describe-jobs?status=done').set(asStaff)).body;
    expect(list.counts.done).toBe(1);
    expect(list.jobs[0]).toMatchObject({
      status: 'done',
      productName: 'Rem 1/7 Scale Figure',
      current: { description: null, series: 'Re:Zero', manufacturer: null },
      proposal: {
        manufacturer: 'KADOKAWA',
        sources: ['https://example.com/rem'],
        lookup: '3 of 5 pictures show this cover.',
        seconds: 95,
      },
    });
    expect(list.workers[0]).toMatchObject({ label: 'Gaming PC', online: true });
  });

  it('applies a proposal: the description goes to Square (only the description changes) and the maker to the product', async () => {
    const id = (await http.get('/admin/describe-jobs?status=done').set(asStaff)).body.jobs[0]
      .id as string;
    const square = mockFetch({
      '/v2/catalog/batch-retrieve': () => ({
        objects: [
          {
            type: 'ITEM',
            id: 'FIG1',
            version: 12,
            updated_at: '2026-10-01T00:00:00Z',
            item_data: {
              name: 'Rem 1/7 Scale Figure',
              description: 'old',
              description_plaintext: 'old',
              image_ids: ['IMG1'],
              variations: [{ id: 'FIG1_V' }],
            },
          },
        ],
      }),
      '/v2/catalog/batch-upsert': () => ({ objects: [] }),
    });
    try {
      await http
        .post(`/admin/describe-jobs/${id}/apply`)
        .set(asStaff)
        .send({ description: 'Too short' })
        .expect(400);
      await http
        .post(`/admin/describe-jobs/${id}/apply`)
        .set(asStaff)
        .send({
          description: 'A 1/7 scale figure of Rem <in her maid outfit>.\n\nAbout 23 cm tall.',
          manufacturer: 'KADOKAWA',
        })
        .expect(200);
      const sent = square.calls.find((c) => c.url.includes('batch-upsert'))!.body.batches[0]
        .objects[0];
      expect(sent).toMatchObject({
        id: 'FIG1',
        version: 12,
        item_data: { name: 'Rem 1/7 Scale Figure', image_ids: ['IMG1'] },
      });
      expect(sent.item_data.description_html).toBe(
        '<p>A 1/7 scale figure of Rem &lt;in her maid outfit&gt;.</p><p>About 23 cm tall.</p>',
      );
      expect(sent.item_data.description).toBeUndefined();
      expect(sent.item_data.description_plaintext).toBeUndefined();
      expect(sent.updated_at).toBeUndefined();
    } finally {
      square.restore();
    }
    const item = (await http.get('/square/catalog/FIG1').expect(200)).body.item;
    expect(item.description).toBe(
      'A 1/7 scale figure of Rem <in her maid outfit>.\n\nAbout 23 cm tall.',
    );
    expect(item.manufacturer).toBe('KADOKAWA');
    expect(item.series).toBe('Re:Zero'); // not sent: unchanged
    expect(
      (await http.get('/admin/describe-jobs?status=finished').set(asStaff)).body.jobs[0].status,
    ).toBe('applied');
    await http
      .post(`/admin/describe-jobs/${id}/apply`)
      .set(asStaff)
      .send({ description: 'Applying the same proposal twice is refused.' })
      .expect(409);
    // described now: no longer counted as missing
    expect((await http.get('/admin/describe-jobs').set(asStaff)).body.missing).toBe(4);
  });

  it('keeps a failed Square write from changing anything', async () => {
    await pglite.query(
      "insert into public.product_images (square_item_id, image_url) values ('PRZ1', 'https://img/prz1.jpg')",
    );
    await http
      .post('/admin/describe-jobs')
      .set(asStaff)
      .send({ ids: ['PRZ1'] })
      .expect(200);
    const w = await worker('Second PC');
    const job = await w.claim();
    await w
      .submit(job.id, {
        description: 'A prize figure of Hatsune Miku in her classic outfit, about 18 cm tall.',
      })
      .expect(200);
    const square = mockFetch({
      '/v2/catalog/batch-retrieve': () =>
        new Response(JSON.stringify({ errors: [{ detail: 'Square is down' }] }), { status: 500 }),
    });
    try {
      await http
        .post(`/admin/describe-jobs/${job.id}/apply`)
        .set(asStaff)
        .send({ description: 'A prize figure of Hatsune Miku, about 18 cm tall.' })
        .expect(500);
    } finally {
      square.restore();
    }
    expect((await http.get('/square/catalog/PRZ1')).body.item.description).toBeNull();
    const still = (await http.get('/admin/describe-jobs?status=done').set(asStaff)).body.jobs.find(
      (j: any) => j.id === job.id,
    );
    expect(still.status).toBe('done');
    // skipping leaves the product as it was; asking again puts it back in the queue
    await http.post(`/admin/describe-jobs/${job.id}/dismiss`).set(asStaff).expect(200);
    await http.post(`/admin/describe-jobs/${job.id}/retry`).set(asStaff).expect(200);
    expect((await w.claim()).productId).toBe('PRZ1');
  });

  it('retries a job the worker could not do, and fails it after three tries', async () => {
    const w = await worker('Third PC');
    // the PRZ1 job from the last test is running on another worker: hand it back three times
    const [row] = (
      await pglite.query<{ id: string }>(
        "select id from public.describe_jobs where square_item_id = 'PRZ1' and status = 'running'",
      )
    ).rows;
    await pglite.query(
      "update public.describe_jobs set worker_id = null, status = 'queued', attempts = 0 where id = $1",
      [row.id],
    );
    for (let i = 0; i < 3; i++) {
      const job = await w.claim();
      expect(job.id).toBe(row.id);
      await w.fail(job.id, 'web search is down').expect(200);
    }
    const list = (await http.get('/admin/describe-jobs').set(asStaff)).body.jobs;
    expect(list.find((j: any) => j.id === row.id)).toMatchObject({
      status: 'failed',
      error: 'web search is down',
    });
    await http.post('/admin/describe-jobs/cancel-queued').set(asStaff).expect(200);
  });
});
