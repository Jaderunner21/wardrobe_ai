/**
 * Weather context — module 07 §2, §3, §6.
 *
 * The bucket boundaries are the load-bearing part: `TARGET_WARMTH_SUM` is indexed by
 * them, so an off-by-one at 18°C dresses someone for the wrong day and the
 * recommendation cache keys on the wrong value. The spec pins the boundaries exactly,
 * so the test does too.
 *
 * No network: the provider is parsed from a recorded response shape.
 */
import { describe, expect, it } from 'vitest';
import {
  cityKeyFor,
  describeWmo,
  parseOpenMeteo,
  representativeTemp,
  tempBucket,
} from '@/lib/weather';
import { TARGET_WARMTH_SUM } from '@/types';

describe('tempBucket', () => {
  it('matches the table, including exactly on each boundary', () => {
    expect(tempBucket(-5)).toBe(0);
    expect(tempBucket(9.9)).toBe(0);
    expect(tempBucket(10)).toBe(1); // boundary belongs to the warmer bucket
    expect(tempBucket(17.9)).toBe(1);
    expect(tempBucket(18)).toBe(2);
    expect(tempBucket(23.9)).toBe(2);
    expect(tempBucket(24)).toBe(3);
    expect(tempBucket(29.9)).toBe(3);
    expect(tempBucket(30)).toBe(4);
    expect(tempBucket(46)).toBe(4);
  });

  it('produces a bucket the warmth table actually has an entry for', () => {
    for (const t of [-20, 0, 10, 18, 24, 30, 50]) {
      expect(TARGET_WARMTH_SUM[tempBucket(t)]).toBeGreaterThan(0);
    }
  });

  it('asks for less clothing as it gets warmer', () => {
    const sums = [0, 1, 2, 3, 4].map((b) => TARGET_WARMTH_SUM[b as 0 | 1 | 2 | 3 | 4]);
    expect(sums).toEqual([...sums].sort((a, b) => b - a));
  });
});

describe('cityKeyFor', () => {
  it('lowercases and trims, so one city is one cache entry', () => {
    expect(cityKeyFor('Udaipur', 'IN')).toBe('udaipur,in');
    expect(cityKeyFor(' udaipur ', 'in')).toBe('udaipur,in');
    expect(cityKeyFor('Udaipur', 'IN')).toBe(cityKeyFor('UDAIPUR', 'in'));
  });

  it('keeps cities in different countries apart', () => {
    expect(cityKeyFor('Hyderabad', 'IN')).not.toBe(cityKeyFor('Hyderabad', 'PK'));
  });
});

describe('representativeTemp', () => {
  it('prefers the 14:00 local reading', () => {
    const hourly = {
      time: ['2026-09-01T12:00', '2026-09-01T13:00', '2026-09-01T14:00'],
      temperature_2m: [28, 30, 33],
    };
    expect(representativeTemp(hourly, 22, 34)).toBe(33);
  });

  it('falls back to the midpoint when hourly data is missing', () => {
    expect(representativeTemp(undefined, 18, 29)).toBe(23.5);
  });

  it('falls back when 14:00 is not in the series', () => {
    const hourly = { time: ['2026-09-01T09:00'], temperature_2m: [21] };
    expect(representativeTemp(hourly, 20, 30)).toBe(25);
  });
});

describe('parseOpenMeteo', () => {
  const response = {
    daily: {
      temperature_2m_max: [33.4],
      temperature_2m_min: [24.1],
      precipitation_sum: [2.6],
      weather_code: [61],
    },
    hourly: {
      time: ['2026-09-01T13:00', '2026-09-01T14:00'],
      temperature_2m: [31.2, 32.8],
    },
  };

  it('reads a forecast into the shape the engine wants', () => {
    expect(parseOpenMeteo(response)).toEqual({
      tempC: 32.8,
      tempMinC: 24.1,
      tempMaxC: 33.4,
      precipitationMm: 2.6,
      condition: 'Rain',
    });
  });

  it('treats a missing daily block as no weather rather than throwing', () => {
    expect(parseOpenMeteo({})).toBeNull();
    expect(parseOpenMeteo({ daily: {} })).toBeNull();
  });

  it('defaults precipitation to zero rather than undefined', () => {
    const dry = { daily: { temperature_2m_max: [30], temperature_2m_min: [20] } };
    expect(parseOpenMeteo(dry)?.precipitationMm).toBe(0);
  });
});

describe('describeWmo', () => {
  it('maps the codes a user would notice', () => {
    expect(describeWmo(0)).toBe('Clear');
    expect(describeWmo(3)).toBe('Overcast');
    expect(describeWmo(61)).toBe('Rain');
    expect(describeWmo(95)).toBe('Thunderstorm');
  });
});
