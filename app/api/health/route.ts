/**
 * GET /api/health — module 14, unauthenticated.
 *
 * Must actually touch Postgres. A health check that only proves Next.js is running
 * will report green through a paused or exhausted database, which is precisely the
 * outage a free-tier project has.
 *
 * Point an external uptime monitor at this (§5). In production point one at staging
 * weekly too: Supabase pauses free projects after 7 days idle, and staging — the thing
 * nobody visits — is exactly what gets caught by that.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const started = Date.now();

  try {
    const supabase = await createClient();
    // weather_cache is the one globally readable table — no session needed.
    const { error } = await supabase.from('weather_cache').select('day').limit(1);
    if (error) throw error;

    return NextResponse.json({ ok: true, db: 'up', latencyMs: Date.now() - started });
  } catch (e) {
    /**
     * The reason goes to the log, never to the response. A Postgres error names tables
     * and columns, and this endpoint is unauthenticated by design — an uptime monitor
     * has to reach it, which means anyone can. Module 01's rule about never leaking a
     * Postgres message applies here more than anywhere.
     */
    console.error('[health] database unreachable', e);
    return NextResponse.json({ ok: false, db: 'down' }, { status: 503 });
  }
}
