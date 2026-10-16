/**
 * GTIN (EAN-8, UPC-A, EAN-13, GTIN-14) check digit: weights 3 and 1 alternate from the right,
 * starting with 3 next to the check digit.
 */
export function gtinCheckDigit(withoutCheck: string): number {
  let sum = 0;
  for (let i = 0; i < withoutCheck.length; i++) {
    const digit = Number(withoutCheck[withoutCheck.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/** True for an 8, 12, 13 or 14 digit barcode whose last digit is the correct check digit. */
export function isValidGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false;
  return gtinCheckDigit(code.slice(0, -1)) === Number(code.at(-1));
}
