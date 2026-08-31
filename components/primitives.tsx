/**
 * The small repeated pieces from module 16 §3. Every colour is a token; there is no
 * literal hex anywhere in this file.
 */
import type { Season, Style } from '@/types';

export function CategoryPill({ name, icon }: { name: string; icon?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-chip font-medium text-brand-800">
      {icon && <span aria-hidden>{icon}</span>}
      {name}
    </span>
  );
}

export function TagChip({ label, more }: { label: string; more?: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/85 px-2 py-0.5 text-chip font-medium text-white backdrop-blur-sm">
      <span aria-hidden>#</span>
      {label}
      {more ? <span className="opacity-80">+{more}</span> : null}
    </span>
  );
}

/**
 * A colour swatch is the one place a literal colour is legitimate — it is data from
 * the item, not a design decision. Falls back to the border token when the hex is
 * missing so the row never collapses.
 */
export function ColorDot({ hex, name }: { hex?: string | null; name?: string | null }) {
  if (!name && !hex) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-meta text-text-dim">
      <span
        aria-hidden
        className="h-3 w-3 shrink-0 rounded-full border border-border"
        style={hex ? { backgroundColor: hex } : undefined}
      />
      {name ?? hex}
    </span>
  );
}

export function StatRow({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-meta">
      <span className="text-text-dim">{label}</span>
      <span className="rounded-full bg-brand-100 px-2 py-0.5 text-chip font-medium text-brand-800">
        {count}
      </span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  line,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  line: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-[var(--radius-lg)] border border-border bg-surface px-6 py-16 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-brand-700">
        {icon}
      </span>
      <p className="text-section font-semibold tracking-tight">{title}</p>
      <p className="mt-1 max-w-sm text-body text-text-dim">{line}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Loading placeholder that matches the final card. Never a centred spinner on a grid. */
export function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface">
      <div className="aspect-square animate-pulse bg-brand-50" />
      <div className="space-y-2 p-4">
        <div className="h-4 w-3/4 animate-pulse rounded bg-brand-50" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-brand-50" />
      </div>
    </div>
  );
}

export const STYLE_LABELS: Record<Style, string> = {
  lounge: 'Lounge',
  workout: 'Workout',
  casual: 'Casual',
  'date-night': 'Date Night',
  party: 'Party',
  business: 'Business',
  formal: 'Formal',
};

export const SEASON_LABELS: Record<Season, string> = {
  summer: 'Summer',
  monsoon: 'Monsoon',
  winter: 'Winter',
  all: 'All Season',
};

export const seasonSummary = (seasons: Season[]): string =>
  seasons.length === 0
    ? 'Any season'
    : seasons.includes('all')
      ? SEASON_LABELS.all
      : seasons.map((s) => SEASON_LABELS[s]).join(' · ');
