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
