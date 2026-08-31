'use client';

/**
 * The hanger-and-brain mark.
 *
 * Used in exactly two places: the login page and the favicon (declared in
 * app/layout.tsx metadata, pointing at the same file). Every other icon in the app
 * stays as it is — the NavBar keeps its brand-500 tile.
 *
 * The mark is a raster asset, so it falls back to the drawn hanger glyph if the file
 * is missing. A sign-in screen with a broken image on it is worse than one with a
 * plain mark.
 */
import { useState } from 'react';
import { HangerIcon } from '@/components/icons';

export function BrandMark({ size = 72 }: { size?: number }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        aria-hidden
        className="flex items-center justify-center rounded-full bg-brand-500 text-white"
        style={{ width: size, height: size }}
      >
        <HangerIcon size={Math.round(size * 0.5)} />
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- a fixed-size local mark; nothing for the optimiser to do
    <img
      src="/logo.png"
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className="rounded-full"
    />
  );
}
