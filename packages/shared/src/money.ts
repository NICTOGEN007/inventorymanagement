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
