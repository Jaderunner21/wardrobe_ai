/**
 * One garment — module 05, module 01's repo layout.
 *
 * The card in the grid links here and, until now, here was a 404: the route was in the
 * spec's layout and never built. This is the detail view api-contracts.md describes as
 * "the full row" — the one place allowed to read more than ITEM_LIST_COLUMNS.
 */
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ItemImage } from '@/components/ItemImage';
import { CategoryPill, ColorDot, seasonSummary, STYLE_LABELS } from '@/components/primitives';
import { ItemDetailActions } from '@/components/wardrobe/ItemDetailActions';
import { HistoryPanel } from '@/components/wardrobe/HistoryPanel';
import { createClient, getUser } from '@/lib/supabase/server';
import { ITEM_DETAIL_SELECT } from '@/lib/items';
import { publicUrlsFor } from '@/lib/storage';
import { toCategory, toItem, toProfile, type CategoryRow, type ItemRow, type ProfileRow } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

const CATEGORY_COLUMNS =
  'id, user_id, name, slug, icon, default_slot, subtypes, outfit_eligible, sort_order';

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getUser();
  if (!user) redirect('/login');

  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from('items')
    .select(ITEM_DETAIL_SELECT)
    .eq('id', id)
    .maybeSingle();

  // RLS means someone else's item reads as absent, which is the right answer to give.
  if (!data) notFound();

  const item = toItem(data as unknown as ItemRow);
  const [{ data: categoryRows }, { data: profileRow }, urls] = await Promise.all([
    supabase.from('categories').select(CATEGORY_COLUMNS).order('sort_order'),
    supabase
      .from('profiles')
      .select(
        'id, display_name, avatar_key, city, country, timezone, plan, plan_renews_at, item_count, wardrobe_version, currency, cpw_target, onboarding, created_at',
      )
      .eq('id', user.id)
      .single(),
    publicUrlsFor([item.storagePath, item.thumbPath]),
  ]);

  const profile = profileRow ? toProfile(profileRow as unknown as ProfileRow) : null;

  const categories = ((categoryRows ?? []) as unknown as CategoryRow[]).map(toCategory);
  const category = categories.find((c) => c.id === item.categoryId);
  const label = item.name ?? item.subtype ?? 'Untitled item';

  return (
    <>
      <nav className="mb-4 text-meta text-text-dim">
        <Link href="/wardrobe" className="text-brand-700 underline underline-offset-4">
          My Wardrobe
        </Link>
        <span aria-hidden> / </span>
        <span>{label}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,420px)_1fr]">
        <ItemImage
          src={urls[item.storagePath] ?? urls[item.thumbPath]}
          alt={label}
          width={420}
          height={420}
          className="aspect-square w-full rounded-[var(--radius-lg)] border border-border object-cover"
        />

        <div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-[28px] font-semibold leading-tight tracking-tight">{label}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {category && <CategoryPill name={category.name} icon={category.icon} />}
                {item.archived && (
                  <span className="rounded-full bg-bg px-2 py-0.5 text-chip font-medium text-text-mute">
                    Archived
                  </span>
                )}
                {item.status !== 'ready' && (
                  <span className="rounded-full bg-brand-100 px-2 py-0.5 text-chip font-medium text-brand-800">
                    {item.status}
                  </span>
                )}
              </div>
            </div>

            <ItemDetailActions
              itemId={item.id}
              archived={item.archived}
              favourite={item.favourite}
            />
          </div>

          <dl className="mt-6 grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <Row label="Style" value={item.style ? STYLE_LABELS[item.style] : '—'} />
            <Row label="Type" value={item.subtype ?? '—'} />
            <Row label="Brand" value={item.brand ?? '—'} />
            <Row label="Material" value={item.material ?? '—'} />
            <Row label="Pattern" value={item.pattern ?? '—'} />
            <Row label="Seasons" value={seasonSummary(item.seasons)} />
            <Row label="Formality" value={item.formality ? `${item.formality} / 5` : '—'} />
            <Row label="Warmth" value={item.warmth ? `${item.warmth} / 5` : '—'} />

            <div>
              <dt className="text-meta text-text-mute">Colour</dt>
              <dd className="mt-0.5">
                <ColorDot hex={item.colorHex} name={item.primaryColor} />
              </dd>
            </div>

            <Row
              label="Worn"
              value={
                item.wearCount === 0
                  ? 'Never'
                  : `${item.wearCount} time${item.wearCount === 1 ? '' : 's'}${
                      item.lastWornOn
                        ? ` · last ${new Date(item.lastWornOn).toLocaleDateString()}`
                        : ''
                    }`
              }
            />
          </dl>

          {profile && (
            <div className="mt-6">
              <HistoryPanel item={item} profile={profile} />
            </div>
          )}

          {item.userTags.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-1">
              {item.userTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-brand-100 px-2 py-0.5 text-chip font-medium text-brand-800"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {item.notes && <p className="mt-6 text-body text-text-dim">{item.notes}</p>}

          <p className="mt-6 text-meta text-text-mute">
            Added {new Date(item.createdAt).toLocaleDateString()}
            {item.aiModel && item.aiConfidence != null && (
              <> · tagged by {item.aiModel} at {Math.round(item.aiConfidence * 100)}% confidence</>
            )}
            {item.userEdited && <> · edited by you</>}
          </p>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-meta text-text-mute">{label}</dt>
      <dd className="mt-0.5 text-body text-text">{value}</dd>
    </div>
  );
}
