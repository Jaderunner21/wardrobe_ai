'use client';

/**
 * Account & Data — module 03 §5, §6 and module 16 §4.
 *
 * Export and deletion are the cheapest possible answer to "what happens to my
 * photos". The typed `DELETE ALL MY DATA` confirmation is the prototype's pattern and
 * is kept exactly: a destructive, irreversible action should cost a sentence.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { ApiError } from '@/types';

const CONFIRM_PHRASE = 'DELETE ALL MY DATA';

export function AccountData({ userId, email }: { userId: string; email: string }) {
  const router = useRouter();
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteEverything() {
    setBusy(true);
    setError(null);

    const response = await fetch('/api/account', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      // The API's own confirmation, separate from the phrase typed above.
      body: JSON.stringify({ confirm: 'DELETE' }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? 'Deletion failed. Nothing was removed.');
      setBusy(false);
      return;
    }

    await createClient().auth.signOut();
    router.replace('/login');
  }

  return (
    <div className="space-y-8">
      <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-6">
        <h2 className="text-section font-semibold tracking-tight">Your data</h2>
        <p className="mt-1 text-meta text-text-dim">
          Account ID <code className="text-text">{userId}</code> · {email}
        </p>
        <p className="mt-4 text-body text-text-dim">
          Download everything we hold: your profile, every item with its attributes,
          outfits, feedback, and a link to each photo that stays valid for 24 hours.
        </p>
        <a
          href="/api/account/export"
          className="mt-4 inline-flex rounded-[var(--radius)] border border-border bg-surface px-4 py-2 text-meta font-medium text-text transition-colors hover:bg-brand-50"
        >
          Export my data
        </a>
      </section>

      <section className="rounded-[var(--radius-lg)] bg-danger-50 p-6">
        <h2 className="text-section font-semibold tracking-tight text-danger-600">Danger zone</h2>
        <p className="mt-2 text-body text-text-dim">
          Deleting your account removes every item, outfit and photo permanently. There is no
          bin for this and no undo. Type <strong className="text-text">{CONFIRM_PHRASE}</strong>{' '}
          to enable the button.
        </p>

        <label htmlFor="confirm-delete" className="sr-only">
          Type {CONFIRM_PHRASE} to confirm
        </label>
        <input
          id="confirm-delete"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder={CONFIRM_PHRASE}
          autoComplete="off"
          className="mt-4 w-full max-w-sm rounded-[var(--radius)] border border-danger-300 bg-surface px-4 py-2 text-body text-text placeholder:text-text-mute"
        />

        <button
          type="button"
          disabled={phrase !== CONFIRM_PHRASE || busy}
          onClick={deleteEverything}
          className="mt-4 block rounded-[var(--radius)] bg-danger-300 px-4 py-2 text-meta font-medium text-white transition-opacity disabled:opacity-50"
        >
          {busy ? 'Deleting…' : 'Delete my account and all data'}
        </button>

        {error && (
          <p role="alert" className="mt-3 text-meta text-danger-600">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}

export function SignOutButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={async () => {
        await createClient().auth.signOut();
        router.replace('/login');
      }}
      className="rounded-[var(--radius)] border border-border bg-surface px-4 py-2 text-meta font-medium text-text transition-colors hover:bg-brand-50"
    >
      Log out
    </button>
  );
}
