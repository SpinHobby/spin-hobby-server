import { afterAll, describe, expect, it } from 'vitest';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, staff, shopper } = shop;

describe('notes (sample REST API)', () => {
  it('lists the notes staff add, newest first, for anyone', async () => {
    expect((await http.get('/hello/notes').expect(200)).body).toEqual({ success: true, notes: [] });

    const first = await http
      .post('/hello/notes')
      .set('Authorization', staff.auth)
      .send({ text: '  First note  ' })
      .expect(200);
    expect(first.body.note).toMatchObject({ text: 'First note' });
    expect(first.body.note.id).toMatch(/^[0-9a-f-]{36}$/);
    await http
      .post('/hello/notes')
      .set('Authorization', staff.auth)
      .send({ text: 'Second note' })
      .expect(200);

    const list = await http.get('/hello/notes').expect(200);
    expect(list.body.notes.map((n: { text: string }) => n.text)).toEqual([
      'Second note',
      'First note',
    ]);
  });

  it('deletes a note, and answers 404 for one that is not there', async () => {
    const added = await http
      .post('/hello/notes')
      .set('Authorization', staff.auth)
      .send({ text: 'Delete me' })
      .expect(200);
    const id = added.body.note.id as string;
    await http.delete(`/hello/notes/${id}`).set('Authorization', staff.auth).expect(200);
    const texts = (await http.get('/hello/notes').expect(200)).body.notes.map(
      (n: { text: string }) => n.text,
    );
    expect(texts).not.toContain('Delete me');
    await http.delete(`/hello/notes/${id}`).set('Authorization', staff.auth).expect(404);
    await http.delete('/hello/notes/not-an-id').set('Authorization', staff.auth).expect(400);
  });

  it('refuses a blank note, and writes from anyone but staff', async () => {
    await http
      .post('/hello/notes')
      .set('Authorization', staff.auth)
      .send({ text: '   ' })
      .expect(400);
    await http.post('/hello/notes').send({ text: 'Signed out' }).expect(401);
    await http
      .post('/hello/notes')
      .set('Authorization', shopper.auth)
      .send({ text: 'A shopper' })
      .expect(403);
  });
});
