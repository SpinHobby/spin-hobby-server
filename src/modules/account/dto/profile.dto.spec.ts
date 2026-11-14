import { describe, expect, it } from 'vitest';
import { phoneValue } from './profile.dto.js';

describe('phone numbers on the profile', () => {
  it('keeps what people type, and clears on empty', () => {
    expect(phoneValue('416 555 0123')).toBe('416 555 0123');
    expect(phoneValue(' +1 (416)  555-0123 ')).toBe('+1 (416) 555-0123');
    expect(phoneValue('')).toBeNull();
    expect(phoneValue(null)).toBeNull();
  });

  it('refuses letters and numbers too short or too long', () => {
    expect(() => phoneValue('call me')).toThrow(/phone number/);
    expect(() => phoneValue('12345')).toThrow(/phone number/);
    expect(() => phoneValue('1'.repeat(16))).toThrow(/phone number/);
  });
});
