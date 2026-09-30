/**
 * The Wardrobe AI mark: a hanger on a brand-500 disc.
 *
 * Drawn, not a raster file. The earlier version loaded /logo.png — which was never
 * committed — and relied on an onError fallback that cannot fire for an image that fails
 * before hydration, so every page shipped a broken-image icon. The favicon is the same
 * drawing (app/icon.svg).
 */
import { HangerIcon } from '@/components/icons';

export function BrandMark({ size = 72 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-500 text-on-brand"
      style={{ width: size, height: size }}
    >
      <HangerIcon size={Math.round(size * 0.55)} />
    </span>
  );
}
