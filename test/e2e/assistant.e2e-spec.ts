import { afterAll, describe, expect, it } from 'vitest';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, owner } = shop;

/** The shop's Gleamshelf computer, connected with a pairing code. */
async function computer(label = 'Shop Mac') {
  const code = (await http.post('/admin/imports/pairing').set({ Authorization: owner.auth })).body
    .code as string;
  const token = (await http.post('/gleamshelf/pair').send({ code, label })).body.token as string;
  const as = { Authorization: `Bearer ${token}` };
  return {
    profile: (body: object) => http.post('/gleamshelf/assistant/profile').set(as).send(body),
    claim: (wait = 5) => http.post('/gleamshelf/assistant/claim').set(as).send({ wait }),
    answer: (id: string, body: object) =>
      http.post(`/gleamshelf/assistant/${id}/answer`).set(as).send(body),
  };
}

/** A tiny PNG and a tiny WAV, as the app sends them (base64). */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString(
  'base64',
);
const wav = () => {
  const b = Buffer.alloc(48);
  b.write('RIFF', 0, 'latin1');
  b.write('WAVEfmt ', 8, 'latin1');
  return b.toString('base64');
};

describe('the shop assistant', () => {
  it('while no computer answers, the shop answers with text: what matches, and that the talking assistant is away', async () => {
    const status = (await http.get('/assistant').expect(200)).body;
    expect(status).toMatchObject({ enabled: true, online: false, voice: false, portrait: false });
    const reply = (
      await http
        .post('/assistant/ask')
        .send({ question: 'Do you have the Miku prize figure?' })
        .expect(200)
    ).body;
    expect(reply).toMatchObject({ by: 'shop', audio: null });
    expect(reply.products.map((p: { id: string }) => p.id)).toEqual(['PRZ1']);
    expect(reply.answer).toBe(
      'Here is what I found: Miku Prize Figure ($39, in stock). The talking assistant is away right now, so for anything else, message the shop.',
    );
    expect((await http.post('/assistant/ask').send({ question: '' })).status).toBe(400);
    expect((await http.post('/assistant/ask').send({ question: 'x'.repeat(301) })).status).toBe(
      400,
    );
  });

  it("is answered by the shop's computer while it is on: the question waits for it, and the answer comes with its voice", async () => {
    const mac = await computer();
    const on = (
      await mac.profile({ on: true, name: 'Gleam', voice: true, portrait: PNG }).expect(200)
    ).body;
    expect(on).toMatchObject({ online: true, name: 'Gleam', voice: true, portrait: true });
    const portrait = await http.get('/assistant/portrait').expect(200);
    expect(portrait.headers['content-type']).toContain('image/png');

    // the computer waits for a question; a visitor asks; the computer gets it at once and answers
    // (supertest sends a request only when it is awaited: .then() sends these now, the computer's first)
    const waiting = mac.claim(5).then((r) => r);
    await new Promise((r) => setTimeout(r, 50));
    const asked = http
      .post('/assistant/ask')
      .send({
        question: 'Is the chibi figure in stock?',
        history: [{ question: 'hi', answer: 'Hello!' }],
      })
      .then((r) => r);
    const q = (await waiting).body.question;
    expect(q).toMatchObject({
      question: 'Is the chibi figure in stock?',
      history: [{ question: 'hi', answer: 'Hello!' }],
    });
    await mac
      .answer(q.id, {
        answer: 'Yes! Only two left, $64.',
        products: [{ id: 'CHB1', name: 'Chibi Figure', price: '$64', status: 'low' }],
        audio: wav(),
      })
      .expect(200);
    const reply = (await asked).body;
    expect(reply).toMatchObject({
      by: 'assistant',
      answer: 'Yes! Only two left, $64.',
      products: [{ id: 'CHB1' }],
    });
    const audio = await http.get(reply.audio).expect(200);
    expect(audio.headers['content-type']).toContain('audio/wav');
    expect(
      Buffer.from(audio.body as Buffer)
        .subarray(0, 4)
        .toString('latin1'),
    ).toBe('RIFF');

    // an answer can only be given once
    expect((await mac.answer(q.id, { answer: 'again' })).status).toBe(409);
    // a waiting computer with nothing to answer gets no question
    expect((await mac.claim(1).expect(200)).body.question).toBeNull();
    // turned off: the shop answers again
    await mac.profile({ on: false, name: 'Gleam', voice: true }).expect(200);
    expect(
      (await http.post('/assistant/ask').send({ question: 'chibi figure' }).expect(200)).body.by,
    ).toBe('shop');
  });

  it("only a paired computer can take visitors' questions, with a real portrait and voice", async () => {
    expect((await http.post('/gleamshelf/assistant/claim').send({ wait: 1 })).status).toBe(401);
    expect(
      (
        await http
          .post('/gleamshelf/assistant/profile')
          .set({ Authorization: 'Bearer nope' })
          .send({ on: true, name: 'x', voice: false })
      ).status,
    ).toBe(401);
    const mac = await computer('Other Mac');
    expect(
      (
        await mac.profile({
          on: true,
          name: 'Gleam',
          voice: false,
          portrait: Buffer.from('not a picture').toString('base64'),
        })
      ).status,
    ).toBe(400);
    expect(
      (await mac.answer('00000000-0000-4000-8000-000000000000', { answer: 'hi' })).status,
    ).toBe(409);
    expect((await http.get('/assistant/audio/00000000-0000-4000-8000-000000000000')).status).toBe(
      404,
    );
  });
});
