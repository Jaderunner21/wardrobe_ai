/**
 * Wardrobe loading — module 16 §5. The skeleton matches the real layout: sidebar
 * facets on the left, filter bar, then the card grid, so nothing moves when the data
 * lands. Card count is the first page size, not a guess.
 */
import { CardSkeleton, Shimmer } from '@/components/primitives';

export default function Loading() {
  return (
    <>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Shimmer className="h-9 w-56" />
          <Shimmer className="h-4 w-32" />
        </div>
        <Shimmer className="h-10 w-32" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="hidden space-y-6 lg:block">
          {Array.from({ length: 3 }, (_, i) => (
            <Shimmer key={i} className="h-48 w-full rounded-[var(--radius-lg)]" />
          ))}
        </aside>

        <div>
          <Shimmer className="mb-6 h-14 w-full rounded-[var(--radius-lg)]" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
