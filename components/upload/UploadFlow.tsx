'use client';

/**
 * Smart Upload — module 04 §5, §5b and module 16 §4.
 *
 *   Choose Photos → per-file progress → Review & Edit → Save All to Wardrobe (N)
 *
 * Nothing reaches the wardrobe until Save All. The rows exist from the moment the
 * bytes land (they have to: the quota, the dedupe index and orphan-prevention all
 * need a row) but they are `draft`, and drafts are invisible everywhere except here.
 *
 * Per-file progress is the addition the prototype lacks. A bulk upload of twenty
 * photos with no visible progress is where users abandon.
 */
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { newTask, uploadAll, type UploadTask } from '@/lib/upload';
import { ACCEPTED_TYPES } from '@/lib/image';
import { UploadIcon } from '@/components/icons';
import {
  ItemDraftForm,
  draftToPatch,
  emptyDraft,
  type DraftFields,
} from '@/components/upload/ItemDraftForm';
import type { ApiError, Category } from '@/types';

type Phase = 'choose' | 'uploading' | 'review' | 'saved';

interface Draft {
  itemId: string;
  previewUrl?: string;
  fields: DraftFields;
}

export function UploadFlow({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>('choose');
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);

  const start = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setError(null);
      setPhase('uploading');

      const queued = files.map(newTask);
      setTasks(queued);

      const finished = await uploadAll(queued, setTasks);

      // Create a row per uploaded file — after the upload, never before. An object
      // with no row is a cheap orphan; a row with no object is a broken card forever.
      const created: Draft[] = [];
      for (const task of finished) {
        if (!task.result) continue;
        const response = await fetch('/api/items', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(task.result),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as ApiError | null;
          setTasks((current) =>
            current.map((t) =>
              t.key === task.key
                ? {
                    ...t,
                    phase: 'failed',
                    error: {
                      code: body?.error.code ?? 'UNKNOWN',
                      message: body?.error.message ?? 'Could not save that item.',
                    },
                  }
                : t,
            ),
          );
          continue;
        }

        created.push({
          itemId: task.result.itemId,
          previewUrl: task.previewUrl,
          fields: emptyDraft(),
        });
      }

      setDrafts(created);
      setPhase(created.length > 0 ? 'review' : 'choose');
    },
    [],
  );

  async function saveAll() {
    setSaving(true);
    setError(null);

    try {
      // Write each card's edits first, then flip the whole batch in one request.
      for (const draft of drafts) {
        const response = await fetch(`/api/items/${draft.itemId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(draftToPatch(draft.fields, categories)),
        });
        if (!response.ok) throw await response.json().catch(() => null);
      }

      const response = await fetch('/api/items/save-all', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemIds: drafts.map((d) => d.itemId) }),
      });
      if (!response.ok) throw await response.json().catch(() => null);

      const body = (await response.json()) as { saved: number };
      setSavedCount(body.saved);
      setPhase('saved');
      router.refresh();
    } catch (e) {
      const api = e as ApiError | null;
      setError(api?.error?.message ?? 'Could not save those items.');
    } finally {
      setSaving(false);
    }
  }

  async function startOver() {
    if (drafts.length > 0) {
      await fetch('/api/items/discard-all', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemIds: drafts.map((d) => d.itemId) }),
      });
    }
    setDrafts([]);
    setTasks([]);
    setPhase('choose');
    router.refresh();
  }

  if (phase === 'saved') {
    return (
      <div className="rounded-[var(--radius-lg)] border border-border bg-surface px-6 py-12 text-center">
        <p className="text-section font-semibold tracking-tight">
          {savedCount} item{savedCount === 1 ? '' : 's'} added
        </p>
        <p className="mt-1 text-body text-text-dim">They are in your wardrobe now.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            href="/wardrobe"
            className="rounded-[var(--radius)] bg-brand-500 px-4 py-2 text-meta font-medium text-white hover:bg-brand-600"
          >
            See my wardrobe
          </Link>
          <button
            type="button"
            onClick={() => {
              setSavedCount(0);
              setPhase('choose');
            }}
            className="rounded-[var(--radius)] border border-border px-4 py-2 text-meta font-medium hover:bg-brand-50"
          >
            Add more
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {phase === 'choose' && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            start(Array.from(e.dataTransfer.files));
          }}
          className="flex flex-col items-center rounded-[var(--radius-lg)] border-2 border-dashed border-brand-300 bg-brand-50 px-6 py-16 text-center"
        >
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-[var(--radius)] bg-brand-100 text-brand-700">
            <UploadIcon size={26} />
          </span>
          <p className="text-section font-semibold tracking-tight">Drop Your Photos Here</p>
          <p className="mt-1 text-meta text-text-dim">
            Supports JPG, PNG, HEIC • Multiple files allowed
          </p>

          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="mt-6 rounded-[var(--radius)] bg-brand-500 px-5 py-2.5 text-body font-medium text-white hover:bg-brand-600"
          >
            Choose Photos
          </button>

          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED_TYPES.join(',')}
            multiple
            // `capture` is deliberately absent: it forces the camera and blocks the
            // gallery, and people photograph a wardrobe over several sittings.
            className="sr-only"
            onChange={(e) => start(Array.from(e.target.files ?? []))}
          />
        </div>
      )}

      {phase === 'uploading' && (
        <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
          <h2 className="mb-3 text-section font-semibold tracking-tight">
            Selected Items ({tasks.length})
          </h2>
          <ul className="divide-y divide-border">
            {tasks.map((task) => (
              <li key={task.key} className="flex items-center gap-3 py-2">
                <span className="h-10 w-10 shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-brand-50">
                  {task.previewUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- local object URL
                    <img src={task.previewUrl} alt="" className="h-full w-full object-cover" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-meta">{task.file.name}</span>
                <span
                  className={[
                    'text-meta',
                    task.phase === 'failed' ? 'text-danger-600' : 'text-text-dim',
                  ].join(' ')}
                >
                  {PHASE_LABEL[task.phase]}
                  {task.error ? ` — ${task.error.message}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {phase === 'review' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-section font-semibold tracking-tight">Review &amp; Edit Items</h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={startOver}
                disabled={saving}
                className="rounded-[var(--radius)] border border-border px-4 py-2 text-meta font-medium hover:bg-brand-50 disabled:opacity-60"
              >
                Start Over
              </button>
              <button
                type="button"
                onClick={saveAll}
                disabled={saving || drafts.length === 0}
                className="rounded-[var(--radius)] bg-brand-500 px-4 py-2 text-meta font-medium text-white hover:bg-brand-600 disabled:opacity-60"
              >
                {saving ? 'Saving…' : `Save All to Wardrobe (${drafts.length})`}
              </button>
            </div>
          </div>

          {error && (
            <p role="alert" className="rounded-[var(--radius)] bg-danger-50 px-4 py-3 text-meta text-danger-600">
              {error}
            </p>
          )}

          <div className="space-y-3">
            {drafts.map((draft, index) => (
              <ItemDraftForm
                key={draft.itemId}
                index={index}
                previewUrl={draft.previewUrl}
                fields={draft.fields}
                categories={categories}
                onChange={(fields) =>
                  setDrafts((current) =>
                    current.map((d) => (d.itemId === draft.itemId ? { ...d, fields } : d)),
                  )
                }
                onRemove={() => {
                  // Drop it from the batch and bin the row, so its bytes are collected
                  // rather than sitting against the quota forever.
                  void fetch('/api/items/discard-all', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ itemIds: [draft.itemId] }),
                  });
                  setDrafts((current) => current.filter((d) => d.itemId !== draft.itemId));
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const PHASE_LABEL: Record<UploadTask['phase'], string> = {
  queued: 'Waiting',
  compressing: 'Compressing…',
  uploading: 'Uploading…',
  uploaded: 'Ready',
  failed: 'Failed',
};
