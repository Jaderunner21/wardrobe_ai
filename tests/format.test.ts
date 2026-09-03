/**
 * Date formatting and preference parsing — module 16 §4, §6.6.
 *
 * §6.6 records a real bug in the prototype: "Member Since 8/28/2025" in an app
 * reporting 2026. That is what an ambiguous format buys you — a wrong date that looks
 * like a right one, in a place nobody double-checks. The tests below are mostly about
 * the two ways a date can silently shift: the day/month order, and a `date` column run
 * through a local-time constructor.
 *
 * `toPreferences` is the other half. It reads jsonb, which means it reads whatever was
 * last written to that column — including by a version of this app that no longer
 * exists. A bad `defaultSort` surviving that parse would be a 400 on the user's own
 * wardrobe, so unknown values are dropped rather than passed along.
 */
import { describe, expect, it } from 'vitest';
import {
  DATE_FORMAT_LABELS,
  DEFAULT_DATE_FORMAT,
  DEFAULT_SORT,
  dateFormatOf,
  defaultSortOf,
  formatDate,
  toPreferences,
} from '@/lib/format';

describe('formatDate', () => {
  it('puts day before month by default — the format this app states', () => {
    expect(formatDate('2026-12-31')).toBe('31/12/2026');
    expect(DEFAULT_DATE_FORMAT).toBe('dmy');
  });

  it('formats every offered format', () => {
    expect(formatDate('2026-12-31', 'dmy')).toBe('31/12/2026');
    expect(formatDate('2026-12-31', 'mdy')).toBe('12/31/2026');
    expect(formatDate('2026-12-31', 'iso')).toBe('2026-12-31');
    expect(formatDate('2026-12-31', 'long')).toBe('31 December 2026');
  });

  it('pads, so the columns line up in a list', () => {
    expect(formatDate('2026-01-05', 'dmy')).toBe('05/01/2026');
    expect(formatDate('2026-01-05', 'iso')).toBe('2026-01-05');
  });

  it('does not shift a date-only value by a timezone', () => {
    // `purchased_on` is a Postgres `date`. Through `new Date('2026-03-01')` in a
    // negative-offset zone this becomes February — the class of bug §6.6 caught.
    expect(formatDate('2026-03-01', 'iso')).toBe('2026-03-01');
    expect(formatDate('2026-01-01', 'long')).toBe('1 January 2026');
  });

  it('reads a timestamp as its date part', () => {
    expect(formatDate('2026-09-03T22:45:00Z', 'iso')).toBe('2026-09-03');
  });

  it('renders an absent or unparseable date as a dash, never as today', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('')).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
  });

  it('labels each format with an example of itself', () => {
    // The select shows the shape rather than a name, because "DD/MM/YYYY" is jargon
    // and "31/12/2026" is not.
    for (const label of Object.values(DATE_FORMAT_LABELS)) {
      expect(label).toMatch(/2026/);
    }
  });
});

describe('toPreferences', () => {
  it('keeps every known value', () => {
    expect(
      toPreferences({ dateFormat: 'iso', defaultSort: 'least-worn', wardrobeView: 'list' }),
    ).toEqual({ dateFormat: 'iso', defaultSort: 'least-worn', wardrobeView: 'list' });
  });

  it('drops a value this version does not know', () => {
    expect(toPreferences({ dateFormat: 'klingon', defaultSort: 'by-vibes' })).toEqual({});
  });

  it('survives a column that is null, a string, or an array', () => {
    expect(toPreferences(null)).toEqual({});
    expect(toPreferences(undefined)).toEqual({});
    expect(toPreferences('{}')).toEqual({});
    expect(toPreferences([1, 2])).toEqual({});
  });

  it('keeps the good half of a partly bad object', () => {
    expect(toPreferences({ dateFormat: 'long', defaultSort: 'nope' })).toEqual({
      dateFormat: 'long',
    });
  });
});

describe('the defaults', () => {
  it('apply to a profile that has never set anything', () => {
    expect(dateFormatOf({})).toBe(DEFAULT_DATE_FORMAT);
    expect(defaultSortOf({})).toBe(DEFAULT_SORT);
    expect(dateFormatOf(undefined)).toBe(DEFAULT_DATE_FORMAT);
    expect(defaultSortOf(undefined)).toBe(DEFAULT_SORT);
  });

  it('give way to a stored preference', () => {
    expect(dateFormatOf({ dateFormat: 'mdy' })).toBe('mdy');
    expect(defaultSortOf({ defaultSort: 'cost-per-wear' })).toBe('cost-per-wear');
  });

  it('sorts newest-first by default, which is what a fresh wardrobe wants', () => {
    expect(DEFAULT_SORT).toBe('recent');
  });
});
