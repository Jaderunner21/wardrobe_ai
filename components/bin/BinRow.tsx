'use client';

/**
 * A row in the Trash Bin — module 16 §4: thumbnail, name, deleted date, Restore and
 * Delete Forever.
 */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ItemImage } from '@/components/ItemImage';
import type { ApiError, DateFormat, Item } from '@/types';
import { DEFAULT_DATE_FORMAT, formatDate } from '@/lib/format';

export function BinRow({
  item,
  imageUrl,
  dateFormat = DEFAULT_DATE_FORMAT,
}: {
  item: Item;
  imageUrl?: string;
  dateFormat?: DateFormat;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = item.name ?? item.subtype ?? 'Untitled item';

  async function act(url: string, method: 'POST' | 'DELETE') {
    setBusy(true);
    setError(null);
    const response = await fetch(url, { method });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ApiError | null;
      // The quota is the interesting failure here: restoring counts as an insert, so
      // a free user at the cap is told before the row comes back, not after.
      setError(body?.error.message ?? 'That did not work.');
      setBusy(false);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <li className="flex items-center gap-4 py-3">
      <ItemImage
        src={imageUrl}
        alt={label}
        width={56}
        height={56}
        className="h-14 w-14 shrink-0 rounded-[var(--radius)] object-cover"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-card font-medium">{label}</p>
        <p className="text-meta text-text-mute">
          Deleted {formatDate(item.deletedAt, dateFormat)}
        </p>
        {error && (
          <p role="alert" className="text-meta text-danger-600">
            {error}
          </p>
        )}
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => act(`/api/items/${item.id}/restore`, 'POST')}
        className="rounded-[var(--radius)] border border-border px-3 py-1.5 text-meta font-medium hover:bg-brand-50 disabled:opacity-60"
      >
        Restore
      </button>

      {confirming ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => act(`/api/items/${item.id}?permanent=true`, 'DELETE')}
          className="rounded-[var(--radius)] bg-danger-300 px-3 py-1.5 text-meta font-medium text-white disabled:opacity-60"
        >
          {busy ? 'Deleting…' : 'Really delete'}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-[var(--radius)] px-3 py-1.5 text-meta font-medium text-danger-600 hover:bg-danger-50"
        >
          Delete Forever
        </button>
      )}
    </li>
  );
}
