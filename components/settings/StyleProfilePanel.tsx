'use client';

/**
 * What the app has learned about you — module 10 §3, §6.
 *
 * A veto learned from three bad days should not be permanent and invisible, so the list
 * is shown and each entry is removable. The affinities are shown too: the profile is
 * human-readable JSON rather than a weight matrix, and being able to sit with a tester
 * and ask "does this match how you dress?" is the whole value of it at this scale.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ApiError, StyleProfile } from '@/types';

export function StyleProfilePanel({ profile }: { profile: StyleProfile }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const liked = Object.entries(profile.colorAffinity)
    .filter(([, v]) => v > 0.05)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const disliked = Object.entries(profile.colorAffinity)
    .filter(([, v]) => v < -0.05)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 6);

  async function removeVeto(pair: [string, string]) {
    setBusy(true);
    setError(null);

    const response = await fetch('/api/style-profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rejectedPairs: profile.rejectedPairs.filter(
          ([a, b]) => !(a === pair[0] && b === pair[1]),
        ),
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? 'Could not clear that.');
    } else {
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-6">
      <h2 className="text-section font-semibold tracking-tight">What we have learned</h2>
      <p className="mt-1 text-meta text-text-dim">
        Built from {profile.sampleCount} piece{profile.sampleCount === 1 ? '' : 's'} of
        feedback. It is arithmetic, not a black box.
      </p>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <h3 className="text-meta font-semibold uppercase tracking-wide text-text-mute">
            Colours you favour
          </h3>
          <div className="mt-2 flex flex-wrap gap-1">
            {liked.length === 0 ? (
              <span className="text-meta text-text-mute">Nothing yet.</span>
            ) : (
              liked.map(([colour]) => (
                <span
                  key={colour}
                  className="rounded-full bg-brand-100 px-2 py-0.5 text-chip font-medium text-brand-800"
                >
                  {colour}
                </span>
              ))
            )}
          </div>
        </div>

        <div>
          <h3 className="text-meta font-semibold uppercase tracking-wide text-text-mute">
            Colours you pass on
          </h3>
          <div className="mt-2 flex flex-wrap gap-1">
            {disliked.length === 0 ? (
              <span className="text-meta text-text-mute">Nothing yet.</span>
            ) : (
              disliked.map(([colour]) => (
                <span
                  key={colour}
                  className="rounded-full bg-bg px-2 py-0.5 text-chip font-medium text-text-dim"
                >
                  {colour}
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-meta font-semibold uppercase tracking-wide text-text-mute">
          Combinations you rejected
        </h3>
        <p className="mt-1 text-meta text-text-dim">
          Added after three thumbs-down on the same pairing. These are never suggested again
          until you clear them.
        </p>

        {profile.rejectedPairs.length === 0 ? (
          <p className="mt-2 text-meta text-text-mute">None.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {profile.rejectedPairs.map(([a, b]) => (
              <li
                key={`${a}|${b}`}
                className="flex items-center gap-2 rounded-full border border-border px-3 py-1 text-meta"
              >
                {a} + {b}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => removeVeto([a, b])}
                  aria-label={`Allow ${a} with ${b} again`}
                  className="text-text-mute hover:text-danger-600 disabled:opacity-60"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-meta text-danger-600">
          {error}
        </p>
      )}
    </section>
  );
}
