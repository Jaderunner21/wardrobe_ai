/**
 * Planner — module 09 §4.
 *
 * A month grid with the planned outfit's thumbnails in each cell. One of the two
 * retention features in the product; the other is the daily recommendation. Both exist
 * because a wardrobe app that only helps you once is used for two weeks and abandoned.
 *
 * Planning does not forecast. It stores an intent for a date — when the date arrives
 * the outfit is shown as planned, not re-scored against that day's weather.
 *
 * The whole month is two queries: outfits with their items embedded, then one batch of
 * signed URLs. A month of plans is up to 31 outfits × 4 items and must never be 124
 * round trips (module 09 §6).
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { ItemImage } from '@/components/ItemImage';
import { createClient, getUser } from '@/lib/supabase/server';
import { listOutfits, type OutfitWithItems } from '@/lib/outfits';
import { outfitImageUrls } from '@/lib/outfit-images';
import { localDay } from '@/lib/budget';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ month?: string }>;

export default async function PlannerPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await getUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', user.id)
    .single();

  const today = localDay(profile?.timezone ?? 'Asia/Kolkata');
  const { month } = await searchParams;

  // YYYY-MM, defaulting to the user's current month.
  const anchor = /^\d{4}-\d{2}$/.test(month ?? '') ? (month as string) : today.slice(0, 7);
  const [year, monthIndex] = anchor.split('-').map(Number) as [number, number];

  const first = new Date(Date.UTC(year, monthIndex - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const from = `${anchor}-01`;
  const to = `${anchor}-${String(daysInMonth).padStart(2, '0')}`;

  const outfits = await listOutfits(supabase, { from, to });
  const imageUrls = await outfitImageUrls(outfits);

  const byDate = new Map<string, OutfitWithItems[]>();
  for (const outfit of outfits) {
    if (!outfit.plannedFor) continue;
    byDate.set(outfit.plannedFor, [...(byDate.get(outfit.plannedFor) ?? []), outfit]);
  }

  // Monday-first, which is how a week is read here.
  const leading = (first.getUTCDay() + 6) % 7;
  const cells = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${anchor}-${String(i + 1).padStart(2, '0')}`),
  ];

  const shift = (delta: number) => {
    const d = new Date(Date.UTC(year, monthIndex - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };

  const monthLabel = first.toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <>
      <PageHeader
        title="Planner"
        subtitle="What you intend to wear. Not a forecast — an intention."
        action={
          <div className="flex items-center gap-2">
            <Link
              href={{ pathname: '/planner', query: { month: shift(-1) } }}
              className="rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-meta font-medium hover:bg-brand-50"
            >
              ←
            </Link>
            <span className="min-w-40 text-center text-meta font-medium">{monthLabel}</span>
            <Link
              href={{ pathname: '/planner', query: { month: shift(1) } }}
              className="rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-meta font-medium hover:bg-brand-50"
            >
              →
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-border bg-border">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
          <div
            key={day}
            className="bg-surface px-2 py-2 text-center text-chip font-semibold uppercase tracking-wide text-text-mute"
          >
            {day}
          </div>
        ))}

        {cells.map((date, index) => {
          if (!date) return <div key={`pad-${index}`} className="min-h-24 bg-bg" />;

          const planned = byDate.get(date) ?? [];
          const isToday = date === today;

          return (
            <div
              key={date}
              className={`min-h-24 bg-surface p-2 ${isToday ? 'ring-1 ring-inset ring-brand-500' : ''}`}
            >
              <div
                className={`mb-1 text-chip ${isToday ? 'font-semibold text-brand-700' : 'text-text-mute'}`}
              >
                {Number(date.slice(8))}
              </div>

              <div className="flex flex-wrap gap-1">
                {planned.flatMap((outfit) =>
                  outfit.items.slice(0, 4).map(({ itemId, item }) => (
                    <ItemImage
                      key={`${outfit.id}-${itemId}`}
                      src={imageUrls[itemId]}
                      alt={item?.name ?? 'Planned item'}
                      width={28}
                      height={28}
                      className="h-7 w-7 rounded-[var(--radius-sm)] object-cover"
                    />
                  )),
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-meta text-text-mute">
        Plan an outfit from the{' '}
        <Link href="/outfits" className="text-brand-700 underline underline-offset-4">
          Outfits
        </Link>{' '}
        page — each saved outfit has a date field.
      </p>
    </>
  );
}
