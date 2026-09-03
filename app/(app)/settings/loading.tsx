/** Settings loading — module 16 §5. Tab track, then one panel. */
import { Shimmer } from '@/components/primitives';

export default function Loading() {
  return (
    <>
      <Shimmer className="mb-8 h-9 w-40" />
      <Shimmer className="mb-6 h-11 w-full max-w-xl rounded-[var(--radius)]" />
      <Shimmer className="h-72 w-full rounded-[var(--radius-lg)]" />
    </>
  );
}
