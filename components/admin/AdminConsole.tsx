'use client';

/**
 * The operator console.
 *
 * Everything destructive asks first, and the confirmations are typed rather than
 * clicked — removing someone deletes their wardrobe, their photographs and their wear
 * history, and there is no bin for it.
 */
import { useCallback, useEffect, useState } from 'react';
import type { AdminUserRow } from '@/app/api/admin/users/route';
import type { PlanFeatureRow } from '@/app/api/admin/plans/route';
import type { ApiError } from '@/types';

export function AdminConsole({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [plans, setPlans] = useState<PlanFeatureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, p] = await Promise.all([
        fetch('/api/admin/users').then((r) => r.json()),
        fetch('/api/admin/plans').then((r) => r.json()),
      ]);
      if (u.error) throw u;
      if (p.error) throw p;
      setUsers(u.users as AdminUserRow[]);
      setPlans(p.plans as PlanFeatureRow[]);
    } catch (e) {
      setError((e as ApiError)?.error?.message ?? 'Could not load the console.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function patchUser(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    const response = await fetch(`/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const failure = (await response.json().catch(() => null)) as ApiError | null;
      setError(failure?.error.message ?? 'That did not save.');
    } else {
      await load();
    }
    setBusyId(null);
  }

  async function removeUser(id: string) {
    setBusyId(id);
    setError(null);
    const response = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      const failure = (await response.json().catch(() => null)) as ApiError | null;
      setError(failure?.error.message ?? 'Could not remove that account.');
    } else {
      setConfirming(null);
      setConfirmText('');
      await load();
    }
    setBusyId(null);
  }

  async function savePlan(plan: PlanFeatureRow) {
    setError(null);
    const response = await fetch('/api/admin/plans', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(plan),
    });
    if (!response.ok) {
      const failure = (await response.json().catch(() => null)) as ApiError | null;
      setError(failure?.error.message ?? 'Could not save that plan.');
    } else {
      await load();
    }
  }

  if (loading) {
    return <div className="h-64 animate-pulse rounded-[var(--radius-lg)] bg-brand-50" />;
  }

  return (
    <div className="space-y-10">
      {error && (
        <p role="alert" className="rounded-[var(--radius)] bg-danger-50 px-4 py-3 text-meta text-danger-600">
          {error}
        </p>
      )}

      <section>
        <h2 className="mb-1 text-section font-semibold tracking-tight">Plans</h2>
        <p className="mb-4 text-meta text-text-dim">
          Daily AI ceilings and the item cap. Zero means the plan does not include that
          feature at all; an empty cap means unlimited. Changes apply on the next request —
          no deploy.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          {plans.map((plan) => (
            <PlanEditor key={plan.plan} plan={plan} onSave={savePlan} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-section font-semibold tracking-tight">
          People ({users.length})
        </h2>
        <p className="mb-4 text-meta text-text-dim">
          Everyone with an account. Removing someone deletes their wardrobe, their photos
          and their history permanently.
        </p>

        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
          <table className="w-full min-w-[52rem] text-meta">
            <thead className="bg-brand-50 text-left">
              <tr>
                <Th>Person</Th>
                <Th>Plan</Th>
                <Th>Items</Th>
                <Th>City</Th>
                <Th>Last seen</Th>
                <Th>Outfits by</Th>
                <Th>Admin</Th>
                <Th>{''}</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-border align-middle">
                  <Td>
                    <div className="font-medium text-text">{user.displayName ?? '—'}</div>
                    <div className="text-text-mute">{user.email}</div>
                  </Td>

                  <Td>
                    <select
                      value={user.plan}
                      disabled={busyId === user.id}
                      onChange={(e) => patchUser(user.id, { plan: e.target.value })}
                      className="rounded-[var(--radius)] border border-border bg-bg px-2 py-1 text-meta"
                    >
                      <option value="free">free</option>
                      <option value="premium">premium</option>
                    </select>
                  </Td>

                  <Td>{user.itemCount}</Td>
                  <Td>{user.city ?? '—'}</Td>
                  <Td>
                    {user.lastSignInAt
                      ? new Date(user.lastSignInAt).toLocaleDateString()
                      : 'never'}
                  </Td>

                  {/*
                    Module 19 §7's comparison arm. "auto" is not a third state — it is
                    the deterministic bucket the user is already in, shown as (auto) so
                    an operator can tell an assignment they made from one they inherited.
                  */}
                  <Td>
                    <select
                      value={user.aiEngineSource === 'default' ? 'auto' : user.aiEngine ? 'ai' : 'rules'}
                      disabled={busyId === user.id}
                      onChange={(e) =>
                        patchUser(user.id, {
                          aiEngine:
                            e.target.value === 'auto' ? null : e.target.value === 'ai',
                        })
                      }
                      aria-label={`Recommendation engine for ${user.email ?? user.id}`}
                      className="rounded-[var(--radius)] border border-border bg-bg px-2 py-1 text-meta"
                    >
                      <option value="auto">
                        auto ({user.aiEngine ? 'AI' : 'rules'})
                      </option>
                      <option value="ai">AI</option>
                      <option value="rules">rules</option>
                    </select>
                  </Td>

                  <Td>
                    <input
                      type="checkbox"
                      checked={user.isAdmin}
                      disabled={busyId === user.id || user.id === currentUserId}
                      onChange={(e) => patchUser(user.id, { isAdmin: e.target.checked })}
                      aria-label={`Admin access for ${user.email ?? user.id}`}
                    />
                  </Td>

                  <Td>
                    {user.id === currentUserId ? (
                      <span className="text-text-mute">you</span>
                    ) : confirming === user.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          value={confirmText}
                          onChange={(e) => setConfirmText(e.target.value)}
                          placeholder="REMOVE"
                          className="w-24 rounded-[var(--radius)] border border-danger-300 bg-surface px-2 py-1 text-meta"
                        />
                        <button
                          type="button"
                          disabled={confirmText !== 'REMOVE' || busyId === user.id}
                          onClick={() => removeUser(user.id)}
                          className="rounded-[var(--radius)] bg-danger-300 px-2 py-1 text-meta font-medium text-white disabled:opacity-50"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirming(null);
                            setConfirmText('');
                          }}
                          className="text-text-mute"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirming(user.id)}
                        className="rounded-[var(--radius)] px-2 py-1 font-medium text-danger-600 hover:bg-danger-50"
                      >
                        Remove
                      </button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function PlanEditor({
  plan,
  onSave,
}: {
  plan: PlanFeatureRow;
  onSave: (plan: PlanFeatureRow) => Promise<void>;
}) {
  const [draft, setDraft] = useState(plan);
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(plan);

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
      <h3 className="text-card font-medium capitalize">{plan.plan}</h3>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <NumberField
          label="Photo tags / day"
          value={draft.tagLimit}
          onChange={(tagLimit) => setDraft({ ...draft, tagLimit })}
        />
        <NumberField
          label="Stylist messages / day"
          value={draft.chatLimit}
          onChange={(chatLimit) => setDraft({ ...draft, chatLimit })}
        />
        <NumberField
          label="Outfit explanations / day"
          value={draft.rerankLimit}
          onChange={(rerankLimit) => setDraft({ ...draft, rerankLimit })}
        />
        <label className="block">
          <span className="mb-1 block text-meta font-medium text-text-dim">
            Item cap (blank = unlimited)
          </span>
          <input
            inputMode="numeric"
            value={draft.itemCap ?? ''}
            onChange={(e) =>
              setDraft({
                ...draft,
                itemCap: e.target.value.trim() === '' ? null : Number(e.target.value),
              })
            }
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
        className="mt-4 rounded-[var(--radius)] bg-brand-500 px-4 py-2 text-meta font-medium text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
      </button>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
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

const Th = ({ children }: { children: React.ReactNode }) => (
  <th className="px-3 py-2 font-semibold uppercase tracking-wide text-text-mute">{children}</th>
);

const Td = ({ children }: { children: React.ReactNode }) => (
  <td className="px-3 py-3 text-text-dim">{children}</td>
);
