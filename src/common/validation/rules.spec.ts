import { describe, expect, it } from 'vitest';
import { likePattern, positiveInteger, stringValue } from './rules.js';

describe('validation helpers', () => {
  it('escapes LIKE wildcards', () => {
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });
  it('keeps the established messages', () => {
    expect(() => stringValue('  ', 'title')).toThrow('title is required.');
    expect(() => positiveInteger(100, 'quantity')).toThrow('quantity must be between 1 and 99.');
    expect(positiveInteger('3', 'quantity')).toBe(3);
  });
});
