/**
 * GET /api/weather — module 07.
 *
 * Uses the caller's `profile.city`. No city means `null`, not a guess: the
 * recommendation engine then skips thermal scoring rather than dressing someone for a
 * city they never named (module 07 §4).
 *
 * No IP geolocation. It is wrong often enough to produce baffling recommendations, and
 * a user who did not give you their location did not give it to you.
 */
import { handle, ok } from '@/lib/api';
import { requireUser, createClient } from '@/lib/supabase/server';
import { cityKeyFor, getWeather } from '@/lib/weather';
import { localDay } from '@/lib/budget';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('city, country, timezone')
    .eq('id', user.id)
    .single();
  if (error) throw error;

  if (!profile?.city) return ok({ weather: null });

  const weather = await getWeather(
    cityKeyFor(profile.city, profile.country ?? 'IN'),
    localDay(profile.timezone ?? 'Asia/Kolkata'),
  );

  return ok({ weather });
});
