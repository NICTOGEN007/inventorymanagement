const relative = new Intl.RelativeTimeFormat('en-IN', { numeric: 'auto' });
const dateTime = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "5 minutes ago", "yesterday", "3 weeks ago". */
export function formatRelative(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

/** Full date and time in IST, e.g. "16 Oct 2026, 3:30 pm". */
export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

/** Paise as an editable rupee string: 61700 -> "617", 61750 -> "617.50". */
export function paiseToInput(paise: number | undefined): string {
  if (paise === undefined) return '';
  return (paise / 100).toFixed(2).replace(/\.00$/, '');
}

/** Quantity with its unit, e.g. "12 pcs", "2.5 kg". */
export function formatQuantity(quantity: number, unit: string): string {
  return `${Number(quantity.toFixed(3)).toLocaleString('en-IN')} ${unit}`;
}

/** Signed change with a real minus sign: "+5 pcs", "−2.5 kg". */
export function formatChange(quantity: number, unit: string): string {
  const sign = quantity > 0 ? '+' : quantity < 0 ? '−' : '';
  return `${sign}${formatQuantity(Math.abs(quantity), unit)}`;
}

const dateOnly = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeZone: 'Asia/Kolkata',
});

/** Calendar date in IST, e.g. "16 Oct 2026". */
export function formatDate(iso: string): string {
  return dateOnly.format(new Date(iso));
}

/** Today's date in IST as YYYY-MM-DD, `days` from now (for date inputs). */
export function istDateInput(days = 0): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
    new Date(Date.now() + days * 86_400_000),
  );
  return parts;
}

/** The IST date `days` from now, formatted like "19 Oct 2026". */
export function formatDateFromNow(days: number): string {
  return formatDate(new Date(Date.now() + days * 86_400_000).toISOString());
}

const trimNumber = (n: number) => String(Math.round(n * 10) / 10);

/** Short rupee labels for chart axes: ₹500, ₹45K, ₹1.2L, ₹3Cr. */
export function formatAxisINR(paise: number): string {
  const rupees = paise / 100;
  if (rupees >= 1e7) return `₹${trimNumber(rupees / 1e7)}Cr`;
  if (rupees >= 1e5) return `₹${trimNumber(rupees / 1e5)}L`;
  if (rupees >= 1e3) return `₹${trimNumber(rupees / 1e3)}K`;
  return `₹${trimNumber(rupees)}`;
}

const dayTitle = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const dayShort = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

const dayMedium = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** A business date key ("2026-10-16") as "Fri, 16 Oct 2026", "16 Oct 2026" or "16 Oct". */
export function formatDateKey(
  dateKey: string,
  style: 'long' | 'medium' | 'short' = 'long',
): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  return { long: dayTitle, medium: dayMedium, short: dayShort }[style].format(date);
}
