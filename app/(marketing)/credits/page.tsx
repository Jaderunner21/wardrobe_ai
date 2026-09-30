/**
 * Photo credits for the garment photos on the landing page and in the demo wardrobes
 * (scripts/demo/fetch-stock.mjs writes the list). The Unsplash licence does not require
 * attribution; we link every photo anyway.
 */
import Link from 'next/link';
import credits from '@/scripts/demo/assets/credits.json';

export const metadata = { title: 'Photo credits — Wardrobe AI' };

interface Credit {
  title?: string | null;
  creator?: string | null;
  license: string;
  license_version?: string | null;
  landing?: string | null;
  source?: string | null;
}

const licenseLabel = (c: Credit) =>
  c.license === 'unsplash'
    ? 'Unsplash License'
    : c.license === 'pexels'
      ? 'Pexels License'
      : c.license === 'cc0'
      ? 'CC0'
      : `CC ${c.license.toUpperCase()} ${c.license_version ?? ''}`.trim();

const humanize = (key: string) => key.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

export default function CreditsPage() {
  const rows = Object.entries(credits as Record<string, Credit>).sort(([a], [b]) => a.localeCompare(b));

  return (
    <main className="mx-auto min-h-dvh max-w-3xl bg-bg px-4 py-16 text-text sm:px-6">
      <Link href="/" className="text-meta text-text-dim hover:text-text">← Wardrobe AI</Link>
      <h1 className="mt-6 font-display text-4xl font-bold">Photo credits</h1>
      <p className="mt-3 text-body text-text-dim">
        The garment photos on our landing page and in the demo wardrobes come from Unsplash.
        They were cropped and placed on a plain background. Thank you to every photographer
        below.
      </p>
      <ul className="mt-10 divide-y divide-border border-y border-border">
        {rows.map(([key, c]) => (
          <li key={key} className="flex flex-wrap items-baseline justify-between gap-2 py-3 text-meta">
            <span>
              {c.landing ? (
                <a href={c.landing} target="_blank" rel="noopener noreferrer" className="font-medium underline-offset-2 hover:underline">
                  {c.title || humanize(key)}
                </a>
              ) : (
                <span className="font-medium">{c.title || humanize(key)}</span>
              )}
              {c.creator && <span className="text-text-dim"> by {c.creator}</span>}
              {c.source && <span className="text-text-mute"> · {c.source}</span>}
            </span>
            <span className="text-text-mute">{licenseLabel(c)}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
