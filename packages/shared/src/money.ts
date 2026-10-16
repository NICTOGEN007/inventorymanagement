/**
 * All money is stored and calculated as integer paise (1 rupee = 100 paise)
 * so that floating-point rounding never creeps into totals.
 */
export type Paise = number;

export function rupeesToPaise(rupees: number): Paise {
  if (!Number.isFinite(rupees)) throw new RangeError(`Invalid rupee amount: ${rupees}`);
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: Paise): number {
  return paise / 100;
}

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formats paise in the Indian numbering system, e.g. 12345600 -> "₹1,23,456.00". */
export function formatINR(paise: Paise): string {
  return inrFormatter.format(paiseToRupees(paise));
}

const inrWholeFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const oneDecimal = (value: number) => (Math.round(value * 10) / 10).toLocaleString('en-IN');

/**
 * Short form for headline figures in the Indian system: ₹69,100, ₹23.5L (lakh), ₹9.9Cr (crore).
 * Built by hand because browsers disagree on compact notation (Chromium writes ₹69.1T for
 * thousands in en-IN, Node writes ₹69.1K).
 */
export function formatINRCompact(paise: Paise): string {
  const rupees = paiseToRupees(paise);
  const sign = rupees < 0 ? '-' : '';
  const abs = Math.abs(rupees);
  if (abs >= 1e7) return `${sign}₹${oneDecimal(abs / 1e7)}Cr`;
  if (abs >= 1e5) return `${sign}₹${oneDecimal(abs / 1e5)}L`;
  return inrWholeFormatter.format(rupees);
}
