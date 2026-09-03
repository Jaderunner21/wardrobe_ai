/**
 * POST /api/webhooks/razorpay — module 13 §1.
 *
 * Unauthenticated by necessity and signature-verified because of it. The order of
 * operations in §1 is the whole design and every step earns its place:
 *
 *   1. read the RAW body before parsing        — the signature covers bytes, not a document
 *   2. HMAC-SHA256, timing-safe comparison     — an `===` leaks the signature byte by byte
 *   3. mismatch → 400, log, STOP. Do not parse — an unverified body is attacker input
 *   4. seen event id → 200, no-op              — Razorpay retries; a retried charge must
 *                                                not extend the plan twice
 *   5. handle
 *   6. record the event id
 *   7. 200
 *
 * Step 6 comes AFTER the handling on purpose. Recording first would make a crash
 * mid-handle permanent: the retry would find the id already recorded and no-op, and the
 * payment would be silently lost. Recording last means a crash is retried, and the worst
 * case is doing the work twice — which `apply_plan` is safe to do, because it sets a
 * state rather than incrementing one.
 *
 * This is the ONLY path in the codebase that writes `profiles.plan`.
 */
import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv } from '@/lib/env';
import {
  isHandled,
  planChangeFor,
  toIso,
  verifySignature,
} from '@/lib/billing';

export const dynamic = 'force-dynamic';

/**
 * Deliberately NOT wrapped in `handle()`. That wrapper turns a throw into the app's JSON
 * error envelope, which is right for the API and wrong here: Razorpay reads the status
 * code and retries on 5xx, and a handled 500 with a tidy body is still a 500. What this
 * endpoint must never do is return 200 for work it did not do.
 */
export async function POST(request: Request): Promise<Response> {
  const env = serverEnv();
  const secret = env.RAZORPAY_KEY_SECRET;

  // Billing is not configured during the test phase. 503 rather than 200, so a webhook
  // pointed at the wrong environment retries instead of being silently swallowed.
  if (!secret) {
    console.warn('[razorpay] webhook received but billing is not configured');
    return new Response('billing not configured', { status: 503 });
  }

  // 1 — the raw bytes, exactly as sent.
  const raw = await request.text();
  const signature = request.headers.get('x-razorpay-signature') ?? '';

  // 2, 3 — verified before anything looks inside the body.
  if (!verifySignature(raw, signature, secret)) {
    console.error('[razorpay] signature mismatch', { bytes: raw.length });
    return new Response('invalid signature', { status: 400 });
  }

  let payload: RazorpayPayload;
  try {
    payload = JSON.parse(raw) as RazorpayPayload;
  } catch {
    // Signed but unparseable. Not a retry candidate — the same bytes will fail again.
    return new Response('unparseable body', { status: 400 });
  }

  const eventId = request.headers.get('x-razorpay-event-id') ?? payload.id ?? null;
  const eventType = payload.event ?? '';

  if (!eventId) {
    console.error('[razorpay] no event id on a verified payload', { eventType });
    return new Response('missing event id', { status: 400 });
  }

  const admin = createAdminClient();

  // 4 — idempotency. Razorpay retries on any non-2xx and on timeouts.
  const { data: seen } = await admin
    .from('processed_webhooks')
    .select('event_id')
    .eq('event_id', eventId)
    .maybeSingle();

  if (seen) return Response.json({ ok: true, duplicate: true });

  // An event we do not handle is still an event we have seen. Recording it stops
  // Razorpay retrying something we will never act on.
  if (!isHandled(eventType)) {
    await record(admin, eventId, eventType);
    return Response.json({ ok: true, ignored: eventType });
  }

  const subscription = payload.payload?.subscription?.entity;
  const subscriptionId = subscription?.id ?? null;

  if (!subscriptionId) {
    await record(admin, eventId, eventType);
    return Response.json({ ok: true, ignored: 'no subscription on payload' });
  }

  /**
   * The subscription id is the link to a user, and `notes` is where it was put at
   * checkout. Falling back to `razorpay_sub_id` covers every event after the first,
   * by which time the column is set.
   */
  const userId =
    subscription?.notes?.user_id ?? (await userForSubscription(admin, subscriptionId));

  if (!userId) {
    // Verified, handled, and we cannot say whose it is. Recording it prevents an
    // infinite retry loop over an event that will never resolve.
    console.error('[razorpay] no user for subscription', { subscriptionId, eventType });
    await record(admin, eventId, eventType);
    return Response.json({ ok: true, ignored: 'unknown subscription' });
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('plan_renews_at')
    .eq('id', userId)
    .maybeSingle();

  const change = planChangeFor(
    eventType,
    (profile?.plan_renews_at as string | null) ?? null,
    toIso(subscription?.current_end),
  );

  if (change) {
    // 5 — one call, so the plan and the downgrade cannot land separately.
    const { error } = await admin.rpc('apply_plan', {
      p_user_id: userId,
      p_plan: change.plan,
      p_renews_at: change.renewsAt,
      p_sub_id: subscriptionId,
    });

    if (error) {
      // Do NOT record the event. A 500 makes Razorpay retry, which is what we want.
      console.error('[razorpay] apply_plan failed', { eventType, userId, error });
      return new Response('could not apply plan', { status: 500 });
    }

    console.info('[razorpay]', eventType, { userId, plan: change.plan, note: change.note });
  }

  // 6, 7 — after the work, never before.
  await record(admin, eventId, eventType);
  return Response.json({ ok: true });
}

type Admin = ReturnType<typeof createAdminClient>;

async function record(admin: Admin, eventId: string, eventType: string): Promise<void> {
  const { error } = await admin
    .from('processed_webhooks')
    .insert({ event_id: eventId, event_type: eventType });

  // A duplicate here means two deliveries raced past the check above. Both did the same
  // idempotent work, so the loser of the race is not a problem worth a 500.
  if (error && error.code !== '23505') {
    console.error('[razorpay] could not record event', { eventId, error });
  }
}

async function userForSubscription(admin: Admin, subscriptionId: string): Promise<string | null> {
  const { data } = await admin
    .from('profiles')
    .select('id')
    .eq('razorpay_sub_id', subscriptionId)
    .maybeSingle();

  return (data?.id as string | undefined) ?? null;
}

/** Only the fields this route reads. Razorpay sends a great deal more. */
interface RazorpayPayload {
  id?: string;
  event?: string;
  payload?: {
    subscription?: {
      entity?: {
        id?: string;
        current_end?: number;
        notes?: { user_id?: string };
      };
    };
  };
}
