import { describe, expect, it } from 'vitest';
import {
  catchUpPlan,
  describeSchedule,
  isValidTimeZone,
  localDateIn,
  nextRunDate,
  occurrence,
  occurrenceAfter,
  occurrenceOnOrAfter,
  occurrenceOnOrBefore,
  upcomingRunDates,
  type RecurringFrequency,
} from './recurring';

const cadence = (frequency: RecurringFrequency, startDate: string, extra: { endDate?: string | null; maxOccurrences?: number | null } = {}) => ({
  frequency,
  startDate,
  endDate: extra.endDate ?? null,
  maxOccurrences: extra.maxOccurrences ?? null,
});

describe('run dates', () => {
  it('monthly on the 31st falls back to the last day of shorter months and returns to the 31st', () => {
    expect(upcomingRunDates(cadence('monthly', '2026-01-31'), '2026-01-01', 7)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
    ]);
    // Leap year February.
    expect(occurrence('2028-01-31', 'monthly', 1)).toBe('2028-02-29');
    expect(occurrence('2026-01-30', 'monthly', 1)).toBe('2026-02-28');
    expect(occurrence('2026-01-29', 'monthly', 2)).toBe('2026-03-29');
  });

  it('monthly on the 1st rolls over the year end', () => {
    expect(upcomingRunDates(cadence('monthly', '2026-11-01'), '2026-11-17', 4)).toEqual(['2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01']);
  });

  it('quarterly and yearly keep the anchor (leap day → 28 Feb in other years)', () => {
    expect(upcomingRunDates(cadence('quarterly', '2026-11-30'), '2026-11-01', 5)).toEqual(['2026-11-30', '2027-02-28', '2027-05-30', '2027-08-30', '2027-11-30']);
    expect(upcomingRunDates(cadence('yearly', '2028-02-29'), '2028-01-01', 5)).toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
    expect(upcomingRunDates(cadence('yearly', '2026-12-31'), '2026-12-31', 2)).toEqual(['2026-12-31', '2027-12-31']);
  });

  it('weekly and two-weekly keep the weekday across months, years and leap days', () => {
    // 2028-02-24 is a Thursday.
    expect(upcomingRunDates(cadence('weekly', '2028-02-24'), '2028-02-24', 3)).toEqual(['2028-02-24', '2028-03-02', '2028-03-09']);
    expect(upcomingRunDates(cadence('biweekly', '2026-12-21'), '2026-12-22', 3)).toEqual(['2027-01-04', '2027-01-18', '2027-02-01']);
    expect(new Date('2027-01-04T00:00:00Z').getUTCDay()).toBe(1);
  });

  it('finds the first run on/after, strictly after and on/before a date', () => {
    expect(occurrenceOnOrAfter('2026-01-31', 'monthly', '2026-02-28')).toBe('2026-02-28');
    expect(occurrenceOnOrAfter('2026-01-31', 'monthly', '2026-03-01')).toBe('2026-03-31');
    expect(occurrenceAfter('2026-01-31', 'monthly', '2026-02-28')).toBe('2026-03-31');
    expect(occurrenceOnOrBefore('2026-01-31', 'monthly', '2026-03-30')).toBe('2026-02-28');
    expect(occurrenceOnOrBefore('2026-01-31', 'monthly', '2026-01-30')).toBeNull();
    expect(occurrenceOnOrBefore('2026-12-07', 'weekly', '2026-12-20')).toBe('2026-12-14');
    expect(occurrenceOnOrAfter('2026-12-07', 'weekly', '2026-11-01')).toBe('2026-12-07');
  });

  it('respects the end date and the occurrence limit', () => {
    const c = cadence('monthly', '2026-12-01', { endDate: '2027-02-15' });
    expect(upcomingRunDates(c, '2026-12-01', 10)).toEqual(['2026-12-01', '2027-01-01', '2027-02-01']);
    expect(nextRunDate(c, { onOrAfter: '2027-02-02' })).toBeNull();
    const limited = cadence('weekly', '2026-12-07', { maxOccurrences: 3 });
    expect(upcomingRunDates(limited, '2026-12-01', 10, 1)).toEqual(['2026-12-07', '2026-12-14']);
    expect(nextRunDate(limited, { onOrAfter: '2026-12-08', lastRunDate: '2026-12-21', runCount: 3 })).toBeNull();
    expect(nextRunDate(limited, { onOrAfter: '2026-12-01', lastRunDate: '2026-12-07', runCount: 1 })).toBe('2026-12-14');
  });

  it('catch-up plan: generate only the most recent missed period, skip and count the older ones', () => {
    const c = cadence('monthly', '2026-01-01');
    expect(catchUpPlan(c, '2026-06-01', '2026-05-31')).toBeNull();
    expect(catchUpPlan(c, '2026-06-01', '2026-06-01')).toEqual({ period: '2026-06-01', skipped: [], skippedCount: 0 });
    expect(catchUpPlan(c, '2026-03-01', '2026-06-20')).toEqual({ period: '2026-06-01', skipped: ['2026-03-01', '2026-04-01', '2026-05-01'], skippedCount: 3 });
    // The end date caps the catch-up.
    expect(catchUpPlan(cadence('monthly', '2026-01-01', { endDate: '2026-04-15' }), '2026-03-01', '2026-06-20')).toEqual({
      period: '2026-04-01',
      skipped: ['2026-03-01'],
      skippedCount: 1,
    });
    // Weekly over a long pause: listed up to the cap, counted in full.
    const plan = catchUpPlan(cadence('weekly', '2020-01-06'), '2020-01-06', '2026-11-17', 5)!;
    expect(plan.skipped).toHaveLength(5);
    expect(plan.skippedCount).toBe(358);
    expect(plan.period).toBe('2026-11-16');
  });
});

describe('time zones and DST', () => {
  it('computes the local calendar date of an instant', () => {
    const instant = new Date('2026-11-30T23:30:00Z');
    expect(localDateIn(instant, 'UTC')).toBe('2026-11-30');
    expect(localDateIn(instant, 'Europe/Berlin')).toBe('2026-12-01');
    expect(localDateIn(instant, 'America/Los_Angeles')).toBe('2026-11-30');
    expect(localDateIn(instant, 'Asia/Kolkata')).toBe('2026-12-01');
    expect(localDateIn(new Date('2026-12-01T09:59:00Z'), 'Pacific/Honolulu')).toBe('2026-11-30');
    expect(localDateIn(new Date('2026-11-30T10:00:00Z'), 'Pacific/Kiritimati')).toBe('2026-12-01');
  });

  for (const [tz, forward, back] of [
    ['Europe/Berlin', '2027-03-28', '2027-10-31'],
    ['America/New_York', '2027-03-14', '2027-11-07'],
  ] as const) {
    it(`${tz}: every calendar date appears exactly once when stepping hourly across DST changes`, () => {
      for (const day of [forward, back]) {
        const seen = new Map<string, number>();
        const start = Date.parse(`${day}T00:00:00Z`) - 36 * 3_600_000;
        for (let t = start; t < start + 72 * 3_600_000; t += 3_600_000) {
          const d = localDateIn(t, tz);
          seen.set(d, (seen.get(d) ?? 0) + 1);
        }
        // The DST day has 23 (spring) or 25 (autumn) local hours but is still one date.
        const hours = seen.get(day)!;
        expect(hours === 23 || hours === 25).toBe(true);
        expect([...seen.keys()]).toEqual([...new Set(seen.keys())].sort());
      }
    });
  }

  it('validates IANA names', () => {
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('plain-language summary', () => {
  it('describes cadences, month ends and end conditions', () => {
    expect(describeSchedule(cadence('monthly', '2026-12-01'), { nextRunDate: '2026-12-01' })).toBe('Every month on the 1st, starting 1 Dec 2026 — next: 1 Dec 2026');
    expect(describeSchedule(cadence('monthly', '2026-01-31'))).toBe('Every month on the 31st (the last day in shorter months), starting 31 Jan 2026');
    expect(describeSchedule(cadence('weekly', '2026-12-07', { maxOccurrences: 4 }))).toBe('Every week on Monday, starting 7 Dec 2026, 4 times');
    expect(describeSchedule(cadence('biweekly', '2026-12-11', { endDate: '2027-06-30' }))).toBe('Every 2 weeks on Friday, starting 11 Dec 2026, until 30 Jun 2027');
    expect(describeSchedule(cadence('quarterly', '2026-11-15'))).toBe('Every 3 months on the 15th (Feb, May, Aug, Nov), starting 15 Nov 2026');
    expect(describeSchedule(cadence('yearly', '2028-02-29'))).toBe('Every year on 29 February (28 February in other years), starting 29 Feb 2028');
    expect(describeSchedule(cadence('monthly', '2026-12-22'), { status: 'ended', nextRunDate: null })).toBe('Every month on the 22nd, starting 22 Dec 2026 — ended');
  });
});
