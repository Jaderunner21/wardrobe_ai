/**
 * Settings — module 16 §4: four segmented tabs, Profile · Appearance · Categories ·
 * Account & Data.
 *
 * Appearance and Account & Data are real at L0 — the dark-mode toggle is the token
 * system proving itself, and export/deletion are module 03's acceptance criteria.
 * Categories needs the wardrobe (module 05), so it says so.
 *
 * `Account Type: Administrator` from the prototype is deliberately absent: there is
 * one kind of user (module 16 §6.3).
 */
import { redirect } from 'next/navigation';
import { PageHeader, NotBuiltYet } from '@/components/PageHeader';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { ThemeToggle } from '@/components/settings/ThemeToggle';
import { AccountData, SignOutButton } from '@/components/settings/AccountData';
import { createClient, getUser } from '@/lib/supabase/server';
import { toProfile, type ProfileRow } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

const PROFILE_COLUMNS =
  'id, display_name, avatar_key, city, country, timezone, plan, plan_renews_at, item_count, wardrobe_version, currency, cpw_target, onboarding, created_at';

export default async function SettingsPage() {
  const user = await getUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const { data } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', user.id)
    .single();

  const profile = data ? toProfile(data as unknown as ProfileRow) : null;
  const email = user.email ?? '';
  const initial = (profile?.displayName ?? email ?? '?').trim().charAt(0).toUpperCase();

  return (
    <>
      <PageHeader title="Settings" />

      <SegmentedTabs
        segments={[
          {
            id: 'profile',
            label: 'Profile',
            panel: (
              <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-6">
                <div className="flex items-center gap-4">
                  <span
                    aria-hidden
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-section font-semibold text-brand-700"
                  >
                    {initial}
                  </span>
                  <div>
                    <p className="text-card font-medium">{profile?.displayName ?? 'No name yet'}</p>
                    <p className="text-meta text-text-dim">{email}</p>
                  </div>
                </div>

                <dl className="mt-6 grid gap-4 text-meta sm:grid-cols-3">
                  <div>
                    <dt className="text-text-mute">Member since</dt>
                    <dd className="text-text">
                      {profile ? new Date(profile.createdAt).toLocaleDateString() : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-mute">Plan</dt>
                    <dd className="text-text capitalize">{profile?.plan ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-text-mute">Items</dt>
                    <dd className="text-text">{profile?.itemCount ?? 0}</dd>
                  </div>
                </dl>

                <div className="mt-6">
                  <SignOutButton />
                </div>
              </section>
            ),
          },
          {
            id: 'appearance',
            label: 'Appearance',
            panel: (
              <section className="rounded-[var(--radius-lg)] border border-border bg-surface px-6 py-2">
                <ThemeToggle />
              </section>
            ),
          },
          {
            id: 'categories',
            label: 'Categories',
            panel: <NotBuiltYet module="module 05" layer="L1" />,
          },
          {
            id: 'account',
            label: 'Account & Data',
            panel: <AccountData userId={user.id} email={email} />,
          },
        ]}
      />
    </>
  );
}
