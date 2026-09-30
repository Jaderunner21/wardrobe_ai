/**
 * The AI budget guard's pure halves — module 12 §3, §6.
 *
 * The atomic reservation itself lives in SQL (0007_ai_budget.sql) and is verified
 * against a real Postgres. What is testable here is the arithmetic around it: which
 * cap applies, and which day the cap belongs to. Both are quietly wrong in ways that
 * only show up as either a throttled tester or a bill.
 */
import { describe, expect, it } from 'vitest';
import { limitFor, localDay, resetLabel } from '@/lib/budget';
import { AI_LIMITS } from '@/types';

describe('limitFor', () => {
  it('reads the compile-time fallback for the plan', () => {
    expect(limitFor('free', 'tag')).toBe(AI_LIMITS.free.tag);
    expect(limitFor('premium', 'chat')).toBe(AI_LIMITS.premium.chat);
  });

  it('keeps every cap finite — a broken client bills like an attacker', () => {
    for (const plan of ['free', 'premium'] as const) {
      for (const kind of ['tag', 'chat', 'rerank'] as const) {
        expect(limitFor(plan, kind)).toBeGreaterThan(0);
        expect(limitFor(plan, kind)).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('localDay', () => {
  it('is the user day, not the UTC day', () => {
    // 20:00 UTC is already the 31st in Kolkata (+05:30).
    const at = new Date('2026-08-30T20:00:00Z');
    expect(localDay('Asia/Kolkata', at)).toBe('2026-08-31');
    expect(localDay('UTC', at)).toBe('2026-08-30');
  });

  it('does not roll the day over early in Kolkata', () => {
    // The bug this guards: a UTC reset lands at 05:30 local, and the user is right
    // to report it (§3).
    const justBeforeLocalMidnight = new Date('2026-08-30T18:29:00Z');
    const justAfter = new Date('2026-08-30T18:31:00Z');
    expect(localDay('Asia/Kolkata', justBeforeLocalMidnight)).toBe('2026-08-30');
    expect(localDay('Asia/Kolkata', justAfter)).toBe('2026-08-31');
  });

  it('handles a timezone behind UTC', () => {
    const at = new Date('2026-08-31T04:00:00Z');
    expect(localDay('America/New_York', at)).toBe('2026-08-31');
    const earlier = new Date('2026-08-31T02:00:00Z');
    expect(localDay('America/New_York', earlier)).toBe('2026-08-30');
  });

  it('formats as YYYY-MM-DD, which is what the date column takes', () => {
    expect(localDay('Asia/Kolkata', new Date('2026-01-05T12:00:00Z'))).toBe('2026-01-05');
  });

  it('falls back to UTC rather than throwing on a bad timezone', () => {
    const at = new Date('2026-08-30T12:00:00Z');
    expect(localDay('Not/AZone', at)).toBe('2026-08-30');
  });
});

describe('resetLabel', () => {
  it('names a time the user can wait for', () => {
    expect(resetLabel('Asia/Kolkata')).toMatch(/^midnight /);
  });

  it('survives a bad timezone', () => {
    expect(resetLabel('Not/AZone')).toBe('midnight UTC');
  });
});
