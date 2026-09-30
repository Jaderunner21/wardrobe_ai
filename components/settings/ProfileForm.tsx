'use client';

/**
 * The editable half of Profile — module 16 §4: "editable full name".
 *
 * City is here too, and it is the one that matters more than it looks. Module 07 reads
 * `profiles.city` to fetch the forecast, and until now there was no way to set it from
 * inside the app — the only route was the Supabase dashboard, which is not a route.
 * Today's Weather Outfit has a manual override precisely so it degrades without this,
 * but a person who has to edit a database row to get their own weather is not a user
 * with a preference, they are a user with a blocker.
 *
 * Email is deliberately read-only: it identifies the auth row, and changing it is an
 * identity change with a verification flow, not a form field.
 */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { Profile } from '@/types';

export function ProfileForm({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [displayName, setDisplayName] = useState(profile.displayName ?? '');
  const [city, setCity] = useState(profile.city ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    displayName.trim() !== (profile.displayName ?? '') || city.trim() !== (profile.city ?? '');

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);

    const response = await fetch('/api/account', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        // An empty field is null, never the empty string — the same rule module 16 §4
        // established for brand, for the same reason: "" sorts and filters like a value.
        displayName: displayName.trim() || null,
        city: city.trim() || null,
      }),
    });

    setSaving(false);
    if (!response.ok) {
      setError('That did not save.');
      return;
    }
    setSaved(true);
    startTransition(() => router.refresh());
  }

  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2">
      <label className="block">
        <span className="mb-1 block text-meta font-medium text-text-dim">Full name</span>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={80}
          placeholder="Your name"
          className={inputClass}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-meta font-medium text-text-dim">City</span>
        <input
          value={city}
          onChange={(e) => setCity(e.target.value)}
          maxLength={80}
          placeholder="Udaipur"
          className={inputClass}
        />
        <span className="mt-1 block text-meta text-text-mute">
          Used for the weather behind today&apos;s outfit.
        </span>
      </label>

      <div className="flex items-center gap-3 sm:col-span-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="rounded-[var(--radius)] bg-brand-500 px-4 py-2 text-meta font-medium text-on-brand hover:bg-brand-600 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && !dirty && <span className="text-meta text-text-mute">Saved</span>}
        {error && (
          <span role="alert" className="text-meta text-danger-600">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

const inputClass =
  'w-full rounded-[var(--radius)] border border-border bg-bg px-3 py-2 text-body text-text placeholder:text-text-mute';
