/**
 * Smart Upload with AI — module 04 §5b, module 16 §4.
 *
 * The server half is only the category list; everything else is interaction, which is
 * what a client component is for. Tagging (module 06) slots in between upload and
 * review without changing this screen's shape — the Review & Edit step is where its
 * output will land, pre-filled instead of blank.
 */
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { UploadFlow } from '@/components/upload/UploadFlow';
import { createClient, getUser } from '@/lib/supabase/server';
import { toCategory, type CategoryRow } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

const CATEGORY_COLUMNS =
  'id, user_id, name, slug, icon, default_slot, subtypes, outfit_eligible, sort_order';

export default async function UploadPage() {
  const user = await getUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const { data } = await supabase.from('categories').select(CATEGORY_COLUMNS).order('sort_order');
  const categories = ((data ?? []) as unknown as CategoryRow[]).map(toCategory);

  return (
    <>
      <PageHeader
        title="Smart Upload"
        subtitle="Photograph it once. Fill in what matters, and the wardrobe does the rest."
      />
      <UploadFlow categories={categories} />
    </>
  );
}
