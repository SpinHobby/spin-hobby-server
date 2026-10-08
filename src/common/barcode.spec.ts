import { describe, expect, it } from 'vitest';
import { cleanBarcode } from './barcode.js';

describe('cleanBarcode', () => {
  it('accepts real EAN-13 / JAN, UPC-A, EAN-8 and GTIN-14 codes', () => {
    expect(cleanBarcode('4901234567894')).toBe('4901234567894'); // JAN
    expect(cleanBarcode('9780306406157')).toBe('9780306406157'); // ISBN-13
    expect(cleanBarcode('036000291452')).toBe('036000291452'); // UPC-A
    expect(cleanBarcode('96385074')).toBe('96385074'); // EAN-8
    expect(cleanBarcode('10012345678902')).toBe('10012345678902'); // GTIN-14
  });

  it('tolerates spaces and dashes and numbers', () => {
    expect(cleanBarcode(' 4901 2345-67894 ')).toBe('4901234567894');
    expect(cleanBarcode(4901234567894)).toBe('4901234567894');
  });

  it('rejects a wrong check digit (a misread), a wrong length and anything that is not digits', () => {
    expect(cleanBarcode('4901234567895')).toBeNull();
    expect(cleanBarcode('490123456789')).toBeNull();
    expect(cleanBarcode('49012345678945')).toBeNull();
    expect(cleanBarcode('49O1234567894')).toBeNull();
    expect(cleanBarcode('')).toBeNull();
    expect(cleanBarcode(null)).toBeNull();
  });
});
