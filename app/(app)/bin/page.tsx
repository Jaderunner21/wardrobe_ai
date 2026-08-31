/**
 * Trash Bin — module 16 §4.
 *
 * The line the prototype is missing is the important one: items are permanently
 * deleted after 30 days. A bin with no stated expiry is a storage leak the user
 * cannot see — and the images go with the row, because a bin that never empties is a
 * leak charged to us.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/primitives';
import { BinRow } from '@/components/bin/BinRow';
import { TrashIcon } from '@/components/icons';
import { createClient, getUser } from '@/lib/supabase/server';
import { BIN_PURGE_DAYS, ITEM_DETAIL_SELECT } from '@/lib/items';
import { publicUrlsFor } from '@/lib/storage';
import { toItem, type ItemRow } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

export default async function BinPage() {
  const user = await getUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const { data } = await supabase
    .from('items')
    .select(ITEM_DETAIL_SELECT)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });

  const items = ((data ?? []) as unknown as ItemRow[]).map(toItem);
  const urlsByPath = await publicUrlsFor(items.map((i) => i.thumbPath));

  return (
    <>
      <PageHeader
        title="Trash Bin"
        subtitle={`${items.length} item${items.length === 1 ? '' : 's'} in trash · items are permanently deleted after ${BIN_PURGE_DAYS} days`}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<TrashIcon size={26} />}
          title="Nothing in the bin"
          line="Items you delete land here for 30 days before they are gone for good."
          action={
            <Link
              href="/wardrobe"
              className="rounded-[var(--radius)] border border-border bg-surface px-4 py-2 text-meta font-medium hover:bg-brand-50"
            >
              Back to the wardrobe
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-border rounded-[var(--radius-lg)] border border-border bg-surface px-4">
          {items.map((item) => (
            <BinRow key={item.id} item={item} imageUrl={urlsByPath[item.thumbPath]} />
          ))}
        </ul>
      )}
    </>
  );
}
