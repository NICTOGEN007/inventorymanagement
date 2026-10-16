import { describe, expect, it } from 'vitest';
import {
  addDays,
  gstSetOff,
  bucketLabel,
  bucketOf,
  daysInPeriod,
  daysOf,
  marginPercent,
  percentChange,
  presetPeriod,
  previousPeriod,
} from '../src/reports.js';
import { reportQuerySchema } from '../src/schemas/reports.js';

describe('report periods', () => {
  it('counts days inclusively and steps across months and leap years', () => {
    expect(daysInPeriod('2026-10-01', '2026-10-16')).toBe(16);
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysOf('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
  });

  it('compares with the period of the same length just before', () => {
    expect(previousPeriod('2026-10-01', '2026-10-16')).toEqual({
      from: '2026-09-15',
      to: '2026-09-30',
    });
    expect(previousPeriod('2026-10-16', '2026-10-16')).toEqual({
      from: '2026-10-15',
      to: '2026-10-15',
    });
  });

  it('groups days into Monday weeks and months', () => {
    // 16 Oct 2026 is a Friday; its week starts on Monday 12 Oct.
    expect(bucketOf('2026-10-16', 'week')).toBe('2026-10-12');
    expect(bucketOf('2026-10-12', 'week')).toBe('2026-10-12');
    expect(bucketOf('2026-10-18', 'week')).toBe('2026-10-12');
    expect(bucketOf('2026-10-16', 'month')).toBe('2026-10');
    expect(bucketLabel('2026-10-12', 'week')).toBe('Week of 12 Oct');
    expect(bucketLabel('2026-10', 'month')).toBe('Oct 2026');
    expect(bucketLabel('2026-10-16', 'day')).toBe('16 Oct');
  });

  it('works out preset periods in IST', () => {
    // 20:00 UTC on 31 Oct is already 1 Nov in India.
    const now = new Date('2026-10-31T20:00:00Z');
    expect(presetPeriod('today', now)).toEqual({ from: '2026-11-01', to: '2026-11-01' });
    expect(presetPeriod('lastMonth', now)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetPeriod('last7', now).from).toBe('2026-10-26');
    expect(presetPeriod('thisFy', now).from).toBe('2026-04-01');
    expect(presetPeriod('thisFy', new Date('2027-02-10T06:00:00Z')).from).toBe('2026-04-01');
  });

  it('gives percentages without dividing by zero', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(90, 120)).toBe(-25);
    expect(percentChange(10, 0)).toBeNull();
    expect(marginPercent(2500, 10000)).toBe(25);
    expect(marginPercent(0, 0)).toBeNull();
  });

  it('validates report queries', () => {
    const q = reportQuerySchema.parse({ from: '2026-10-01', to: '2026-10-16' });
    expect(q).toMatchObject({ groupBy: 'day', format: 'json', sort: 'sales', stock: 'all' });
    const issues = (input: object) =>
      reportQuerySchema.safeParse(input).error?.issues.map((i) => i.message) ?? [];
    expect(issues({ from: '2026-10-16', to: '2026-10-01' })).toContain(
      'The start date must be before the end date',
    );
    expect(issues({ from: '2020-01-01', to: '2026-10-01' })).toContain('Choose at most 1100 days');
    expect(issues({ from: '2026-02-31' })).toContain('Not a real date');
    expect(issues({ format: 'xlsx' })).toHaveLength(1);
  });
});

describe('GST set-off', () => {
  it('uses IGST credit against CGST and SGST once IGST is paid', () => {
    const result = gstSetOff(
      { cgst: 10000, sgst: 10000, igst: 2000 },
      { cgst: 6000, sgst: 6000, igst: 7000 },
    );
    // IGST credit: 2000 against IGST, the other 5000 split 2500/2500 against CGST and SGST.
    expect(result.payable).toEqual({ cgst: 1500, sgst: 1500, igst: 0 });
    expect(result.carriedForward).toEqual({ cgst: 0, sgst: 0, igst: 0 });
  });

  it('never moves CGST credit to SGST, and carries unused credit forward', () => {
    const result = gstSetOff(
      { cgst: 1000, sgst: 5000, igst: 500 },
      { cgst: 4000, sgst: 0, igst: 0 },
    );
    // CGST credit pays CGST, then IGST; SGST is still due in cash.
    expect(result.payable).toEqual({ cgst: 0, sgst: 5000, igst: 0 });
    expect(result.carriedForward).toEqual({ cgst: 2500, sgst: 0, igst: 0 });
  });
});
