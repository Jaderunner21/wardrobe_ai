/**
 * Billing — module 13.
 *
 * The signature check is the entire authentication story for this endpoint: it is
 * unauthenticated by necessity, so a forged body that verifies is a free premium plan
 * for anyone who can send an HTTP request. Most of what follows is that one function
 * being poked at.
 *
 * The rest is the plan state machine, which is easy to get subtly wrong in a way nobody
 * notices for a month — a cancellation that downgrades on the day it arrives takes away
 * time the user already paid for, and the only person who finds out is them.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  isHandled,
  planChangeFor,
  toIso,
  verifySignature,
  type BillingEvent,
} from '@/lib/billing';
// The startup checks live in env.ts — see the note at the foot of lib/billing.ts.
import { assertKeyMatchesPhase, billingConfigured } from '@/lib/env';

const SECRET = 'whsec_test_a_reasonable_length_secret';
const sign = (body: string, secret = SECRET) =>
  createHmac('sha256', secret).update(body).digest('hex');

const BODY = JSON.stringify({
  id: 'evt_123',
  event: 'subscription.activated',
  payload: { subscription: { entity: { id: 'sub_1', current_end: 1_800_000_000 } } },
});

describe('verifySignature', () => {
  it('accepts a body signed with the shared secret', () => {
    expect(verifySignature(BODY, sign(BODY), SECRET)).toBe(true);
  });

  it('rejects a body signed with a different secret', () => {
    expect(verifySignature(BODY, sign(BODY, 'not-the-secret'), SECRET)).toBe(false);
  });

  it('rejects a tampered body — one character is enough', () => {
    const forged = BODY.replace('sub_1', 'sub_2');
    expect(verifySignature(forged, sign(BODY), SECRET)).toBe(false);
  });

  it('rejects a missing or empty signature rather than treating it as a pass', () => {
    expect(verifySignature(BODY, '', SECRET)).toBe(false);
  });

  it('rejects when the secret is missing, instead of verifying against nothing', () => {
    // A misconfigured deployment must fail closed. An empty secret produces a valid
    // HMAC, so "no secret" has to be refused explicitly rather than falling through.
    expect(verifySignature(BODY, sign(BODY, ''), '')).toBe(false);
  });

  it('rejects a signature of the wrong length without throwing', () => {
    // timingSafeEqual throws on mismatched lengths; the route must not 500 on garbage.
    expect(() => verifySignature(BODY, 'abc', SECRET)).not.toThrow();
    expect(verifySignature(BODY, 'abc', SECRET)).toBe(false);
  });

  it('is sensitive to byte-level formatting, which is why the raw body is used', () => {
    // Re-serialising the same document changes the bytes and breaks the signature.
    // This is the reason the route reads request.text() and never request.json().
    const reserialised = JSON.stringify(JSON.parse(BODY));
    const spaced = JSON.stringify(JSON.parse(BODY), null, 2);

    expect(verifySignature(reserialised, sign(reserialised), SECRET)).toBe(true);
    expect(verifySignature(spaced, sign(reserialised), SECRET)).toBe(false);
  });
});

describe('isHandled', () => {
  it('recognises the five subscription events module 13 §2 lists', () => {
    for (const event of [
      'subscription.activated',
      'subscription.charged',
      'subscription.halted',
      'subscription.cancelled',
      'subscription.completed',
    ]) {
      expect(isHandled(event)).toBe(true);
    }
  });

  it('does not act on anything else Razorpay sends', () => {
    expect(isHandled('payment.captured')).toBe(false);
    expect(isHandled('subscription.pending')).toBe(false);
    expect(isHandled('')).toBe(false);
  });
});

describe('planChangeFor', () => {
  const period = '2026-10-03T00:00:00.000Z';

  it('activation makes someone premium and sets the renewal date', () => {
    const change = planChangeFor('subscription.activated', null, period);
    expect(change).toMatchObject({ plan: 'premium', renewsAt: period, endsAtPeriodEnd: false });
  });

  it('a charge extends to the period end Razorpay reports, not one we compute', () => {
    // Adding a month locally drifts with every retry and every proration.
    expect(planChangeFor('subscription.charged', '2026-09-03T00:00:00.000Z', period)?.renewsAt).toBe(
      period,
    );
  });

  it('a halted subscription keeps premium and leaves the date alone', () => {
    // A failed card is usually a bank declining a foreign charge, not someone leaving.
    const change = planChangeFor('subscription.halted', period, null);
    expect(change?.plan).toBe('premium');
    expect(change?.renewsAt).toBeNull();
    expect(change?.endsAtPeriodEnd).toBe(false);
  });

  it('cancellation does NOT downgrade today — it keeps the time already paid for', () => {
    const change = planChangeFor('subscription.cancelled', period, null);
    expect(change?.plan).toBe('premium');
    expect(change?.endsAtPeriodEnd).toBe(true);
    expect(change?.renewsAt).toBe(period);
  });

  it('completion behaves the same way — premium to the end of the period', () => {
    const change = planChangeFor('subscription.completed', period, null);
    expect(change?.plan).toBe('premium');
    expect(change?.endsAtPeriodEnd).toBe(true);
  });

  it('returns nothing for an event it does not handle', () => {
    expect(planChangeFor('payment.captured' as BillingEvent, null, null)).toBeNull();
  });

  it('never returns a free plan — downgrades happen when the period expires', () => {
    // Nothing Razorpay sends downgrades a user on the spot. `downgrade_expired()` does
    // it when the paid period actually ends.
    for (const event of [
      'subscription.activated',
      'subscription.charged',
      'subscription.halted',
      'subscription.cancelled',
      'subscription.completed',
    ] as BillingEvent[]) {
      expect(planChangeFor(event, period, period)?.plan).toBe('premium');
    }
  });
});

describe('toIso', () => {
  it('reads Razorpay epoch seconds', () => {
    expect(toIso(1_800_000_000)).toBe('2027-01-15T08:00:00.000Z');
  });

  it('refuses a millisecond timestamp rather than returning a year in the 50000s', () => {
    expect(toIso(1_800_000_000_000)).toBeNull();
  });

  it('refuses seconds so small they must be a unit mistake', () => {
    expect(toIso(1)).toBeNull();
    expect(toIso(0)).toBeNull();
  });

  it('is null for anything that is not a finite number', () => {
    expect(toIso(undefined)).toBeNull();
    expect(toIso('1800000000')).toBeNull();
    expect(toIso(NaN)).toBeNull();
  });
});

describe('assertKeyMatchesPhase', () => {
  it('refuses a live key outside production — a real charge on a real card', () => {
    expect(() => assertKeyMatchesPhase('rzp_live_abc123', 'test')).toThrow(/live Razorpay key/i);
  });

  it('allows a test key anywhere', () => {
    expect(() => assertKeyMatchesPhase('rzp_test_abc123', 'test')).not.toThrow();
    expect(() => assertKeyMatchesPhase('rzp_test_abc123', 'production')).not.toThrow();
  });

  it('allows a live key in production', () => {
    expect(() => assertKeyMatchesPhase('rzp_live_abc123', 'production')).not.toThrow();
  });

  it('says nothing when billing is not configured at all', () => {
    expect(() => assertKeyMatchesPhase(undefined, 'test')).not.toThrow();
  });
});

/*
 * The downgrade ordering — which 25 of your 60 garments stay active — is deliberately
 * NOT tested here. It lives in `downgrade_to_free()` in 0014_billing.sql, and a
 * TypeScript function restating the same ORDER BY would be a second copy that drifts
 * from the first the moment either is edited, with both still "passing".
 *
 * It is tested against the real function instead, on real rows, in a transaction that
 * rolls back: `scripts/downgrade-check.sql`, run in CI by `pnpm check:downgrade`. That
 * is also the only way to assert the property this module exists for — that a downgrade
 * archives and never deletes.
 */

describe('billingConfigured', () => {
  it('is false until both keys are present — the whole test phase', () => {
    expect(billingConfigured(undefined, undefined)).toBe(false);
    expect(billingConfigured('rzp_test_abc', undefined)).toBe(false);
    expect(billingConfigured(undefined, 'secret')).toBe(false);
    expect(billingConfigured('', '')).toBe(false);
  });

  it('is true only with both', () => {
    expect(billingConfigured('rzp_test_abc', 'secret')).toBe(true);
  });
});
