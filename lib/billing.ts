/**
 * Razorpay plumbing — module 13. Pure where it can be.
 *
 * THE ONE RULE: the client cannot change its own plan. `profiles.plan` is written by the
 * webhook and by nothing else — not a success redirect, not an optimistic update, not an
 * admin convenience path. A payment success page is a claim made by a browser; the
 * webhook, signature-verified, is the fact.
 *
 * Everything in this file that can be tested without a network call is a plain function
 * over a string: signature verification, event classification, the key-prefix check.
 * The route is the thin impure shell around them.
 */
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Plan } from '@/types';

/**
 * Module 13 §1, step 2. HMAC-SHA256 over the RAW body — the bytes as received, before
 * any parsing. `JSON.parse` followed by `JSON.stringify` produces a different string
 * for the same document (key order, whitespace, number formatting), and the signature
 * would then fail on a genuine request while still passing on a forged one that happened
 * to round-trip. So the route reads `request.text()` and never `request.json()`.
 *
 * The comparison is timing-safe. An ordinary `===` returns as soon as two bytes differ,
 * and that timing difference is enough to recover a signature one byte at a time.
 */
export function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

  // timingSafeEqual throws on a length mismatch, which is itself a leak of one bit —
  // but a length mismatch already means the signature is not a sha256 hex digest, so
  // there is nothing further to learn from it.
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

/**
 * Module 13 §2. What each event does to the plan.
 *
 * `halted` keeps premium deliberately: a failed card is usually a bank declining a
 * foreign charge, not someone leaving, and cutting the product off mid-month over a
 * retryable failure loses a customer you still had.
 *
 * `cancelled` and `completed` also keep premium — until the period they already paid for
 * ends. Downgrading on the cancellation notice would take away time that was bought.
 */
export type BillingEvent =
  | 'subscription.activated'
  | 'subscription.charged'
  | 'subscription.halted'
  | 'subscription.cancelled'
  | 'subscription.completed';

export interface PlanChange {
  plan: Plan;
  /** ISO timestamp, or null to leave the existing renewal date alone. */
  renewsAt: string | null;
  /** True when the plan ends at `renewsAt` rather than rolling over. */
  endsAtPeriodEnd: boolean;
  note: string;
}

export function planChangeFor(
  event: BillingEvent,
  currentEnd: string | null,
  chargeEnd: string | null,
): PlanChange | null {
  switch (event) {
    case 'subscription.activated':
      return {
        plan: 'premium',
        renewsAt: chargeEnd,
        endsAtPeriodEnd: false,
        note: 'activated',
      };

    case 'subscription.charged':
      // Extend to whatever Razorpay says the new period end is; it is authoritative and
      // adding a month locally would drift with every retry and proration.
      return { plan: 'premium', renewsAt: chargeEnd, endsAtPeriodEnd: false, note: 'charged' };

    case 'subscription.halted':
      // Payment is failing and Razorpay is retrying. Keep them premium, keep the date.
      return { plan: 'premium', renewsAt: null, endsAtPeriodEnd: false, note: 'payment failing' };

    case 'subscription.cancelled':
    case 'subscription.completed':
      // Premium until the period they paid for runs out; the scheduled job downgrades
      // them when it does. Nothing is taken away today.
      return {
        plan: 'premium',
        renewsAt: chargeEnd ?? currentEnd,
        endsAtPeriodEnd: true,
        note: event === 'subscription.cancelled' ? 'cancelled' : 'completed',
      };

    default:
      return null;
  }
}

const HANDLED: BillingEvent[] = [
  'subscription.activated',
  'subscription.charged',
  'subscription.halted',
  'subscription.cancelled',
  'subscription.completed',
];

export const isHandled = (event: string): event is BillingEvent =>
  (HANDLED as string[]).includes(event);

/** Razorpay sends epoch SECONDS. Multiplying by the wrong thousand gives 1970 or 55000. */
export function toIso(epochSeconds: unknown): string | null {
  if (typeof epochSeconds !== 'number' || !Number.isFinite(epochSeconds)) return null;
  // Anything before 2001 or after 2100 is a unit mistake, not a date.
  if (epochSeconds < 1_000_000_000 || epochSeconds > 4_102_444_800) return null;
  return new Date(epochSeconds * 1000).toISOString();
}

/*
 * `assertKeyMatchesPhase` and `billingConfigured` live in `lib/env.ts`, not here.
 *
 * This module is `server-only` because it uses `node:crypto`, and the startup assertion
 * has to run inside `serverEnv()`. Importing this file from there would drag the crypto
 * import into anything that reads an environment variable, including client components —
 * which fails the build with an unhandled `node:` scheme. Two trivial string checks in
 * env.ts are the cheaper half of that trade.
 */
