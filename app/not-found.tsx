/**
 * 404 — module 16 §5's empty states, for the one case where the thing asked for does
 * not exist at all.
 *
 * `notFound()` on the item detail page lands here, and that is the common route to it:
 * RLS means someone else's item reads as absent, which is the right answer to give. So
 * the copy avoids implying the item was deleted — it may never have been theirs.
 */
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-6 text-center">
      <p className="text-page font-semibold leading-none tracking-tight text-brand-500">404</p>
      <h1 className="mt-4 text-section font-semibold tracking-tight">Nothing here</h1>
      <p className="mt-2 text-body text-text-dim">
        That page or garment isn&apos;t in your wardrobe.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
        <Link
          href="/wardrobe"
          className="rounded-[var(--radius)] bg-brand-500 px-4 py-2 text-meta font-medium text-white hover:bg-brand-600"
        >
          My Wardrobe
        </Link>
        <Link
          href="/"
          className="rounded-[var(--radius)] border border-border px-4 py-2 text-meta font-medium hover:bg-brand-50"
        >
          Dashboard
        </Link>
      </div>
    </main>
  );
}
