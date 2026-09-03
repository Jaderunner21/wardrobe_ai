/**
 * The group-wide loading state — module 16 §5.
 *
 * "Skeleton cards matching final layout. Never a centred spinner on a grid." A spinner
 * says only that something is happening; a skeleton in the shape of the page says what
 * is coming, and stops the layout jumping when it arrives.
 *
 * This one covers the dashboard and stands in for any route in the group that has not
 * declared a closer skeleton of its own. Every page in here is `force-dynamic`, so this
 * is what the user sees on a cold navigation, not a theoretical state.
 */
import { Shimmer } from '@/components/primitives';

export default function Loading() {
  return (
    <>
      <div className="mb-8 space-y-2">
        <Shimmer className="h-9 w-64" />
        <Shimmer className="h-4 w-40" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Shimmer className="h-5 w-40" />
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Shimmer key={i} className="aspect-square w-full" />
            ))}
          </div>
          <Shimmer className="h-48 w-full rounded-[var(--radius-lg)]" />
        </div>

        <aside className="space-y-4">
          <Shimmer className="h-5 w-32" />
          {Array.from({ length: 4 }, (_, i) => (
            <Shimmer key={i} className="h-24 w-full rounded-[var(--radius-lg)]" />
          ))}
        </aside>
      </div>
    </>
  );
}
