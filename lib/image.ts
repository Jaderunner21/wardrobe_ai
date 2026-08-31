/**
 * CLIENT ONLY — module 04 §1, §2. Uses canvas and WebCrypto; never import from a
 * server module.
 *
 * This is where the storage budget is won or lost. Naive handling — accept the
 * original JPEG, POST it to an API route, write it server-side — costs roughly 34 GB
 * at production scale and moves every byte across the bandwidth allowance twice.
 * Here a 4 MB phone photo becomes ~55 KB main + ~8 KB thumb before anything leaves
 * the browser.
 *
 * The canvas round-trip also strips EXIF, which removes the GPS coordinates from
 * photos taken at home. Orientation is applied before drawing, or portrait photos
 * from iOS arrive sideways.
 */
import { IMAGE_MAX_EDGE, IMAGE_QUALITY, THUMB_MAX_EDGE } from '@/types';

export interface ProcessedImage {
  main: Blob; // WebP, longest edge 800px, q0.70
  thumb: Blob; // WebP, longest edge 240px, q0.70
  width: number; // of main
  height: number;
  contentHash: string; // sha-256 hex of main's bytes
}

/** Anything the pipeline can be handed. HEIC is decoded by the browser, not by us. */
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

/**
 * Scale to fit inside `maxEdge`, preserving aspect ratio. Never upscales — an image
 * already under the limit is re-encoded but not enlarged.
 *
 * Pure, so it is unit-tested without a browser.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Lowercase hex, the form `items.content_hash` stores. Pure. */
export function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function processImage(file: File): Promise<ProcessedImage> {
  // `from-image` applies the EXIF orientation tag; without it iOS portraits land sideways.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });

  try {
    const main = await encode(bitmap, IMAGE_MAX_EDGE);
    const thumb = await encode(bitmap, THUMB_MAX_EDGE);
    const contentHash = await sha256Hex(main.blob);

    return {
      main: main.blob,
      thumb: thumb.blob,
      width: main.width,
      height: main.height,
      contentHash,
    };
  } finally {
    bitmap.close();
  }
}

/**
 * Hash the PROCESSED bytes, not the original (module 04 §2).
 *
 * Deterministic encoding means the same garment photographed once and uploaded twice
 * collides; two genuinely different photos of the same shirt do not, which is correct
 * — they are different items until the user says otherwise.
 */
export async function sha256Hex(blob: Blob): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
}

async function encode(
  bitmap: ImageBitmap,
  maxEdge: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);

  // OffscreenCanvas keeps the work off the main thread where it exists; the DOM
  // canvas is the fallback for Safari versions that lack convertToBlob.
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: IMAGE_QUALITY });
    return { blob, width, height };
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(bitmap, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', IMAGE_QUALITY),
  );
  if (!blob) throw new Error('WebP encoding failed');
  return { blob, width, height };
}
