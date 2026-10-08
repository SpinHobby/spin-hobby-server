import { afterAll, describe, expect, it } from 'vitest';
import { mockFetch } from '../support/harness.js';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, owner, staff } = shop;

describe('cashier + ops', () => {
  it('requires staff and a photo', async () => {
    await http.post('/cashier/identify').expect(401);
    await http
      .post('/cashier/identify')
      .set('Authorization', staff.auth)
      .expect(400, { success: false, error: 'photo is required' });
    await http
      .post('/cashier/record')
      .set('Authorization', staff.auth)
      .field('title', 'Thing')
      .field('price', '-1')
      .expect(400, { success: false, error: 'price must be a positive number' });
  });

  it('enforces the monthly AI budget before calling Claude', async () => {
    await http
      .put('/ops/ai-usage/anthropic_cashier')
      .set('Authorization', owner.auth)
      .send({ warnThresholdUsd: 0, stopThresholdUsd: 0 })
      .expect(200);
    const res = await http
      .post('/cashier/identify')
      .set('Authorization', staff.auth)
      .attach('photo', Buffer.from([0xff, 0xd8, 0xff]), {
        filename: 'a.jpg',
        contentType: 'image/jpeg',
      })
      .expect(429);
    expect(res.body.error).toMatch(/AI budget of \$0 reached/);
    const usage = await http.get('/ops/ai-usage').set('Authorization', owner.auth).expect(200);
    expect(usage.body.tools[0]).toMatchObject({ tool: 'anthropic_cashier', status: 'blocked' });
    await http.get('/ops/ai-usage').set('Authorization', staff.auth).expect(403);
  });

  it('identifies a photo with Claude using structured output and records the cost', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    await http
      .put('/ops/ai-usage/anthropic_cashier')
      .set('Authorization', owner.auth)
      .send({ warnThresholdUsd: 20, stopThresholdUsd: 30 })
      .expect(200);
    const claude = mockFetch({
      'api.anthropic.com/v1/messages': () => ({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5',
        stop_reason: 'end_turn',
        stop_sequence: null,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              title: 'Rem Figure',
              description: 'Scale figure of Rem.',
              category: 'Bishoujo Figures',
              artworkCrop: { x: -1, y: 0.2, width: 5, height: 0.5, rotationDegrees: 90 },
            }),
          },
        ],
        usage: { input_tokens: 1000, output_tokens: 200 },
      }),
    });
    try {
      const res = await http
        .post('/cashier/identify')
        .set('Authorization', staff.auth)
        .field('condition', 'sealed')
        .attach('photo', Buffer.from([0xff, 0xd8, 0xff]), {
          filename: 'a.jpg',
          contentType: 'image/jpeg',
        })
        .expect(200);
      expect(res.body).toEqual({
        success: true,
        title: 'Rem Figure',
        description: 'Scale figure of Rem.',
        category: 'Bishoujo Figures',
        artworkCrop: { x: 0, y: 0.2, width: 1, height: 0.5, rotationDegrees: 45 },
        // What this suggestion cost, shown to the admin: 1000 in + 200 out tokens at Opus 5 prices.
        usage: {
          inputTokens: 1000,
          outputTokens: 200,
          costUsd: (1000 * 5 + 200 * 25) / 1_000_000,
          monthSpendUsd: (1000 * 5 + 200 * 25) / 1_000_000,
          monthStopUsd: 30,
        },
      });
      const sent = claude.calls[0].body;
      expect(sent).toMatchObject({
        model: 'claude-opus-5',
        max_tokens: 4096,
        fallbacks: 'default',
        output_config: { effort: 'low', format: { type: 'json_schema' } },
      });
      expect(sent.messages[0].content[0]).toMatchObject({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg' },
      });
      expect(sent.messages[0].content[1].text).toContain('SEALED');
      await new Promise((r) => setTimeout(r, 20)); // usage is recorded without blocking the response
      const usage = (await http.get('/ops/ai-usage').set('Authorization', owner.auth)).body
        .tools[0];
      expect(usage.spendUsd).toBeCloseTo((1000 * 5 + 200 * 25) / 1_000_000, 6);
    } finally {
      claude.restore();
    }
  });
});
