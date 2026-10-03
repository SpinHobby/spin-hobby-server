import type { PGlite } from '@electric-sql/pglite';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, createDatabase, JWT_SECRET, signUp } from './harness.js';

let pglite: PGlite;
let app: INestApplication;
let http: ReturnType<typeof request>;
let staff: Awaited<ReturnType<typeof signUp>>;

beforeAll(async () => {
  Object.assign(process.env, { SUPABASE_JWT_SECRET: JWT_SECRET, ALLOWED_ORIGINS: 'http://localhost:5173' });
  const db = await createDatabase();
  pglite = db.pglite;
  app = await createApp(db.driver);
  http = request(app.getHttpServer());
  staff = await signUp(pglite, 'helper@spinhobby.com', 'staff');
});

afterAll(async () => {
  await app?.close();
  await pglite?.close();
});

describe('events', () => {
  it('ships with the 2026 convention schedule, in date order', async () => {
    const { events } = (await http.get('/events').expect(200)).body;
    expect(events).toHaveLength(15);
    expect(events.map((e: any) => e.start_date)).toEqual([...events.map((e: any) => e.start_date)].sort());
    expect(events.map((e: any) => e.name)).not.toContain('@Aidi birthing');
    expect(events[0]).toMatchObject({ name: 'Rakku-Con Spring', venue: 'Genesis Centre', city: 'Calgary, AB', start_date: '2026-04-04', end_date: null });
    expect(events.find((e: any) => e.name === 'Calgary Expo')).toMatchObject({ start_date: '2026-04-23', end_date: '2026-04-26', link_url: 'https://fanexpohq.com/calgaryexpo/' });
    expect(events.at(-1)).toMatchObject({ name: 'Rakku-Con Fall', start_date: '2026-09-26' });
    for (const e of events) expect(e.link_url).toMatch(/^https:\/\//);
  });

  it('feeds the homepage the same list', async () => {
    const home = (await http.get('/homepage')).body;
    expect(home.events).toHaveLength(15);
  });

  it('hides hidden events from the public list but not from staff', async () => {
    const id = (await pglite.query<any>("select id from public.store_events where name = 'Animethon'")).rows[0].id;
    await http.put(`/admin/events/${id}`).set('Authorization', staff.auth).send({ name: 'Animethon', isVisible: false }).expect(200);
    expect((await http.get('/events')).body.events.map((e: any) => e.name)).not.toContain('Animethon');
    expect((await http.get('/admin/events').set('Authorization', staff.auth)).body.events.map((e: any) => e.name)).toContain('Animethon');
  });

  it('saves a venue and link, and rejects a link that is not a web address', async () => {
    const created = await http.post('/admin/events').set('Authorization', staff.auth)
      .send({ name: 'Otafest 2027', city: 'Calgary, AB', venue: 'Telus Convention Centre', startDate: '2027-05-14', linkUrl: 'https://otafest.com' }).expect(200);
    expect(created.body.event).toMatchObject({ venue: 'Telus Convention Centre', link_url: 'https://otafest.com' });
    await http.post('/admin/events').set('Authorization', staff.auth).send({ name: 'Bad link', linkUrl: 'javascript:alert(1)' })
      .expect(400, { success: false, error: 'The link must start with http:// or https://.' });
    await http.post('/admin/events').set('Authorization', staff.auth).send({ name: 'Bad link 2', linkUrl: 'example.com' }).expect(400);
    const updated = await http.put(`/admin/events/${created.body.event.id}`).set('Authorization', staff.auth).send({ name: 'Otafest 2027', linkUrl: null, venue: null }).expect(200);
    expect(updated.body.event).toMatchObject({ venue: null, link_url: null });
  });

  it('puts undated events last', async () => {
    await http.post('/admin/events').set('Authorization', staff.auth).send({ name: 'TBA Con' }).expect(200);
    const names = (await http.get('/events')).body.events.map((e: any) => e.name);
    expect(names.at(-1)).toBe('TBA Con');
  });
});
