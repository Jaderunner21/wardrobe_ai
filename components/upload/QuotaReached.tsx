'use client';

/**
 * Wardrobe full — module 05 §7, module 16 §5.
 *
 * "`ITEM_QUOTA_EXCEEDED` renders an upgrade prompt, not a generic error toast. This is
 * the product's main conversion moment: the user is mid-task, invested, and has just
 * been told they've outgrown the free tier. It deserves a designed screen."
 *
 * So this is a panel, in the flow, where the upload was — not a red line at the bottom
 * of a form. It states the number they hit, keeps the photos they already picked
 * visible rather than discarding the work, and offers the two things a person actually
 * wants at that moment: more room, or a way to make room themselves.
 *
 * Every plan currently has an unlimited cap, so this path does not fire in the test
 * phase. Module 05 §7 says exactly that and asks for it to be covered by a test rather
 * than left unwritten — an unbuilt conversion screen is a worse surprise on the day
 * billing turns on than an untested one.
 */
import Link from 'next/link';

export function QuotaReached({
  cap,
  itemCount,
  onDismiss,
}: {
  /** The cap the insert tripped, when the API told us. Null when it did not. */
  cap?: number | null;
  itemCount?: number | null;
  onDismiss?: () => void;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-brand-300 bg-brand-50 p-6 text-center">
      <span
        aria-hidden
        className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-brand-700"
      >
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 7h18" />
          <path d="M5 7v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7" />
          <path d="M9 4h6" />
        </svg>
      </span>

      <h2 className="text-section font-semibold tracking-tight text-brand-800">
        Your wardrobe is full
      </h2>

      <p className="mx-auto mt-2 max-w-md text-body text-text-dim">
        {cap
          ? `Your plan holds ${cap} items and you have ${itemCount ?? cap}. `
          : 'Your plan has no room for another item. '}
        Nothing you uploaded has been lost — make some room, or take the larger plan and
        keep going.
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Link
          href="/settings"
          className="rounded-[var(--radius)] bg-brand-500 px-4 py-2 text-meta font-medium text-on-brand hover:bg-brand-600"
        >
          See plans
        </Link>
        {/* The honest second option. Archiving does NOT help — module 16 §7.3: an
            archived item still counts, or archiving becomes free storage — so this
            points at the bin and at deletion, which are the two that do. */}
        <Link
          href={{ pathname: '/wardrobe', search: 'sort=least-worn' }}
          className="rounded-[var(--radius)] border border-border bg-surface px-4 py-2 text-meta font-medium hover:bg-brand-100"
        >
          Find something to remove
        </Link>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-[var(--radius)] px-4 py-2 text-meta font-medium text-text-dim hover:text-text"
          >
            Not now
          </button>
        )}
      </div>

      <p className="mt-4 text-meta text-text-mute">
        Items in the bin still take up space until they are permanently deleted.
      </p>
    </section>
  );
}
