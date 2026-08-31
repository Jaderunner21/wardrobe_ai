'use client';

/**
 * Bulk upload orchestration — module 04 §5. CLIENT ONLY.
 *
 * Order matters: process every file first (fast, local, and it gives an accurate
 * progress total), then upload with a concurrency of 3. Higher saturates a mobile
 * uplink and makes every item slower. A user who sees "3 of 20" move steadily will
 * wait; one watching an indefinite spinner will not.
 *
 * One failure never aborts the batch. Each file carries its own phase, its own error
 * and its own retry.
 *
 * This module stops at "the bytes are in storage". Creating the row is the caller's
 * job (POST /api/items, module 05) and must happen after the upload, never before —
 * an object with no row is a cheap orphan, a row with no object is a broken card.
 */
import { processImage } from '@/lib/image';
import { uploadToSignedPath } from '@/lib/storage.client';
import type { ApiError, ErrorCode } from '@/types';

export const UPLOAD_CONCURRENCY = 3;

export type UploadPhase = 'queued' | 'compressing' | 'uploading' | 'uploaded' | 'failed';

export interface UploadTask {
  /** Stable key for React lists — the File object itself is not a good key. */
  key: string;
  file: File;
  phase: UploadPhase;
  /** Object URL of the thumb, for the progress row. Revoke when the screen unmounts. */
  previewUrl?: string;
  error?: { code: ErrorCode | 'UNKNOWN'; message: string; itemId?: string };
  result?: UploadedFile;
}

/** Everything POST /api/items needs, once the bytes are safely in storage. */
export interface UploadedFile {
  itemId: string;
  storagePath: string;
  thumbPath: string;
  contentHash: string;
  bytes: number;
  width: number;
  height: number;
}

interface PresignResponse {
  itemId: string;
  storagePath: string;
  thumbPath: string;
  uploadToken: string;
  thumbUploadToken: string;
}

export const newTask = (file: File): UploadTask => ({
  key: `${file.name}:${file.size}:${file.lastModified}:${Math.random().toString(36).slice(2, 8)}`,
  file,
  phase: 'queued',
});

/**
 * Runs the batch, reporting after every phase change so the caller can re-render.
 * Resolves with the final task list; failures are in the tasks, not thrown.
 */
export async function uploadAll(
  tasks: UploadTask[],
  onChange: (tasks: UploadTask[]) => void,
  signal?: AbortSignal,
): Promise<UploadTask[]> {
  const state = tasks.map((t) => ({ ...t }));
  const report = () => onChange(state.map((t) => ({ ...t })));

  let next = 0;
  const worker = async () => {
    while (next < state.length) {
      const index = next++;
      const task = state[index];
      if (!task || signal?.aborted) return;

      try {
        task.phase = 'compressing';
        report();
        const processed = await processImage(task.file);
        task.previewUrl = URL.createObjectURL(processed.thumb);

        task.phase = 'uploading';
        report();
        const uploaded = await uploadOne(processed, signal);

        task.phase = 'uploaded';
        task.result = uploaded;
      } catch (e) {
        task.phase = 'failed';
        task.error = describe(e);
      }
      report();
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(UPLOAD_CONCURRENCY, state.length) }, () => worker()),
  );
  return state;
}

/** Re-runs one failed task in place, leaving the rest of the batch untouched. */
export async function retryTask(
  task: UploadTask,
  onChange: (task: UploadTask) => void,
): Promise<UploadTask> {
  const [only] = await uploadAll([{ ...task, phase: 'queued', error: undefined }], (tasks) => {
    const updated = tasks[0];
    if (updated) onChange(updated);
  });
  return only ?? task;
}

async function uploadOne(
  processed: Awaited<ReturnType<typeof processImage>>,
  signal?: AbortSignal,
): Promise<UploadedFile> {
  // Quota and dedupe are checked before a single byte moves (module 04 §4), so a free
  // user at 25 items fails in a second rather than after twenty photos.
  const response = await fetch('/api/items/presign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contentHash: processed.contentHash,
      bytes: processed.main.size,
      contentType: 'image/webp',
    }),
    signal,
  });

  if (!response.ok) throw await response.json().catch(() => null);
  const presigned = (await response.json()) as PresignResponse;

  // Both objects or neither: a card with a main image and no thumb renders a hole in
  // every grid that uses it.
  await Promise.all([
    uploadToSignedPath(presigned.storagePath, presigned.uploadToken, processed.main),
    uploadToSignedPath(presigned.thumbPath, presigned.thumbUploadToken, processed.thumb),
  ]);

  return {
    itemId: presigned.itemId,
    storagePath: presigned.storagePath,
    thumbPath: presigned.thumbPath,
    contentHash: processed.contentHash,
    bytes: processed.main.size,
    width: processed.width,
    height: processed.height,
  };
}

/** Keeps the API's error code — the UI switches on the code, never the message. */
function describe(e: unknown): NonNullable<UploadTask['error']> {
  const api = e as ApiError | null;
  if (api?.error?.code) {
    return {
      code: api.error.code,
      message: api.error.message,
      itemId: api.error.fields?.itemId,
    };
  }
  return {
    code: 'UNKNOWN',
    message: e instanceof Error ? e.message : 'Upload failed. Try that one again.',
  };
}
