/**
 * Outfits — module 09, module 16 §4.
 *
 * Generation is interactive and lives in a client component; the saved list is server
 * rendered, one query with its items embedded (module 09 §6).
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/primitives';
import { SparkleIcon } from '@/components/icons';
import { OutfitCard } from '@/components/outfits/OutfitCard';
import { Recommendations } from '@/components/outfits/Recommendations';
import { createClient, getUser } from '@/lib/supabase/server';
import { listOutfits } from '@/lib/outfits';
import { outfitImageUrls } from '@/lib/outfit-images';

export const dynamic = 'force-dynamic';

export default async function OutfitsPage() {
  const user = await getUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const saved = await listOutfits(supabase, { saved: true });
  const imageUrls = await outfitImageUrls(saved);

  return (
    <>
      <PageHeader
        title="Outfits"
        subtitle="Built from what is actually in your wardrobe."
        action={
          <Link
            href="/planner"
            className="rounded-[var(--radius)] border border-border bg-surface px-4 py-2 text-meta font-medium hover:bg-brand-50"
          >
            Open planner
          </Link>
        }
      />

      <Recommendations />

      <section>
        <h2 className="mb-3 text-section font-semibold tracking-tight">Saved outfits</h2>

        {saved.length === 0 ? (
          <EmptyState
            icon={<SparkleIcon size={26} />}
            title="No saved outfits yet"
            line="Generate a few above and keep the ones you would actually wear."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {saved.map((outfit) => (
              <OutfitCard key={outfit.id} outfit={outfit} imageUrls={imageUrls} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
