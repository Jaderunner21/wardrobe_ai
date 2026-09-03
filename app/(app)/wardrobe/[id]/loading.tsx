/** One garment, loading — module 16 §5. Image square left, details right. */
import { Shimmer } from '@/components/primitives';

export default function Loading() {
  return (
    <>
      <Shimmer className="mb-4 h-4 w-48" />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,420px)_1fr]">
        <Shimmer className="aspect-square w-full rounded-[var(--radius-lg)]" />

        <div className="space-y-6">
          <Shimmer className="h-8 w-2/3" />
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="space-y-1.5">
                <Shimmer className="h-3 w-20" />
                <Shimmer className="h-4 w-32" />
              </div>
            ))}
          </div>
          <Shimmer className="h-40 w-full rounded-[var(--radius-lg)]" />
          <Shimmer className="h-56 w-full rounded-[var(--radius-lg)]" />
        </div>
      </div>
    </>
  );
}
