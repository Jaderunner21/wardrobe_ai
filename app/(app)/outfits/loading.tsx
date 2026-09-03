/** Outfits loading — module 16 §5. Two-column card grid, as §4 lays it out. */
import { Shimmer } from '@/components/primitives';

export default function Loading() {
  return (
    <>
      <div className="mb-8 space-y-2">
        <Shimmer className="h-9 w-48" />
        <Shimmer className="h-4 w-72" />
      </div>

      <Shimmer className="mb-6 h-11 w-64" />

      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <Shimmer key={i} className="h-80 w-full rounded-[var(--radius-lg)]" />
        ))}
      </div>
    </>
  );
}
