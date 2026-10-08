import { afterEach, describe, expect, it } from 'vitest';
import { IdentifyService, matchSeries, sanitizeArtworkCrop } from './identify.service.js';

describe('sanitizeArtworkCrop', () => {
  it('drops junk and clamps boxes into the photo', () => {
    expect(sanitizeArtworkCrop(null)).toBeUndefined();
    expect(sanitizeArtworkCrop({ x: 'a', y: 0, width: 1, height: 1 })).toBeUndefined();
    expect(
      sanitizeArtworkCrop({ x: 0.9, y: 0.9, width: 1, height: 1, rotationDegrees: -90 }),
    ).toEqual({
      x: 0.9,
      y: 0.9,
      width: expect.closeTo(0.1, 6),
      height: expect.closeTo(0.1, 6),
      rotationDegrees: -45,
    });
  });
});

describe('matchSeries', () => {
  const known = ['Re:Zero', 'Sousou no Frieren'];
  it('uses the spelling already in the list, whatever the AI wrote', () => {
    expect(matchSeries('Re Zero', known)).toEqual({ series: 'Re:Zero', seriesIsNew: false });
    expect(matchSeries(' re:zero ', known)).toEqual({ series: 'Re:Zero', seriesIsNew: false });
  });
  it('flags a series that is not in the list yet, and returns nothing when there is none', () => {
    expect(matchSeries('Dandadan', known)).toEqual({ series: 'Dandadan', seriesIsNew: true });
    expect(matchSeries('', known)).toEqual({});
    expect(matchSeries(undefined, known)).toEqual({});
  });
});

describe('IdentifyService.identify', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('reports the tokens, the cost and the month so far with each suggestion', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const recorded: unknown[][] = [];
    const usage = {
      status: async () => ({ status: 'ok', spendUsd: 1.5, stopThresholdUsd: 30 }),
      estimateCost: (_model: string, input: number, output: number) =>
        (input * 5 + output * 25) / 1_000_000,
      record: async (...args: unknown[]) => void recorded.push(args),
    };
    const db = { many: async () => [{ name: 'Re:Zero' }] };
    const service = new IdentifyService(usage as never, db as never);
    (service as unknown as { client: unknown }).client = {
      beta: {
        messages: {
          create: async () => ({
            stop_reason: 'end_turn',
            usage: { input_tokens: 2000, output_tokens: 800 },
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  title: 'Rem Figure',
                  description: 'A figure of Rem.',
                  category: 'Figures',
                  barcode: '4901234567894',
                }),
              },
            ],
          }),
        },
      },
    };
    const result = await service.identify(
      { buffer: Buffer.from('x'), mimetype: 'image/png' },
      false,
    );
    expect(result).toMatchObject({ title: 'Rem Figure', barcode: '4901234567894' });
    expect(result.usage).toEqual({
      inputTokens: 2000,
      outputTokens: 800,
      costUsd: 0.03,
      monthSpendUsd: 1.53,
      monthStopUsd: 30,
    });
    expect(recorded).toHaveLength(1);
  });
});
