/** Bin loading — module 16 §5. Rows, not cards: the bin is a list. */
import { Shimmer } from '@/components/primitives';

export default function Loading() {
  return (
    <>
      <div className="mb-8 space-y-2">
        <Shimmer className="h-9 w-44" />
        <Shimmer className="h-4 w-80" />
      </div>

      <div className="divide-y divide-border rounded-[var(--radius-lg)] border border-border bg-surface">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <Shimmer className="h-14 w-14 shrink-0 rounded-[var(--radius)]" />
            <div className="flex-1 space-y-2">
              <Shimmer className="h-4 w-48" />
              <Shimmer className="h-3 w-32" />
            </div>
            <Shimmer className="h-9 w-24" />
          </div>
        ))}
      </div>
    </>
  );
}
