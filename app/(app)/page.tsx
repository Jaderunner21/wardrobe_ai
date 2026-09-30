/**
 * Dashboard — module 16 §4.
 *
 * Two columns, roughly 2:1. Left: recent items, then Today's Weather Outfit. Right
 * rail: Style Insights as brand-50 stat tiles.
 *
 * This and the planner are the two retention surfaces (module 09 §4) — the reasons to
 * open the app on a day when you are not adding clothes.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EmptyState } from '@/components/primitives';
import { ItemImage } from '@/components/ItemImage';
import { UploadIcon } from '@/components/icons';
import { TodaysOutfit } from '@/components/dashboard/TodaysOutfit';
import { RetailerDurabilityPanel } from '@/components/dashboard/RetailerDurability';
import { createClient, getUser } from '@/lib/supabase/server';
import { listItems } from '@/lib/items';
import { styleInsights } from '@/lib/insights';
import { publicUrlsFor } from '@/lib/storage';
import { toCategory, toProfile, type CategoryRow, type ProfileRow } from '@/lib/mappers';
import { formatMoney } from '@/lib/cpw';
import { greetingFor, hourIn, longDateIn } from '@/lib/format';

export const dynamic = 'force-dynamic';

const RECENT_LIMIT = 8;

const CATEGORY_COLUMNS =
  'id, user_id, name, slug, icon, default_slot, subtypes, outfit_eligible, sort_order';

export default async function DashboardPage() {
  const user = await getUser();
  if (!user) redirect('/login');

  const supabase = await createClient();

  const [{ data: profileRow }, recent, insights, { data: categoryRows }] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, display_name, avatar_key, city, country, timezone, plan, plan_renews_at, item_count, wardrobe_version, currency, cpw_target, onboarding, created_at',
      )
      .eq('id', user.id)
      .single(),
    listItems(supabase, { sort: 'recent', limit: RECENT_LIMIT }),
    styleInsights(supabase),
    supabase.from('categories').select(CATEGORY_COLUMNS).order('sort_order'),
  ]);

  const urlsByPath = await publicUrlsFor(recent.items.map((i) => i.thumbPath));
  const categories = ((categoryRows ?? []) as unknown as CategoryRow[]).map(toCategory);
  const mostWorn = categories.find((c) => c.id === insights.mostWornCategoryId);

  const profile = profileRow ? toProfile(profileRow as unknown as ProfileRow) : null;
  const firstName = profile?.displayName?.split(' ')[0];
  // Their timezone, not the server's — see greetingFor in lib/format.ts.
  const timezone = profile?.timezone ?? 'Asia/Kolkata';

  return (
    <>
      {/*
        The date sits ABOVE the greeting and stays quiet — it is orientation, not news.
        One serif line per screen is the rule the whole palette leans on; this is the
        dashboard's, so nothing below it competes.
      */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-meta text-text-dim">{longDateIn(timezone)}</p>
          <h1 className="mt-1 text-[34px] font-bold leading-[1.05] tracking-tight md:text-page">
            {greetingFor(hourIn(timezone))}
            {firstName ? `, ${firstName}.` : '.'}
          </h1>
        </div>

        <Link
          href="/upload"
          className="inline-flex items-center gap-2 rounded-[var(--radius)] bg-brand-500 px-4 py-2.5 text-meta font-medium text-on-brand transition-colors hover:bg-brand-600"
        >
          <UploadIcon size={16} />
          Add Items
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-section font-semibold tracking-tight">Recently added</h2>
              <Link href="/wardrobe" className="text-meta text-brand-700 underline underline-offset-4">
                See all
              </Link>
            </div>

            {recent.items.length === 0 ? (
              <EmptyState
                icon={<UploadIcon size={26} />}
                title="Nothing here yet"
                line="Photograph a few things you actually wear. Everything else follows from that."
                action={
                  <Link
                    href="/upload"
                    className="rounded-[var(--radius)] bg-brand-500 px-4 py-2 text-meta font-medium text-on-brand hover:bg-brand-600"
                  >
                    Add your first items
                  </Link>
                }
              />
            ) : (
              <ul className="grid grid-cols-4 gap-3 sm:grid-cols-4">
                {recent.items.map((item) => (
                  <li key={item.id}>
                    <Link href={{ pathname: `/wardrobe/${item.id}` }} className="block">
                      <ItemImage
                        src={urlsByPath[item.thumbPath]}
                        alt={item.name ?? 'Wardrobe item'}
                        width={140}
                        height={140}
                        className="aspect-square w-full rounded-[var(--radius)] object-cover"
                      />
                      <p className="mt-1 truncate text-chip text-text-mute">
                        {item.name ?? item.subtype ?? '—'}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <TodaysOutfit />

          {/* Renders nothing until three items share a retailer — module 18 §4. */}
          <RetailerDurabilityPanel supabase={supabase} currency={profile?.currency} />
        </div>

        <aside className="space-y-4">
          <h2 className="text-section font-semibold tracking-tight">Style Insights</h2>

          <Tile
            label="Most Worn Category"
            value={mostWorn ? `${mostWorn.icon ?? ''} ${mostWorn.name}`.trim() : 'Not yet'}
            note={
              insights.mostWornWears > 0
                ? `${insights.mostWornWears} wear${insights.mostWornWears === 1 ? '' : 's'} logged`
                : 'Log a wear to see this'
            }
          />

          <Tile
            label="Wardrobe Diversity"
            value={`${insights.diversityPercent}%`}
            note={`${insights.categoriesOwned} categor${insights.categoriesOwned === 1 ? 'y' : 'ies'} in your wardrobe`}
          />

          <Tile
            label="Best Value"
            value={
              insights.bestValue
                ? formatMoney(insights.bestValue.costPerWear, profile?.currency)
                : 'Not yet'
            }
            note={
              insights.bestValue
                ? [insights.bestValue.name ?? 'An item', insights.bestValue.caveat ?? 'per wear']
                    .join(' — ')
                : 'Add a price to an item you wear often'
            }
          />

          <Tile
            label="Never Worn"
            value={String(insights.neverWorn)}
            note={
              insights.staleCount > 0
                ? `${insights.staleCount} not worn in six months`
                : 'Everything has been worn at least once'
            }
          />

          {/* Only when there is something to say — module 18 §6, and nothing here is a
              verdict on a purchase: it is the user's own rating of their own clothes. */}
          {insights.needsReplacing > 0 && (
            <Tile
              label="Needs Replacing"
              value={String(insights.needsReplacing)}
              note="You rated these as showing wear"
            />
          )}
        </aside>
      </div>
    </>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <section className="rounded-[var(--radius-lg)] bg-brand-50 p-4">
      <h3 className="text-meta font-semibold uppercase tracking-wide text-text-mute">{label}</h3>
      <p className="mt-1 text-section font-semibold tracking-tight text-brand-800">{value}</p>
      <p className="mt-0.5 text-meta text-text-dim">{note}</p>
    </section>
  );
}
