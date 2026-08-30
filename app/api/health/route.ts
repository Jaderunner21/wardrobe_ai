/**
 * GET /api/health — module 14, unauthenticated.
 *
 * Must actually touch Postgres. A health check that only proves Next.js is running
 * will report green through a paused or exhausted database, which is precisely the
 * outage a free-tier project has.
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
    const message = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json({ ok: false, db: 'down', error: message }, { status: 503 });
  }
}
