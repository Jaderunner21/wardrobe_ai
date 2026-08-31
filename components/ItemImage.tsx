'use client';

/**
 * Item photography — module 04 §6 and module 16 §6.1.
 *
 * A plain <img>, deliberately, not next/image: Vercel's optimiser bills per
 * transformation (5,000/month on Hobby) to redo work the browser already did before
 * upload. Explicit width/height and lazy loading do the rest.
 *
 * The onError fallback is the fix for the prototype's worst visible bug — one dead
 * URL rendered as raw alt text across four separate screens. A broken image now
 * degrades to a placeholder tile.
 */
import { useState } from 'react';
import { ImageOffIcon } from '@/components/icons';

export function ItemImage({
  src,
  alt,
  className = '',
  width = 400,
  height = 400,
}: {
  src?: string | null;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`flex items-center justify-center bg-brand-50 text-brand-300 ${className}`}
        role="img"
        aria-label={`${alt} — image unavailable`}
      >
        <ImageOffIcon size={28} />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- see the note above
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
