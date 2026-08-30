'use client';

/**
 * Settings tabs — module 16 §3: four tabs, white active segment on a grey track.
 *
 * Panels are passed in as already-rendered nodes so the server can do the data
 * fetching and this component only handles which one is visible.
 */
import { useId, useState } from 'react';

export type Segment = { id: string; label: string; panel: React.ReactNode };

export function SegmentedTabs({ segments }: { segments: Segment[] }) {
  const groupId = useId();
  const [active, setActive] = useState(segments[0]?.id ?? '');

  return (
    <div>
      <div
        role="tablist"
        aria-label="Settings sections"
        className="inline-flex w-full max-w-2xl gap-1 rounded-[var(--radius)] bg-brand-50 p-1"
      >
        {segments.map(({ id, label }) => {
          const selected = id === active;
          return (
            <button
              key={id}
              role="tab"
              id={`${groupId}-tab-${id}`}
              aria-selected={selected}
              aria-controls={`${groupId}-panel-${id}`}
              onClick={() => setActive(id)}
              className={[
                'flex-1 rounded-[var(--radius-sm)] px-3 py-2 text-meta font-medium transition-colors',
                selected
                  ? 'bg-surface text-text shadow-[var(--shadow-card)]'
                  : 'text-text-dim hover:text-text',
              ].join(' ')}
            >
              {label}
            </button>
          );
        })}
      </div>

      {segments.map(({ id, panel }) => (
        <div
          key={id}
          role="tabpanel"
          id={`${groupId}-panel-${id}`}
          aria-labelledby={`${groupId}-tab-${id}`}
          hidden={id !== active}
          className="mt-6"
        >
          {panel}
        </div>
      ))}
    </div>
  );
}
