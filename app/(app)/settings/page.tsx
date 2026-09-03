/**
 * Settings — module 16 §4: four segmented tabs, Profile · Appearance · Categories ·
 * Account & Data.
 *
 * All five tabs are real now. Appearance grew the two controls the prototype promised
 * and nothing was behind — date format and default sort (0012) — plus module 17's
 * currency and cost-per-wear target. Categories was a placeholder from L0 and is the
 * last unmet line of module 16's acceptance list.
 *
 * `Account Type: Administrator` from the prototype is deliberately absent: there is
 * one kind of user (module 16 §6.3).
 */
import { redirect } from 'next/navigation';
import { PageHeader, NotBuiltYet } from '@/components/PageHeader';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { AppearancePanel } from '@/components/settings/AppearancePanel';
import { CategoriesPanel } from '@/components/settings/CategoriesPanel';
import { ProfileForm } from '@/components/settings/ProfileForm';
import { AccountData, SignOutButton } from '@/components/settings/AccountData';
import { createClient, getUser } from '@/lib/supabase/server';
import { toCategory, toProfile, type CategoryRow, type ProfileRow } from '@/lib/mappers';
import { dateFormatOf, formatDate } from '@/lib/format';
import { getLimits, getUsage } from '@/lib/budget';
import { StyleProfilePanel } from '@/components/settings/StyleProfilePanel';
import { toStyleProfile, type StyleProfileRow } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

const PROFILE_COLUMNS =
  'id, display_name, avatar_key, city, country, timezone, plan, plan_renews_at, item_count, wardrobe_version, currency, cpw_target, onboarding, preferences, created_at';

const CATEGORY_COLUMNS =
  'id, user_id, name, slug, icon, default_slot, subtypes, outfit_eligible, sort_order';

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

  // Today's AI usage, shown to the user rather than only to us (module 12 §7). A cap
  // the user can see coming is a cap they plan around instead of reporting as a bug.
  const [usage, limits, styleRes, categoryRes] = await Promise.all([
    getUsage(user.id),
    getLimits(user.id),
    supabase
      .from('style_profiles')
      .select(
        'user_id, color_affinity, category_affinity, formality_bias, novelty_bias, rejected_pairs, sample_count, updated_at',
      )
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase.from('categories').select(CATEGORY_COLUMNS).order('sort_order'),
  ]);

  const categories = ((categoryRes.data ?? []) as unknown as CategoryRow[]).map(toCategory);
  const dateFormat = dateFormatOf(profile?.preferences);
  const styleProfile = styleRes.data
    ? toStyleProfile(styleRes.data as unknown as StyleProfileRow)
    : null;
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
                    {/* Through the chosen format, not the browser's: module 16 §6.6
                        caught "Member Since 8/28/2025" in an app reporting 2026, and an
                        ambiguous d/m order is how that goes unnoticed. */}
                    <dd className="text-text">{formatDate(profile?.createdAt, dateFormat)}</dd>
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

                <section className="mt-6 rounded-[var(--radius)] bg-brand-50 p-4">
                  <h3 className="text-meta font-semibold uppercase tracking-wide text-text-mute">
                    AI use today
                  </h3>
                  <dl className="mt-2 grid gap-2 text-meta sm:grid-cols-3">
                    <div className="flex justify-between gap-2">
                      <dt className="text-text-dim">Photo tags</dt>
                      <dd className="text-text">
                        {usage.tagCalls} / {limits.tag}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-text-dim">Outfit explanations</dt>
                      <dd className="text-text">
                        {usage.llmCalls} / {limits.rerank}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-text-dim">Stylist messages</dt>
                      <dd className="text-text">
                        {usage.chatCalls} / {limits.chat}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-meta text-text-mute">
                    Resets at midnight, {profile?.timezone ?? 'Asia/Kolkata'}.
                  </p>
                </section>

                {profile && <ProfileForm profile={profile} />}

                <div className="mt-6">
                  <SignOutButton />
                </div>
              </section>
            ),
          },
          {
            id: 'style',
            label: 'Style',
            panel: styleProfile ? (
              <StyleProfilePanel profile={styleProfile} />
            ) : (
              <NotBuiltYet module="module 10" layer="L3" />
            ),
          },
          {
            id: 'appearance',
            label: 'Appearance',
            panel: profile ? (
              <AppearancePanel profile={profile} />
            ) : (
              <NotBuiltYet module="module 03" layer="L0" />
            ),
          },
          {
            id: 'categories',
            label: 'Categories',
            panel: <CategoriesPanel categories={categories} />,
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
