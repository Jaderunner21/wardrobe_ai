/**
 * The caller's display preferences, for Server Components — module 16 §4.
 *
 * Wrapped in React's `cache()` so several components in one render share a single
 * query. Half a dozen screens show a date and the wardrobe needs the default sort;
 * without the dedupe, "respect the user's date format" would quietly mean one extra
 * round trip per panel on every page load.
 *
 * Returns the defaults rather than throwing when there is no session or the row is
 * missing. A date format is not worth failing a page over, and a signed-out render
 * that reaches here has already been redirected by the page above it.
 */
import 'server-only';
import { cache } from 'react';
import { createClient, getUser } from '@/lib/supabase/server';
import { dateFormatOf, defaultSortOf, toPreferences } from '@/lib/format';
import type { DateFormat, ItemSort, Preferences } from '@/types';

export const userPreferences = cache(async (): Promise<Preferences> => {
  try {
    const user = await getUser();
    if (!user) return {};

    const supabase = await createClient();
    const { data } = await supabase
      .from('profiles')
      .select('preferences')
      .eq('id', user.id)
      .maybeSingle();

    return toPreferences(data?.preferences);
  } catch {
    // Offline, or a profile row that predates 0012. Defaults are a correct answer here.
    return {};
  }
});

export const userDateFormat = async (): Promise<DateFormat> =>
  dateFormatOf(await userPreferences());

export const userDefaultSort = async (): Promise<ItemSort> =>
  defaultSortOf(await userPreferences());
