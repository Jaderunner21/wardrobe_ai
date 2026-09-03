'use client';

/**
 * The failed-fetch state — module 16 §5: "Offline / fetch failed: inline retry, never a
 * blank panel."
 *
 * Every page in this group is `force-dynamic` and queries Supabase during the render, so
 * a dropped connection is not a hypothetical: it throws in a Server Component and, with
 * no boundary, Next.js shows the user a bare "something went wrong" with no way forward.
 * `reset()` re-runs the render that failed, which is exactly what a person wants after
 * their train comes out of a tunnel.
 *
 * The message is deliberately vague about the cause and specific about the action. The
 * error text itself may name a table or a column — module 01's rule about never leaking
 * a Postgres message applies to the screen as much as to a JSON response — so it goes to
 * the console for us and never onto the page.
 */
import { useEffect } from 'react';
import Link from 'next/link';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[render]', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center rounded-[var(--radius-lg)] border border-border bg-surface px-6 py-16 text-center">
      <span
        aria-hidden
        className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-danger-50 text-danger-600"
      >
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M12 8v5" />
          <path d="M12 17h.01" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      </span>

      <p className="text-section font-semibold tracking-tight">That didn&apos;t load</p>
      <p className="mt-1 max-w-sm text-body text-text-dim">
        Your wardrobe is fine — this screen could not reach it. Check your connection and
        try again.
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-[var(--radius)] bg-brand-500 px-4 py-2 text-meta font-medium text-white hover:bg-brand-600"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-[var(--radius)] border border-border px-4 py-2 text-meta font-medium hover:bg-brand-50"
        >
          Back to the dashboard
        </Link>
      </div>

      {/* The digest is the only handle we have on a specific server render in the logs.
          Shown small, so a tester can quote it without it looking like the point. */}
      {error.digest && (
        <p className="mt-4 text-meta text-text-mute">Reference {error.digest}</p>
      )}
    </div>
  );
}
