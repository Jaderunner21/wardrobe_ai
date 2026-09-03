'use client';

/**
 * Settings → Categories — module 16 §4 and §7.1.
 *
 * The list the sidebar filters on: name, emoji, subtype chips, a `Default` badge on the
 * nine seeded rows, and `+ Add Custom Category`. This is the last unmet line of module
 * 16's acceptance list — "a custom category can be created, assigned a slot, and
 * filtered on" — and the tab has been a placeholder since L0.
 *
 * WHY A SLOT HAS TO BE ASKED FOR. §7.1 split one concept into two because the prototype
 * and the spec were each right about half of it: `category_id` is what a person browses
 * by, `slot` is what the beam search assembles on, and neither can be derived from the
 * other. Activewear is the proof — a workout top is slot `top`, yoga pants are slot
 * `bottom`, same category. So a new category names its slot, and the wording here says
 * what the slot is for rather than exposing the enum as jargon.
 *
 * Outfit eligibility is offered for the same reason Underwear and Sleepwear ship with it
 * off: some categories are worth counting and browsing but should never be suggested.
 */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { SLOTS } from '@/app/api/items/schemas';
import type { ApiError, Category, Slot } from '@/types';

/** What the slot means to a person, rather than what it is called in the enum. */
const SLOT_LABELS: Record<Slot, string> = {
  top: 'Worn on top',
  bottom: 'Worn below the waist',
  fullbody: 'Covers both — a dress or a jumpsuit',
  outerwear: 'Worn over everything',
  footwear: 'On the feet',
  accessory: 'An accessory',
};

export function CategoriesPanel({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [slot, setSlot] = useState<Slot>('top');
  const [eligible, setEligible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);

    const response = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        icon: icon.trim() || null,
        defaultSlot: slot,
        outfitEligible: eligible,
      }),
    });

    setBusy(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ApiError | null;
      setError(body?.error.fields?.name ?? body?.error.message ?? 'Could not add that.');
      return;
    }

    setName('');
    setIcon('');
    setAdding(false);
    startTransition(() => router.refresh());
  }

  async function remove(category: Category) {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/categories/${category.id}`, { method: 'DELETE' });
    setBusy(false);

    if (!response.ok) {
      setError('Could not remove that one.');
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-6">
      <ul className="divide-y divide-border">
        {categories.map((category) => (
          <li key={category.id} className="py-4 first:pt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-card font-medium">
                {category.icon && <span aria-hidden>{category.icon} </span>}
                {category.name}
              </p>

              <div className="flex items-center gap-2">
                {category.userId === null ? (
                  <span className="rounded-full bg-bg px-2 py-0.5 text-chip font-medium text-text-mute">
                    Default
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => remove(category)}
                    className="text-meta font-medium text-danger-600 hover:underline disabled:opacity-60"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>

            <p className="mt-0.5 text-meta text-text-dim">
              {SLOT_LABELS[category.defaultSlot]}
              {/* Said plainly, because it is surprising otherwise: an item can be in
                  the wardrobe, counted and filterable, and still never be suggested. */}
              {!category.outfitEligible && ' · never suggested in an outfit'}
            </p>

            {category.subtypes.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {category.subtypes.map((subtype) => (
                  <span
                    key={subtype}
                    className="rounded-full bg-brand-100 px-2 py-0.5 text-chip font-medium text-brand-800"
                  >
                    {subtype}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="mt-6 space-y-3 border-t border-border pt-6">
          <div className="grid gap-3 sm:grid-cols-[1fr_5rem]">
            <label className="block">
              <span className="mb-1 block text-meta font-medium text-text-dim">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                placeholder="Ethnic Wear"
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-meta font-medium text-text-dim">Emoji</span>
              <input
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                maxLength={4}
                placeholder="🥻"
                className={inputClass}
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-meta font-medium text-text-dim">
              Where is it worn?
            </span>
            <select
              value={slot}
              onChange={(e) => setSlot(e.target.value as Slot)}
              className={inputClass}
            >
              {SLOTS.map((option) => (
                <option key={option} value={option}>
                  {SLOT_LABELS[option]}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-meta text-text-mute">
              How outfits are put together. Each item can still be changed on its own.
            </span>
          </label>

          <label className="flex items-center gap-2 text-meta text-text-dim">
            <input
              type="checkbox"
              checked={eligible}
              onChange={(e) => setEligible(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            Suggest these in outfits
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={create}
              disabled={busy || name.trim() === ''}
              className="rounded-[var(--radius)] bg-brand-500 px-4 py-2 text-meta font-medium text-white hover:bg-brand-600 disabled:opacity-60"
            >
              {busy ? 'Adding…' : 'Add category'}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
              disabled={busy}
              className="rounded-[var(--radius)] border border-border px-4 py-2 text-meta font-medium hover:bg-brand-50 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-6 rounded-[var(--radius)] border border-dashed border-brand-300 bg-brand-50 px-4 py-2 text-meta font-medium text-brand-800 hover:bg-brand-100"
        >
          + Add Custom Category
        </button>
      )}

      {error && (
        <p role="alert" className="mt-3 text-meta text-danger-600">
          {error}
        </p>
      )}
    </section>
  );
}

const inputClass =
  'w-full rounded-[var(--radius)] border border-border bg-bg px-3 py-2 text-body text-text placeholder:text-text-mute';
