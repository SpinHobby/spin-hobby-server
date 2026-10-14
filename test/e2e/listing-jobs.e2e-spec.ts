import { afterAll, describe, expect, it } from 'vitest';
import { mockFetch } from '../support/harness.js';
import { startShop } from '../support/shop.js';

const shop = await startShop();
/** Our photo storage (Supabase) stands in: uploads and deletes succeed. */
const storage = mockFetch({
  'https://proj.supabase.co/storage/v1/object/product-images': () => [],
});
afterAll(() => {
  storage.restore();
  return shop.close();
});
const { http, owner, staff, shopper } = shop;
const asStaff = { Authorization: staff.auth };

const PHOTO = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);
const draft = (over: Record<string, unknown> = {}) => ({
  sourceKey: 'listing-source-0001',
  title: 'Murasame Kai Ni Figure (Kantai Collection)',
  description: 'A prize figure.',
  category: 'Bishoujo Figures',
  series: 'Kantai Collection',
  flags: [],
  sources: [],
  ...over,
});

/** A connected photo computer. */
async function worker(label = 'Gaming PC') {
  const code = (await http.post('/admin/imports/pairing').set({ Authorization: owner.auth })).body
    .code as string;
  const token = (await http.post('/gleamshelf/pair').send({ code, label })).body.token as string;
  const as = { Authorization: `Bearer ${token}` };
  return {
    claim: async (features: string[] = ['photo', 'listing']) =>
      (await http.post('/gleamshelf/listing-jobs/claim').set(as).send({ features }).expect(200))
        .body.job as {
        id: string;
        sourceUrl: string;
        fileName: string;
        options: Record<string, unknown>;
      } | null,
    submit: (id: string, d: unknown = draft(), details: unknown = { flags: [], seconds: 30 }) =>
      http
        .post(`/gleamshelf/listing-jobs/${id}/result`)
        .set(as)
        .field('draft', JSON.stringify(d))
        .field('details', JSON.stringify(details))
        .attach('photo', PHOTO, { filename: 'p.jpg', contentType: 'image/jpeg' }),
    fail: (id: string, error = 'the model crashed') =>
      http.post(`/gleamshelf/listing-jobs/${id}/fail`).set(as).send({ error }),
  };
}

const upload = (names: string[], options?: unknown, type = 'image/jpeg') => {
  const r = http.post('/admin/listing-jobs').set(asStaff);
  if (options !== undefined) r.field('options', JSON.stringify(options));
  for (const n of names) r.attach('photos', PHOTO, { filename: n, contentType: type });
  return r;
};
const list = async () =>
  (await http.get('/admin/listing-jobs').set(asStaff).expect(200)).body as {
    jobs: {
      id: string;
      fileName: string;
      status: string;
      draftId: string | null;
      draftTitle: string | null;
      error: string | null;
    }[];
    counts: Record<string, number>;
    workers: { label: string; online: boolean; canCreateListings: boolean }[];
  };

describe('uploading photos', () => {
  it('queues one job per photo, for staff only', async () => {
    await http.get('/admin/listing-jobs').expect(401);
    await http.get('/admin/listing-jobs').set({ Authorization: shopper.auth }).expect(403);
    const res = await upload(['IMG_1.jpg', 'IMG_2.jpg']).expect(200);
    expect(res.body).toMatchObject({ success: true, queued: 2 });
    const l = await list();
    expect(l.jobs.map((j) => j.fileName).sort()).toEqual(['IMG_1.jpg', 'IMG_2.jpg']);
    expect(l.jobs.every((j) => j.status === 'queued')).toBe(true);
    expect(l.counts.queued).toBe(2);
  });

  it('refuses no photos, a file that is not a photo, and unreadable options, queueing nothing', async () => {
    const before = (await list()).jobs.length;
    await http.post('/admin/listing-jobs').set(asStaff).expect(400);
    const heic = await upload(['IMG_3.heic'], undefined, 'image/heic').expect(400);
    expect(heic.body.error).toMatch(/IMG_3\.heic.*JPEG/);
    await upload(['IMG_4.jpg'], { mode: 'sideways' }).expect(400);
    expect((await list()).jobs.length).toBe(before);
  });
});

describe('a photo computer', () => {
  it('takes the photos one at a time, oldest first, and only if it can write listings', async () => {
    const w = await worker('Listing PC');
    expect(await w.claim(['photo'])).toBeNull();
    const first = await w.claim();
    expect(first).toMatchObject({ options: { mode: 'product', stickers: true } });
    expect(first!.sourceUrl).toMatch(/^http/);
    const second = await w.claim();
    expect(second!.id).not.toBe(first!.id);
    const l = await list();
    expect(l.jobs.filter((j) => j.status === 'running')).toHaveLength(2);
    expect(l.workers.find((x) => x.label === 'Listing PC')).toMatchObject({
      online: true,
      canCreateListings: true,
    });
  });

  it('sends back a draft, which lands in the Imports inbox, and the job is done', async () => {
    const w = await worker('Result PC');
    await upload(['finished.jpg']).expect(200);
    let job = await w.claim();
    while (job && job.fileName !== 'finished.jpg') job = await w.claim();
    expect(job).not.toBeNull();
    const sent = await w.submit(job!.id).expect(200);
    expect(sent.body).toMatchObject({ success: true });
    const done = (await list()).jobs.find((j) => j.id === job!.id)!;
    expect(done).toMatchObject({
      status: 'done',
      draftTitle: 'Murasame Kai Ni Figure (Kantai Collection)',
    });
    const inbox = (await http.get('/admin/imports').set(asStaff).expect(200)).body.imports as {
      id: string;
      title: string;
    }[];
    expect(inbox.find((d) => d.id === done.draftId)?.title).toBe(
      'Murasame Kai Ni Figure (Kantai Collection)',
    );
    // it cannot be answered twice
    await w.submit(job!.id).expect(409);
  });

  it('cannot answer a job it does not hold', async () => {
    const mine = await worker('Mine');
    const other = await worker('Other');
    await upload(['not-yours.jpg']).expect(200);
    let job = await mine.claim();
    while (job && job.fileName !== 'not-yours.jpg') job = await mine.claim();
    await other.submit(job!.id).expect(409);
    await other.fail(job!.id).expect(409);
  });

  it('puts a failed photo back until it has failed three times, then shows the reason and lets staff retry', async () => {
    const w = await worker('Failing PC');
    await upload(['broken.jpg']).expect(200);
    const claimBroken = async () => {
      let j = await w.claim();
      while (j && j.fileName !== 'broken.jpg') j = await w.claim();
      return j!;
    };
    for (let i = 0; i < 3; i++) {
      const j = await claimBroken();
      await w.fail(j.id, `try ${i + 1} failed`).expect(200);
    }
    const failed = (await list()).jobs.find((j) => j.fileName === 'broken.jpg')!;
    expect(failed).toMatchObject({ status: 'failed', error: 'try 3 failed' });
    await http.post(`/admin/listing-jobs/${failed.id}/retry`).set(asStaff).expect(200);
    expect((await list()).jobs.find((j) => j.id === failed.id)!.status).toBe('queued');
    await http.post(`/admin/listing-jobs/${failed.id}/retry`).set(asStaff).expect(409);
  });
});

describe('cancelling', () => {
  it('takes a queued photo out of the queue, and only a queued one', async () => {
    const w = await worker('Cancel PC');
    await upload(['cancel-me.jpg']).expect(200);
    const queued = (await list()).jobs.find((j) => j.fileName === 'cancel-me.jpg')!;
    await http.post(`/admin/listing-jobs/${queued.id}/cancel`).set(asStaff).expect(200);
    expect((await list()).jobs.find((j) => j.id === queued.id)!.status).toBe('cancelled');
    await http.post(`/admin/listing-jobs/${queued.id}/cancel`).set(asStaff).expect(409);
    // nothing the worker can claim is the cancelled photo
    let job = await w.claim();
    while (job) {
      expect(job.fileName).not.toBe('cancel-me.jpg');
      job = await w.claim();
    }
    await http
      .post('/admin/listing-jobs/00000000-0000-4000-8000-000000000000/cancel')
      .set(asStaff)
      .expect(404);
  });
});
