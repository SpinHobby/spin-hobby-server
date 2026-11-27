import { describe, expect, it } from 'vitest';
import { parseDraft } from './draft.js';

const base = { sourceKey: 'abcdefgh1234', title: 'Rem Figure' };

describe('parseDraft cleanFrom', () => {
  it('keeps where the clean photo came from', () => {
    expect(parseDraft({ ...base, cleanFrom: 'maker' }).details.cleanFrom).toBe('maker');
    expect(parseDraft({ ...base, cleanFrom: 'shop' }).details.cleanFrom).toBe('shop');
    expect(parseDraft({ ...base, cleanFrom: 'redraw' }).details.cleanFrom).toBe('redraw');
  });

  it('drops anything else, so an unknown source is shown as a redraw', () => {
    expect(parseDraft(base).details.cleanFrom).toBeNull();
    expect(parseDraft({ ...base, cleanFrom: 'real' }).details.cleanFrom).toBeNull();
    expect(parseDraft({ ...base, cleanFrom: 1 }).details.cleanFrom).toBeNull();
  });
});
