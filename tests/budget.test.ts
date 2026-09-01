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
import { AI_LIMITS, AI_LIMITS_TEST } from '@/types';

describe('limitFor', () => {
  it('uses production caps when PHASE is unset', () => {
    expect(limitFor('free', 'tag', undefined)).toBe(AI_LIMITS.free.tag);
    expect(limitFor('premium', 'chat', undefined)).toBe(AI_LIMITS.premium.chat);
  });

  it('raises the caps under PHASE=test', () => {
    expect(limitFor('free', 'tag', 'test')).toBe(AI_LIMITS_TEST.free.tag);
    expect(limitFor('free', 'chat', 'test')).toBe(50);
  });

  it('keeps test-phase caps finite — a broken client bills like an attacker', () => {
    for (const plan of ['free', 'premium'] as const) {
      for (const kind of ['tag', 'chat', 'rerank'] as const) {
        expect(limitFor(plan, kind, 'test')).toBeLessThanOrEqual(100);
        expect(Number.isFinite(limitFor(plan, kind, 'test'))).toBe(true);
      }
    }
  });

  it('gives a free user zero chat and zero rerank in production', () => {
    // Zero is what makes the caller answer PREMIUM_REQUIRED rather than
    // AI_BUDGET_EXCEEDED — an upgrade prompt, not "come back tomorrow" (§5).
    expect(limitFor('free', 'chat', undefined)).toBe(0);
    expect(limitFor('free', 'rerank', undefined)).toBe(0);
  });

  it('anything but the literal string "test" is production', () => {
    expect(limitFor('free', 'chat', 'production')).toBe(0);
    expect(limitFor('free', 'chat', 'TEST')).toBe(0);
    expect(limitFor('free', 'chat', '')).toBe(0);
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
