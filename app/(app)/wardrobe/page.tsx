/**
 * My Wardrobe — module 05 §3, module 16 §4.
 *
 * A React Server Component that queries Supabase directly with ITEM_LIST_COLUMNS. This
 * is not a preference: shipping HTML instead of JSON is what keeps Supabase egress
 * inside 5 GB at production scale (module 01 — Data fetching).
 *
 * Filters live in the URL, so a filtered wardrobe is a shareable address and the back
 * button works. Only the first page renders here; "Load more" pages from
 * `GET /api/items` on a cursor.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, StatRow } from '@/components/primitives';
import { ItemCard } from '@/components/ItemCard';
import { ItemRow } from '@/components/ItemRow';
import { FilterBar } from '@/components/wardrobe/FilterBar';
import { LoadMore } from '@/components/wardrobe/LoadMore';
import { UploadIcon, HangerIcon } from '@/components/icons';
import { createClient, getUser } from '@/lib/supabase/server';
import { facetCounts, listItems } from '@/lib/items';
import { publicUrlsFor } from '@/lib/storage';
import { toCategory, type CategoryRow } from '@/lib/mappers';
import { listQuerySchema } from '@/app/api/items/schemas';
import { userPreferences } from '@/lib/preferences';
import { defaultSortOf } from '@/lib/format';
import { STYLE_LABELS } from '@/components/primitives';
import type { Category, Style } from '@/types';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 24;

const CATEGORY_COLUMNS =
  'id, user_id, name, slug, icon, default_slot, subtypes, outfit_eligible, sort_order';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function WardrobePage({ searchParams }: { searchParams: SearchParams }) {
  const user = await getUser();
  if (!user) redirect('/login');

  const raw = await searchParams;
  const preferences = await userPreferences();

  /**
   * The URL wins over the preference, and the preference wins over `recent` — module
   * 16 §4's "default sort" is a default, not an override. `listQuerySchema` supplies
   * `recent` whenever `sort` is absent, so the preference has to be applied to the raw
   * params before parsing rather than after, or it would always lose to that default.
   */
  const withDefaults = raw.sort ? raw : { ...raw, sort: defaultSortOf(preferences) };

  // A hand-edited URL should degrade to the default view, not to an error page.
  const parsed = listQuerySchema.safeParse(withDefaults);
  const query = parsed.success
    ? { ...parsed.data, limit: PAGE_SIZE }
    : { sort: defaultSortOf(preferences), limit: PAGE_SIZE };

  /** Grid or list — a view choice, so it is not part of the items query. */
  const view = raw.view === 'list' || raw.view === 'grid' ? raw.view : preferences.wardrobeView ?? 'grid';

  const supabase = await createClient();

  const [{ data: categoryRows }, counts, page] = await Promise.all([
    supabase.from('categories').select(CATEGORY_COLUMNS).order('sort_order'),
    facetCounts(supabase),
    listItems(supabase, query),
  ]);

  const categories = ((categoryRows ?? []) as unknown as CategoryRow[]).map(toCategory);
  const categoriesById: Record<string, Pick<Category, 'name' | 'icon'>> = Object.fromEntries(
    categories.map((c) => [c.id, { name: c.name, icon: c.icon }]),
  );

  // One batch signing call for the whole page (module 04 §6), never one per image.
  const urlsByPath = await publicUrlsFor(page.items.map((i) => i.thumbPath));

  const shown = query.archived ? counts.archived : counts.total;
  const filtered = Boolean(
    query.q ||
      query.categoryId ||
      query.style ||
      query.season ||
      query.favourite ||
      ('needsReplacing' in query && query.needsReplacing),
  );

  // The cursor belongs to the current filter state, so carry that state with it.
  const carried = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' && key !== 'cursor') carried.set(key, value);
  }
  carried.set('limit', String(PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="My Wardrobe"
        subtitle={`${page.items.length} of ${shown} item${shown === 1 ? '' : 's'}`}
        action={
          <Link
            href="/upload"
            className="inline-flex items-center gap-2 rounded-[var(--radius)] bg-brand-500 px-4 py-2 text-meta font-medium text-white transition-colors hover:bg-brand-600"
          >
            <UploadIcon size={16} />
            Add Items
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-6">
          <Facet
            title="Categories"
            active={query.categoryId}
            param="categoryId"
            current={raw}
            options={categories.map((c) => ({
              key: c.id,
              label: `${c.icon ? `${c.icon} ` : ''}${c.name}`,
              count: counts.byCategory[c.id] ?? 0,
            }))}
          />

          <Facet
            title="Styles"
            active={query.style}
            param="style"
            current={raw}
            options={(Object.keys(STYLE_LABELS) as Style[]).map((s) => ({
              key: s,
              label: STYLE_LABELS[s],
              count: counts.byStyle[s] ?? 0,
            }))}
          />

          <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
            <h2 className="mb-2 text-meta font-semibold uppercase tracking-wide text-text-mute">
              Quick Stats
            </h2>
            <StatRow label="In rotation" count={counts.total} />
            <StatRow label="Favourites" count={counts.favourites} />
            <StatRow label="Archived" count={counts.archived} />
            {counts.needsReplacing > 0 && (
              <StatRow label="Needs replacing" count={counts.needsReplacing} />
            )}
          </section>
        </aside>

        <div>
          <FilterBar
            total={counts.total}
            needsReplacingCount={counts.needsReplacing}
            view={view}
          />

          {page.items.length === 0 ? (
            filtered ? (
              <EmptyState
                icon={<HangerIcon size={26} />}
                title="Nothing matches that"
                line="Try a different category, or clear the filters and start again."
                action={
                  <Link
                    href="/wardrobe"
                    className="rounded-[var(--radius)] border border-border bg-surface px-4 py-2 text-meta font-medium hover:bg-brand-50"
                  >
                    Clear filters
                  </Link>
                }
              />
            ) : (
              <EmptyState
                icon={<UploadIcon size={26} />}
                title="Your wardrobe is empty"
                line="Photograph a few things you actually wear. Everything else follows from that."
                action={
                  <Link
                    href="/upload"
                    className="rounded-[var(--radius)] bg-brand-500 px-4 py-2 text-meta font-medium text-white hover:bg-brand-600"
                  >
                    Add your first items
                  </Link>
                }
              />
            )
          ) : (
            <div
              className={
                view === 'list'
                  ? 'grid grid-cols-1 gap-3'
                  : 'grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4'
              }
            >
              {page.items.map((item) =>
                view === 'list' ? (
                  <ItemRow
                    key={item.id}
                    item={item}
                    category={item.categoryId ? categoriesById[item.categoryId] : undefined}
                    imageUrl={urlsByPath[item.thumbPath]}
                  />
                ) : (
                  <ItemCard
                    key={item.id}
                    item={item}
                    category={item.categoryId ? categoriesById[item.categoryId] : undefined}
                    imageUrl={urlsByPath[item.thumbPath]}
                  />
                ),
              )}

              {page.nextCursor && (
                <LoadMore
                  initialCursor={page.nextCursor}
                  query={carried.toString()}
                  categories={categoriesById}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * A facet row is a link, not a button — filters are addresses. Counts on every row are
 * what make the sidebar feel like a wardrobe rather than a menu (module 16 §4).
 */
function Facet({
  title,
  param,
  active,
  current,
  options,
}: {
  title: string;
  param: string;
  active?: string;
  current: Record<string, string | string[] | undefined>;
  options: { key: string; label: string; count: number }[];
}) {
  const hrefFor = (key: string) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(current)) {
      if (typeof v === 'string' && k !== 'cursor' && k !== param) next.set(k, v);
    }
    if (key !== active) next.set(param, key);
    const query = next.toString();
    return query ? `/wardrobe?${query}` : '/wardrobe';
  };

  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
      <h2 className="mb-2 text-meta font-semibold uppercase tracking-wide text-text-mute">
        {title}
      </h2>
      <ul>
        {options.map(({ key, label, count }) => {
          const selected = key === active;
          return (
            <li key={key}>
              <Link
                href={{ pathname: '/wardrobe', search: hrefFor(key).split('?')[1] ?? '' }}
                aria-current={selected ? 'true' : undefined}
                className={[
                  'flex items-center justify-between rounded-[var(--radius-sm)] px-2 py-1.5 text-meta transition-colors',
                  selected ? 'bg-brand-100 text-brand-700' : 'text-text-dim hover:bg-brand-50',
                ].join(' ')}
              >
                <span className="truncate">{label}</span>
                <span className="ml-2 shrink-0 rounded-full bg-brand-100 px-2 text-chip font-medium text-brand-800">
                  {count}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
