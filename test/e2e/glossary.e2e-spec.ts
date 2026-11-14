import { afterAll, describe, expect, it } from 'vitest';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, staff, shopper } = shop;

describe('glossary', () => {
  it('lists the terms staff add, A to Z, for anyone', async () => {
    expect((await http.get('/glossary').expect(200)).body).toEqual({ success: true, terms: [] });

    const added = await http
      .post('/admin/glossary')
      .set('Authorization', staff.auth)
      .send({
        term: '  Scale figure ',
        meaning: 'A figure made to a fixed size ratio, such as 1/7.',
      })
      .expect(200);
    expect(added.body.term).toMatchObject({ term: 'Scale figure' });
    await http
      .post('/admin/glossary')
      .set('Authorization', staff.auth)
      .send({ term: 'Nendoroid', meaning: 'Small chibi-style figures with swappable faces.' })
      .expect(200);

    const list = await http.get('/glossary').expect(200);
    expect(list.body.terms.map((t: { term: string }) => t.term)).toEqual([
      'Nendoroid',
      'Scale figure',
    ]);
  });

  it('refuses a term that is already there, and a missing meaning', async () => {
    await http
      .post('/admin/glossary')
      .set('Authorization', staff.auth)
      .send({ term: 'NENDOROID', meaning: 'Again.' })
      .expect(409, { success: false, error: '"NENDOROID" is already in the glossary.' });
    await http
      .post('/admin/glossary')
      .set('Authorization', staff.auth)
      .send({ term: 'Blind box' })
      .expect(400, { success: false, error: 'meaning is required.' });
  });

  it('lets only staff add terms', async () => {
    const term = { term: 'Bootleg', meaning: 'An unlicensed copy.' };
    await http.post('/admin/glossary').send(term).expect(401); // not signed in
    await http.post('/admin/glossary').set('Authorization', shopper.auth).send(term).expect(403);
  });
});
