/**
 * The pure halves of the media pipeline (module 04 §1, §2, §6).
 *
 * `processImage` itself needs a canvas and is verified in the browser against the
 * acceptance list. The scaling arithmetic, the hex encoding and the day-rounded expiry
 * are pure, cheap to test, and each one is silently wrong in a way review does not
 * catch: an upscale wastes storage, a bad digest breaks dedupe, and an expiry that is
 * not day-stable quietly burns the egress allowance.
 */
import { describe, expect, it } from 'vitest';
import { fitWithin, toHex } from '@/lib/image';
import { secondsUntilDayRoundedExpiry } from '@/lib/storage';
import { IMAGE_MAX_EDGE, THUMB_MAX_EDGE } from '@/types';

describe('fitWithin', () => {
  it('scales the longest edge down to the limit', () => {
    // a 4032x3024 iPhone photo
    expect(fitWithin(4032, 3024, IMAGE_MAX_EDGE)).toEqual({ width: 800, height: 600 });
  });

  it('handles portrait as well as landscape', () => {
    expect(fitWithin(3024, 4032, IMAGE_MAX_EDGE)).toEqual({ width: 600, height: 800 });
  });

  it('never upscales — a small image is re-encoded, not enlarged', () => {
    expect(fitWithin(320, 240, IMAGE_MAX_EDGE)).toEqual({ width: 320, height: 240 });
  });

  it('leaves an image exactly at the limit alone', () => {
    expect(fitWithin(800, 450, IMAGE_MAX_EDGE)).toEqual({ width: 800, height: 450 });
  });

  it('preserves aspect ratio to within a rounded pixel', () => {
    const { width, height } = fitWithin(1999, 1001, THUMB_MAX_EDGE);
    expect(Math.max(width, height)).toBe(THUMB_MAX_EDGE);
    expect(Math.abs(width / height - 1999 / 1001)).toBeLessThan(0.01);
  });

  it('never rounds an extreme ratio down to zero', () => {
    expect(fitWithin(4000, 3, THUMB_MAX_EDGE).height).toBeGreaterThanOrEqual(1);
  });
});

describe('toHex', () => {
  it('produces 64 lowercase hex characters for a sha-256 digest', async () => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('shirt'));
    const hex = toHex(digest);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('pads bytes below 0x10 — the bug that makes two hashes collide', () => {
    expect(toHex(new Uint8Array([0, 1, 15, 16, 255]).buffer)).toBe('00010f10ff');
  });

  it('is deterministic, which is what dedupe relies on', async () => {
    const bytes = new TextEncoder().encode('same garment, same bytes');
    const a = toHex(await crypto.subtle.digest('SHA-256', bytes));
    const b = toHex(await crypto.subtle.digest('SHA-256', bytes));
    expect(a).toBe(b);
  });
});

describe('secondsUntilDayRoundedExpiry', () => {
  const at = (iso: string) => secondsUntilDayRoundedExpiry(new Date(iso));

  it('gives every moment in a UTC day the same expiry instant', () => {
    const morning = new Date('2026-08-30T00:00:01Z');
    const evening = new Date('2026-08-30T23:59:59Z');
    const expiryOf = (d: Date) => d.getTime() + secondsUntilDayRoundedExpiry(d) * 1000;

    // Same absolute expiry => same signed URL all day => the browser caches it.
    expect(Math.abs(expiryOf(morning) - expiryOf(evening))).toBeLessThanOrEqual(1000);
  });

  it('always leaves at least a full day of validity', () => {
    expect(at('2026-08-30T23:59:59Z')).toBeGreaterThanOrEqual(86_400);
    expect(at('2026-08-30T00:00:00Z')).toBeGreaterThanOrEqual(86_400);
  });

  it('never exceeds two days, so a leaked URL is short-lived', () => {
    expect(at('2026-08-30T00:00:00Z')).toBeLessThanOrEqual(2 * 86_400);
  });

  it('rolls over a month boundary', () => {
    expect(at('2026-08-31T12:00:00Z')).toBe(12 * 3600 + 86_400);
  });
});
