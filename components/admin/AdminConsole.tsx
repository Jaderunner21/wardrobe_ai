'use client';

/**
 * The operator console: Overview (numbers + live event log), People (search, create,
 * edit, reset password, ban, plan, admin, recommendation arm, remove) and Plans (AI caps
 * and item caps, applied on the next request).
 *
 * Everything destructive asks first, and removal is typed rather than clicked — it
 * deletes a wardrobe, its photographs and its wear history, and there is no bin for it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminUserRow } from '@/app/api/admin/users/route';
import type { PlanFeatureRow } from '@/app/api/admin/plans/route';
import type { AdminStats } from '@/app/api/admin/stats/route';
import type { ApiError } from '@/types';

type Tab = 'overview' | 'people' | 'plans';

async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  const response = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.ok) return null;
  const failure = (await response.json().catch(() => null)) as ApiError | null;
  return failure?.error.message ?? 'That did not work.';
}

export function AdminConsole({ currentUserId }: { currentUserId: string }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [plans, setPlans] = useState<PlanFeatureRow[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [u, p, s] = await Promise.all([
        fetch('/api/admin/users').then((r) => r.json()),
        fetch('/api/admin/plans').then((r) => r.json()),
        fetch('/api/admin/stats').then((r) => r.json()),
      ]);
      for (const body of [u, p, s]) if (body.error) throw body;
      setUsers(u.users as AdminUserRow[]);
      setPlans(p.plans as PlanFeatureRow[]);
      setStats(s as AdminStats);
    } catch (e) {
      setError((e as ApiError)?.error?.message ?? 'Could not load the console.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs an action, reports the outcome, reloads. */
  const act = useCallback(
    async (run: () => Promise<string | null>, success: string) => {
      setError(null);
      setNotice(null);
      const failure = await run();
      if (failure) setError(failure);
      else {
        setNotice(success);
        await load();
      }
      return !failure;
    },
    [load],
  );

  if (loading) {
    return <div className="h-64 animate-pulse rounded-[var(--radius-lg)] bg-brand-50" />;
  }

  return (
    <div className="space-y-6">
      <div role="tablist" className="inline-flex rounded-[var(--radius)] bg-brand-50 p-1">
        {(['overview', 'people', 'plans'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-[var(--radius-sm)] px-4 py-1.5 text-meta font-medium capitalize ${
              tab === t ? 'bg-surface text-text shadow-[var(--shadow-card)]' : 'text-text-dim hover:text-text'
            }`}
          >
            {t === 'people' ? `People (${users.length})` : t}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="rounded-[var(--radius)] bg-danger-50 px-4 py-3 text-meta text-danger-600">
          {error}
        </p>
      )}
      {notice && !error && (
        <p role="status" className="rounded-[var(--radius)] bg-brand-50 px-4 py-3 text-meta text-text">
          {notice}
        </p>
      )}

      {tab === 'overview' && stats && <Overview stats={stats} onRefresh={load} />}
      {tab === 'people' && <People users={users} currentUserId={currentUserId} act={act} />}
      {tab === 'plans' && (
        <section>
          <p className="mb-4 text-meta text-text-dim">
            Daily AI ceilings and the item cap. Zero means the plan does not include that
            feature at all; an empty cap means unlimited. Changes apply on the next request —
            no deploy.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {plans.map((plan) => (
              <PlanEditor
                key={plan.plan}
                plan={plan}
                onSave={(p) => act(() => send('/api/admin/plans', 'PATCH', p), `Saved the ${p.plan} plan.`)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────── overview

function Overview({ stats, onRefresh }: { stats: AdminStats; onRefresh: () => Promise<void> }) {
  const tiles: [string, number | string][] = [
    ['Accounts', stats.users],
    ['New this week', stats.signups7d],
    ['Items in wardrobes', stats.items],
    ['Saved outfits', stats.savedOutfits],
    ['Wears logged, 7 days', stats.wears7d],
    ['AI calls today', stats.aiToday.tagCalls + stats.aiToday.llmCalls],
  ];
  const tokens = stats.aiToday.inTokens + stats.aiToday.outTokens;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-[var(--radius-lg)] bg-brand-50 p-4">
            <p className="text-meta text-text-dim">{label}</p>
            <p className="mt-1 font-display text-3xl font-bold">{value.toLocaleString()}</p>
          </div>
        ))}
      </div>
      <p className="text-meta text-text-mute">
        Today: {stats.aiToday.tagCalls} tagging calls, {stats.aiToday.llmCalls} outfit-model
        calls, {tokens.toLocaleString()} tokens.
      </p>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-section font-semibold tracking-tight">Latest activity</h2>
          <button onClick={() => void onRefresh()} className="text-meta font-medium text-text-dim hover:text-text">
            Refresh
          </button>
        </div>
        {stats.events.length === 0 ? (
          <p className="text-meta text-text-mute">Nothing logged yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-[var(--radius-lg)] border border-border">
            {stats.events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-meta">
                <span>
                  <span className="font-medium text-text">{e.name.replace(/_/g, ' ')}</span>
                  {e.who && <span className="text-text-dim"> · {e.who}</span>}
                  {Object.keys(e.props).length > 0 && (
                    <span className="ml-2 font-mono text-chip text-text-mute">
                      {JSON.stringify(e.props).slice(0, 90)}
                    </span>
                  )}
                </span>
                <time className="text-text-mute">{new Date(e.createdAt).toLocaleString()}</time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ─────────────────────────────────────────── people

type Act = (run: () => Promise<string | null>, success: string) => Promise<boolean>;

function People({ users, currentUserId, act }: { users: AdminUserRow[]; currentUserId: string; act: Act }) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.email, u.displayName, u.city, u.plan].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [users, query]);

  const patch = (u: AdminUserRow, body: Record<string, unknown>, success: string) =>
    act(() => send(`/api/admin/users/${u.id}`, 'PATCH', body), success);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email, city, plan…"
          className="w-full max-w-sm rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-body"
        />
        <span className="text-meta text-text-mute">{shown.length} shown</span>
        <button
          onClick={() => setCreating((c) => !c)}
          className="ml-auto rounded-[var(--radius)] bg-brand-500 px-4 py-2 text-meta font-semibold text-on-brand hover:bg-brand-600"
        >
          {creating ? 'Close' : 'New account'}
        </button>
      </div>

      {creating && (
        <CreateUser
          onCreate={async (body) => {
            const done = await act(() => send('/api/admin/users', 'POST', body), `Created ${body.email}.`);
            if (done) setCreating(false);
          }}
        />
      )}

      <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
        <table className="w-full min-w-[64rem] text-meta">
          <thead className="bg-brand-50 text-left">
            <tr>
              <Th>Person</Th>
              <Th>Plan</Th>
              <Th>Items</Th>
              <Th>AI today</Th>
              <Th>Last seen</Th>
              <Th>Outfits by</Th>
              <Th>Admin</Th>
              <Th>{''}</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((user) => {
              const me = user.id === currentUserId;
              return (
                <FragmentRow key={user.id}>
                  <tr className={`border-t border-border align-middle ${user.banned ? 'opacity-60' : ''}`}>
                    <Td>
                      <div className="font-medium text-text">
                        {user.displayName ?? '—'}
                        {user.banned && <span className="ml-2 rounded bg-danger-50 px-1.5 py-0.5 text-chip text-danger-600">banned</span>}
                      </div>
                      <div className="text-text-mute">
                        {user.email}
                        {user.city ? ` · ${user.city}` : ''}
                      </div>
                    </Td>
                    <Td>
                      <select
                        value={user.plan}
                        onChange={(e) => patch(user, { plan: e.target.value }, `Plan set to ${e.target.value}.`)}
                        className="rounded-[var(--radius)] border border-border bg-bg px-2 py-1 text-meta"
                      >
                        <option value="free">free</option>
                        <option value="premium">premium</option>
                      </select>
                    </Td>
                    <Td>{user.itemCount}</Td>
                    <Td>{user.aiToday}</Td>
                    <Td>{user.lastSignInAt ? new Date(user.lastSignInAt).toLocaleDateString() : 'never'}</Td>
                    {/*
                      Module 19 §7's comparison arm. "auto" is not a third state — it is the
                      deterministic bucket the user is already in.
                    */}
                    <Td>
                      <select
                        value={user.aiEngineSource === 'default' ? 'auto' : user.aiEngine ? 'ai' : 'rules'}
                        onChange={(e) =>
                          patch(
                            user,
                            { aiEngine: e.target.value === 'auto' ? null : e.target.value === 'ai' },
                            'Recommendation engine updated.',
                          )
                        }
                        aria-label={`Recommendation engine for ${user.email ?? user.id}`}
                        className="rounded-[var(--radius)] border border-border bg-bg px-2 py-1 text-meta"
                      >
                        <option value="auto">auto ({user.aiEngine ? 'AI' : 'rules'})</option>
                        <option value="ai">AI</option>
                        <option value="rules">rules</option>
                      </select>
                    </Td>
                    <Td>
                      <input
                        type="checkbox"
                        checked={user.isAdmin}
                        disabled={me}
                        onChange={(e) =>
                          patch(user, { isAdmin: e.target.checked }, e.target.checked ? 'Admin granted.' : 'Admin removed.')
                        }
                        aria-label={`Admin access for ${user.email ?? user.id}`}
                      />
                    </Td>
                    <Td>
                      <button
                        onClick={() => setEditing(editing === user.id ? null : user.id)}
                        className="rounded-[var(--radius)] px-2 py-1 font-medium text-text hover:bg-brand-50"
                      >
                        {editing === user.id ? 'Close' : 'Manage'}
                      </button>
                    </Td>
                  </tr>
                  {editing === user.id && (
                    <tr className="bg-brand-50/50">
                      <td colSpan={8} className="px-4 py-4">
                        <ManageUser user={user} me={me} act={act} patch={patch} onDone={() => setEditing(null)} />
                      </td>
                    </tr>
                  )}
                </FragmentRow>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const FragmentRow = ({ children }: { children: React.ReactNode }) => <>{children}</>;

function ManageUser({
  user,
  me,
  act,
  patch,
  onDone,
}: {
  user: AdminUserRow;
  me: boolean;
  act: Act;
  patch: (u: AdminUserRow, body: Record<string, unknown>, success: string) => Promise<boolean>;
  onDone: () => void;
}) {
  const [name, setName] = useState(user.displayName ?? '');
  const [city, setCity] = useState(user.city ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void patch(user, { displayName: name, city: city || null }, 'Profile saved.');
        }}
      >
        <p className="font-semibold text-text">Profile</p>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={inputClass} />
        <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" className={inputClass} />
        <button className={smallBtn}>Save profile</button>
      </form>

      <form
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await patch(user, { password }, `New password set for ${user.email}.`)) setPassword('');
        }}
      >
        <p className="font-semibold text-text">Password</p>
        <input
          type="text"
          value={password}
          minLength={8}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password (8+ characters)"
          autoComplete="off"
          className={inputClass}
        />
        <button disabled={password.length < 8} className={smallBtn}>Set password</button>
      </form>

      <div className="space-y-2">
        <p className="font-semibold text-text">Access</p>
        {me ? (
          <p className="text-text-mute">This is your account. Delete it from Settings.</p>
        ) : (
          <>
            <button
              onClick={() => patch(user, { banned: !user.banned }, user.banned ? 'Unbanned.' : 'Banned — they can no longer sign in.')}
              className={smallBtn}
            >
              {user.banned ? 'Unban' : 'Ban from signing in'}
            </button>
            <div className="flex items-center gap-2 pt-2">
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Type REMOVE"
                className="w-32 rounded-[var(--radius)] border border-danger-300 bg-surface px-2 py-1.5 text-meta"
              />
              <button
                disabled={confirm !== 'REMOVE'}
                onClick={async () => {
                  if (await act(() => send(`/api/admin/users/${user.id}`, 'DELETE'), `Removed ${user.email}.`)) onDone();
                }}
                className="rounded-[var(--radius)] bg-danger-300 px-3 py-1.5 text-meta font-medium text-white disabled:opacity-50"
              >
                Delete account
              </button>
            </div>
            <p className="text-chip text-text-mute">Deletes their wardrobe, photos and history. No undo.</p>
          </>
        )}
      </div>
    </div>
  );
}

function CreateUser({
  onCreate,
}: {
  onCreate: (body: { email: string; password: string; name?: string; plan: string; isAdmin: boolean }) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [plan, setPlan] = useState('free');
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onCreate({ email, password, name: name || undefined, plan, isAdmin });
        setBusy(false);
      }}
      className="grid gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-4 md:grid-cols-6"
    >
      <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={inputClass} />
      <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className={`${inputClass} md:col-span-2`} />
      <input required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (8+)" autoComplete="off" className={inputClass} />
      <select value={plan} onChange={(e) => setPlan(e.target.value)} className={inputClass}>
        <option value="free">free</option>
        <option value="premium">premium</option>
      </select>
      <label className="flex items-center gap-2 text-meta text-text-dim">
        <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} /> Admin
      </label>
      <button disabled={busy} className={`${smallBtn} md:col-span-6 md:justify-self-start`}>
        {busy ? 'Creating…' : 'Create account (no email sent)'}
      </button>
    </form>
  );
}

// ─────────────────────────────────────────── plans

function PlanEditor({ plan, onSave }: { plan: PlanFeatureRow; onSave: (plan: PlanFeatureRow) => Promise<boolean> }) {
  const [draft, setDraft] = useState(plan);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(plan);

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
      <h3 className="text-card font-medium capitalize">{plan.plan}</h3>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <NumberField label="Photo tags / day" value={draft.tagLimit} onChange={(tagLimit) => setDraft({ ...draft, tagLimit })} />
        <NumberField label="Stylist messages / day" value={draft.chatLimit} onChange={(chatLimit) => setDraft({ ...draft, chatLimit })} />
        <NumberField label="Outfit explanations / day" value={draft.rerankLimit} onChange={(rerankLimit) => setDraft({ ...draft, rerankLimit })} />
        <label className="block">
          <span className="mb-1 block text-meta font-medium text-text-dim">Item cap (blank = unlimited)</span>
          <input
            inputMode="numeric"
            value={draft.itemCap ?? ''}
            onChange={(e) => setDraft({ ...draft, itemCap: e.target.value.trim() === '' ? null : Number(e.target.value) })}
            className="w-full rounded-[var(--radius)] border border-border bg-bg px-3 py-2 text-body"
          />
        </label>
      </div>
      <button
        type="button"
        disabled={!dirty || saving}
        onClick={async () => {
          setSaving(true);
          await onSave(draft);
          setSaving(false);
        }}
        className="mt-4 rounded-[var(--radius)] bg-brand-500 px-4 py-2 text-meta font-medium text-on-brand hover:bg-brand-600 disabled:opacity-50"
      >
        {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
      </button>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-meta font-medium text-text-dim">{label}</span>
      <input
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(Math.max(0, parseInt(e.target.value, 10) || 0))}
        className="w-full rounded-[var(--radius)] border border-border bg-bg px-3 py-2 text-body"
      />
    </label>
  );
}

const inputClass = 'w-full rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-meta text-text';
const smallBtn =
  'inline-flex rounded-[var(--radius)] border border-border bg-surface px-3 py-1.5 text-meta font-medium text-text hover:bg-brand-50 disabled:opacity-50';

const Th = ({ children }: { children: React.ReactNode }) => (
  <th className="px-3 py-2 font-semibold uppercase tracking-wide text-text-mute">{children}</th>
);

const Td = ({ children }: { children: React.ReactNode }) => <td className="px-3 py-3 text-text-dim">{children}</td>;
