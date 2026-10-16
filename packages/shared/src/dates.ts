/** The shop operates on Indian Standard Time; business dates are always computed in IST. */
export const BUSINESS_TIME_ZONE = 'Asia/Kolkata';

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export interface DateParts {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
}

export function istDateParts(date: Date): DateParts {
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

/** Calendar day in IST as "YYYY-MM-DD"; used to group sales by day. */
export function istDateKey(date: Date): string {
  const { year, month, day } = istDateParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Indian financial year (1 April – 31 March) in short form, e.g. "26-27" for 16 Oct 2026.
 */
export function financialYear(date: Date): string {
  const { year, month } = istDateParts(date);
  const start = month >= 4 ? year : year - 1;
  return `${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** GST rules cap invoice numbers at 16 characters, unique within a financial year. */
export const MAX_DOCUMENT_NUMBER_LENGTH = 16;

/** Builds a document number such as "INV/26-27/00042". */
export function formatDocumentNumber(prefix: string, date: Date, sequence: number): string {
  if (!/^[A-Z]{1,4}$/.test(prefix)) {
    throw new RangeError(`Prefix must be 1-4 capital letters: ${prefix}`);
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError(`Sequence must be a positive integer: ${sequence}`);
  }
  const value = `${prefix}/${financialYear(date)}/${String(sequence).padStart(5, '0')}`;
  if (value.length > MAX_DOCUMENT_NUMBER_LENGTH) {
    throw new RangeError(`Document number exceeds ${MAX_DOCUMENT_NUMBER_LENGTH} characters`);
  }
  return value;
}

const IST_OFFSET_MS = 330 * 60_000;

/** The UTC instants where an IST calendar day ("YYYY-MM-DD") starts and the next one starts. */
export function istDayRange(dateKey: string): { start: Date; end: Date } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new RangeError(`Expected a date like 2026-10-16: ${dateKey}`);
  const startMs =
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - IST_OFFSET_MS;
  return { start: new Date(startMs), end: new Date(startMs + 86_400_000) };
}
