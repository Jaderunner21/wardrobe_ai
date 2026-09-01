'use client';

/**
 * The Review & Edit card — module 04 §5b, module 16 §4.
 *
 * This form is built before tagging exists, deliberately (module 05 §1). It gives a
 * product that works when Gemini is down or wrong, an escape hatch for garments the
 * model misreads, and — because the form already exists — the correction UI for free,
 * which is what produces the correction-rate metric.
 *
 * Purchase details stay collapsed and optional: they are user-entered only, and the
 * AI will never fill them (module 17 §3).
 */
import { useState } from 'react';
import { SEASONS, STYLES } from '@/app/api/items/schemas';
import { SEASON_LABELS, STYLE_LABELS } from '@/components/primitives';
import type { Category, Season, Style } from '@/types';

export interface DraftFields {
  name: string;
  categoryId: string;
  subtype: string;
  primaryColor: string;
  colorHex: string;
  style: string;
  seasons: Season[];
  brand: string;
  userTags: string;
  notes: string;
  price: string;
  purchasedOn: string;
  retailer: string;
}

export const emptyDraft = (): DraftFields => ({
  name: '',
  categoryId: '',
  subtype: '',
  primaryColor: '',
  colorHex: '',
  style: '',
  seasons: [],
  brand: '',
  userTags: '',
  notes: '',
  price: '',
  purchasedOn: '',
  retailer: '',
});

/**
 * Form state → PATCH body. Empty strings become null, never "" and never "unknown" —
 * module 16 §4 caught the prototype filing the literal string "unknown" as a brand,
 * where it sorts and filters like a real one.
 */
export function draftToPatch(fields: DraftFields, categories: Category[]) {
  const text = (value: string) => (value.trim() === '' ? null : value.trim());
  const category = categories.find((c) => c.id === fields.categoryId);

  return {
    name: text(fields.name),
    categoryId: fields.categoryId || null,
    // Slot is internal and never shown; without tagging it follows the category's
    // default, which is exactly what the field is for (module 16 §7.1).
    slot: category?.defaultSlot ?? null,
    subtype: text(fields.subtype),
    primaryColor: text(fields.primaryColor),
    colorHex: text(fields.colorHex),
    style: fields.style ? (fields.style as Style) : null,
    seasons: fields.seasons,
    brand: text(fields.brand),
    notes: text(fields.notes),
    userTags: fields.userTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    price: fields.price.trim() === '' ? null : Number(fields.price),
    purchasedOn: text(fields.purchasedOn),
    retailer: text(fields.retailer),
    status: 'draft' as const,
  };
}

export function ItemDraftForm({
  index,
  previewUrl,
  fields,
  categories,
  tag = 'skipped',
  confidence,
  tagError,
  onChange,
  onRemove,
  onRetryTag,
}: {
  index: number;
  previewUrl?: string;
  fields: DraftFields;
  categories: Category[];
  /** Tagging state for this card — module 06 §4: the item is editable throughout. */
  tag?: 'pending' | 'done' | 'failed' | 'skipped';
  confidence?: number | null;
  tagError?: string;
  onChange: (next: DraftFields) => void;
  onRemove: () => void;
  onRetryTag?: () => void;
}) {
  const [expanded, setExpanded] = useState(index === 0);
  const [showPurchase, setShowPurchase] = useState(false);

  const set = <K extends keyof DraftFields>(key: K, value: DraftFields[K]) =>
    onChange({ ...fields, [key]: value });

  const category = categories.find((c) => c.id === fields.categoryId);

  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
      <div className="flex items-start gap-4">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL, nothing to optimise
          <img
            src={previewUrl}
            alt=""
            width={72}
            height={72}
            className="h-18 w-18 shrink-0 rounded-[var(--radius)] object-cover"
          />
        ) : (
          <div className="h-18 w-18 shrink-0 rounded-[var(--radius)] bg-brand-50" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-card font-medium">
              {fields.name.trim() || `AI Analysis #${index + 1}`}
            </p>

            {tag === 'pending' && (
              <span className="animate-pulse rounded-full bg-brand-100 px-2 py-0.5 text-chip font-medium text-brand-800">
                Analysing…
              </span>
            )}
            {tag === 'done' && confidence != null && (
              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-chip font-medium text-brand-800">
                {Math.round(confidence * 100)}% confident
              </span>
            )}
            {tag === 'failed' && (
              <span className="rounded-full bg-danger-50 px-2 py-0.5 text-chip font-medium text-danger-600">
                Tagging failed
              </span>
            )}
            {tag === 'skipped' && (
              <span className="rounded-full bg-bg px-2 py-0.5 text-chip font-medium text-text-mute">
                Fill in by hand
              </span>
            )}
          </div>

          <p className="mt-0.5 text-meta text-text-dim">
            {[category?.name, fields.style ? STYLE_LABELS[fields.style as Style] : null, fields.primaryColor]
              .filter(Boolean)
              .join(' · ') || 'Not described yet'}
          </p>

          {tagError && (
            <p className="mt-0.5 text-meta text-text-mute">
              {tagError}
              {onRetryTag && (
                <button
                  type="button"
                  onClick={onRetryTag}
                  className="ml-2 font-medium text-brand-700 underline underline-offset-4"
                >
                  Retry
                </button>
              )}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 rounded-[var(--radius)] border border-border px-3 py-1.5 text-meta font-medium hover:bg-brand-50"
        >
          {expanded ? 'Collapse' : 'Edit Details'}
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove item ${index + 1} from this batch`}
          className="shrink-0 rounded-full px-2 py-1 text-meta text-text-mute hover:text-danger-600"
        >
          ×
        </button>
      </div>

      {expanded && (
        <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
          <Field label="Item name">
            <input
              value={fields.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Brown Leather Briefcase"
              className={inputClass}
            />
          </Field>

          <Field label="Category">
            <select
              value={fields.categoryId}
              onChange={(e) => set('categoryId', e.target.value)}
              className={inputClass}
            >
              <option value="">Choose one</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon ? `${c.icon} ` : ''}
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Type">
            <input
              value={fields.subtype}
              onChange={(e) => set('subtype', e.target.value)}
              list={`subtypes-${index}`}
              placeholder={category?.subtypes[0] ?? 'oxford shirt'}
              className={inputClass}
            />
            {/* The options come from the chosen category, which is the bug module 16 §4
                spotted in the prototype: Type empty while Category was Accessories. */}
            <datalist id={`subtypes-${index}`}>
              {(category?.subtypes ?? []).map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>

          <Field label="Colour">
            <div className="flex gap-2">
              <input
                value={fields.primaryColor}
                onChange={(e) => set('primaryColor', e.target.value)}
                placeholder="Navy"
                className={`${inputClass} flex-1`}
              />
              <input
                type="color"
                value={fields.colorHex || '#888888'}
                onChange={(e) => set('colorHex', e.target.value)}
                aria-label="Colour swatch"
                className="h-10 w-12 shrink-0 rounded-[var(--radius)] border border-border bg-bg"
              />
            </div>
          </Field>

          <Field label="Style">
            <select
              value={fields.style}
              onChange={(e) => set('style', e.target.value)}
              className={inputClass}
            >
              <option value="">Choose one</option>
              {STYLES.map((s) => (
                <option key={s} value={s}>
                  {STYLE_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Brand">
            <input
              value={fields.brand}
              onChange={(e) => set('brand', e.target.value)}
              placeholder="Uniqlo"
              className={inputClass}
            />
          </Field>

          <Field label="Season">
            <div className="flex flex-wrap gap-2">
              {SEASONS.map((season) => {
                const on = fields.seasons.includes(season);
                return (
                  <button
                    key={season}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      set(
                        'seasons',
                        on
                          ? fields.seasons.filter((s) => s !== season)
                          : [...fields.seasons, season],
                      )
                    }
                    className={[
                      'rounded-full px-3 py-1 text-chip font-medium transition-colors',
                      on ? 'bg-brand-100 text-brand-800' : 'bg-bg text-text-dim hover:bg-brand-50',
                    ].join(' ')}
                  >
                    {SEASON_LABELS[season]}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Tags">
            <input
              value={fields.userTags}
              onChange={(e) => set('userTags', e.target.value)}
              placeholder="comfortable, work, gift"
              className={inputClass}
            />
          </Field>

          <Field label="Notes" wide>
            <textarea
              value={fields.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={2}
              className={inputClass}
            />
          </Field>

          <div className="sm:col-span-2">
            <button
              type="button"
              onClick={() => setShowPurchase((v) => !v)}
              className="text-meta font-medium text-brand-700 underline underline-offset-4"
            >
              {showPurchase ? 'Hide purchase details' : 'Add purchase details (optional)'}
            </button>

            {showPurchase && (
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Field label="Price">
                  <input
                    value={fields.price}
                    onChange={(e) => set('price', e.target.value)}
                    inputMode="decimal"
                    placeholder="2499"
                    className={inputClass}
                  />
                </Field>
                <Field label="Bought on">
                  <input
                    type="date"
                    value={fields.purchasedOn}
                    onChange={(e) => set('purchasedOn', e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field label="Retailer">
                  <input
                    value={fields.retailer}
                    onChange={(e) => set('retailer', e.target.value)}
                    placeholder="Myntra"
                    className={inputClass}
                  />
                </Field>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

const inputClass =
  'w-full rounded-[var(--radius)] border border-border bg-bg px-3 py-2 text-body text-text placeholder:text-text-mute';

function Field({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1 block text-meta font-medium text-text-dim">{label}</span>
      {children}
    </label>
  );
}
