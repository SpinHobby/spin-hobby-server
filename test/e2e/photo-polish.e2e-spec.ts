import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { mockFetch } from '../support/harness.js';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, staff, shopper } = shop;
const as = { Authorization: staff.auth };

/** A purple box with a cream "price sticker" on a green backdrop, as a JPEG like a phone photo. */
const photo = async () => {
  const box = await sharp({
    create: { width: 300, height: 260, channels: 3, background: { r: 150, g: 80, b: 170 } },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 60, height: 24, channels: 3, background: '#f4efe2' },
        })
          .png()
          .toBuffer(),
        left: 200,
        top: 30,
      },
    ])
    .png()
    .toBuffer();
  return sharp({
    create: { width: 600, height: 400, channels: 3, background: { r: 20, g: 130, b: 40 } },
  })
    .composite([{ input: box, left: 150, top: 70 }])
    .jpeg({ quality: 95 })
    .toBuffer();
};
const sticker = { x: 350 / 600, y: 100 / 400, width: 60 / 600, height: 24 / 400 };
const send = async (fields: Record<string, string>) => {
  let req = http
    .post('/cashier/polish')
    .set(as)
    .attach('photo', await photo(), { filename: 'box.jpg', contentType: 'image/jpeg' });
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req.buffer(true).parse((res, done) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => done(null, Buffer.concat(chunks)));
  });
};
const info = (res: { headers: Record<string, string> }) =>
  JSON.parse(res.headers['x-polish']) as Record<string, unknown>;

// The AI client keeps the fetch it was created with, so one stand-in serves the whole file and each test sets its answer.
let answer: { body: unknown; usage: { input_tokens: number; output_tokens: number } } = {
  body: { stickers: [] },
  usage: { input_tokens: 1400, output_tokens: 60 },
};
const claude = mockFetch({
  'api.anthropic.com/v1/messages': () => ({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    stop_reason: 'end_turn',
    stop_sequence: null,
    content: [{ type: 'text', text: JSON.stringify(answer.body) }],
    usage: answer.usage,
  }),
});
afterAll(claude.restore);
const reply = (body: unknown, input = 1400, output = 60) => {
  answer = { body, usage: { input_tokens: input, output_tokens: output } };
  claude.calls.length = 0;
};

describe('polish a photo', () => {
  it('removes the green backdrop for free, with no AI call, and returns a transparent PNG', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    reply({ stickers: [] });
    try {
      const res = await send({ removeBackground: 'true' });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/png');
      expect(info(res)).toMatchObject({ backgroundRemoved: true, stickersFilled: 0 });
      const meta = await sharp(res.body as Buffer).metadata();
      expect(meta.hasAlpha).toBe(true);
      expect(claude.calls).toHaveLength(0); // nothing that costs money was asked for
    } finally {
      /* nothing to undo */
    }
  });

  it('paints over stickers whose boxes are sent, without calling the AI', async () => {
    reply({ stickers: [] });
    try {
      const res = await send({ removeStickers: 'true', stickers: JSON.stringify([sticker]) });
      expect(info(res)).toMatchObject({ stickersFilled: 1, backgroundRemoved: false });
      expect(claude.calls).toHaveLength(0);
    } finally {
      /* nothing to undo */
    }
  });

  it('asks the AI to find stickers only when removal is requested without boxes, and reports the cost', async () => {
    reply({ stickers: [sticker] });
    try {
      const res = await send({ removeStickers: 'true' });
      expect(res.status).toBe(200);
      const body = info(res) as {
        stickersFilled: number;
        usage: { costUsd: number; inputTokens: number };
      };
      expect(body.stickersFilled).toBe(1);
      expect(body.usage.inputTokens).toBe(1400);
      expect(body.usage.costUsd).toBeCloseTo((1400 * 5 + 60 * 25) / 1_000_000, 6);
      expect(claude.calls).toHaveLength(1);
    } finally {
      /* nothing to undo */
    }
  });

  it('can do the title step and the sticker search in a single request', async () => {
    reply(
      {
        title: 'Rem Figure',
        description: 'A figure.',
        category: 'Bishoujo Figures',
        stickers: [sticker],
      },
      2000,
      150,
    );
    try {
      const res = await http
        .post('/cashier/identify')
        .set(as)
        .field('condition', 'sealed')
        .field('findStickers', 'true')
        .attach('photo', await photo(), { filename: 'box.jpg', contentType: 'image/jpeg' })
        .expect(200);
      expect(res.body.title).toBe('Rem Figure');
      expect(res.body.stickers).toHaveLength(1);
      expect(claude.calls).toHaveLength(1); // one request for both
      const sent = claude.calls[0].body as {
        output_config: { format: { schema: { properties: Record<string, unknown> } } };
      };
      expect(Object.keys(sent.output_config.format.schema.properties)).toContain('stickers');
    } finally {
      /* nothing to undo */
    }
  });

  it('checks who is asking and what was sent', async () => {
    await http.post('/cashier/polish').expect(401);
    await http.post('/cashier/polish').set({ Authorization: shopper.auth }).expect(403);
    await http.post('/cashier/polish').set(as).expect(400);
    const bad = await send({ removeStickers: 'true', stickers: 'not json' }); // unreadable boxes mean none, and no AI call
    expect(bad.status).toBe(200);
  });
});
