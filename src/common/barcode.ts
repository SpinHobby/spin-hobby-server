/**
 * Product barcodes (UPC-A 12 digits, EAN-8, EAN-13/JAN, ITF-14/GTIN-14). The last digit is a check digit, so a
 * code that was misread by a camera or mistyped almost never passes.
 */
const LENGTHS = new Set([8, 12, 13, 14]);

/** The GS1 check digit for the digits before it. */
function checkDigit(body: string): number {
  let sum = 0;
  // Weights alternate 3, 1, 3, 1 ... starting from the digit next to the check digit.
  for (let i = body.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3)
    sum += Number(body[i]) * weight;
  return (10 - (sum % 10)) % 10;
}

/** The barcode as digits only, or null when it is not a well-formed barcode with a correct check digit. */
export function cleanBarcode(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const digits = String(raw).replace(/[\s-]/g, '');
  if (!/^\d+$/.test(digits) || !LENGTHS.has(digits.length)) return null;
  return checkDigit(digits.slice(0, -1)) === Number(digits.at(-1)) ? digits : null;
}
