/**
 * The admin console, at /admin.
 *
 * Its own route group, deliberately: it does not belong inside the app shell, it is not
 * in the six-destination nav (module 16 §2), and nobody who is not an admin should ever
 * see a link to it. A non-admin who types the URL gets sent to the dashboard rather than
 * a 403 page — there is nothing here to advertise.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AdminConsole } from '@/components/admin/AdminConsole';
import { getUser, createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Admin — Wardrobe AI' };

export default async function AdminPage() {
  const user = await getUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const { data } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();

  if (!data?.is_admin) redirect('/');

  return (
    <main className="mx-auto min-h-dvh max-w-[1400px] px-6 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[32px] font-semibold leading-tight tracking-tight">Admin</h1>
          <p className="mt-1 text-body text-text-dim">
            Everyone in the wardrobe, what they are doing, and what each plan includes.
          </p>
        </div>
        <Link
          href="/"
          className="rounded-[var(--radius)] border border-border bg-surface px-4 py-2 text-meta font-medium hover:bg-brand-50"
        >
          Back to the app
        </Link>
      </header>

      <AdminConsole currentUserId={user.id} />
    </main>
  );
}
