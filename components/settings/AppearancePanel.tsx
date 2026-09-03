'use client';

/**
 * Appearance — module 16 §4, plus module 17 §2's target.
 *
 * The prototype's Appearance tab promised dark mode, date format and default sort, and
 * for a long time only the first of the three did anything. Module 16 §6.2's rule is
 * the one that decides what belongs here: *cut a setting with nothing behind it*. Size
 * Unit was cut because nothing has a size. These four all have something behind them —
 * a date format every screen renders through, a sort the wardrobe query orders by, a
 * currency module 17 formats money with, and a cost-per-wear target the History panel
 * measures progress against.
 *
 * Each control saves on change and says so. There is no Save button: five independent
 * preferences behind one button means a user who changes one and navigates away loses
 * it, and there is nothing here worth confirming.
 */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ThemeToggle } from '@/components/settings/ThemeToggle';
import { DATE_FORMAT_LABELS, dateFormatOf, defaultSortOf, formatDate } from '@/lib/format';
import type { DateFormat, ItemSort, Profile } from '@/types';

const SORT_LABELS: Record<ItemSort, string> = {
  recent: 'Newest first',
  'least-worn': 'Least worn',
  'recently-worn': 'Recently worn',
  'cost-per-wear': 'Cost per wear',
};

/**
 * The currencies the test group actually uses, plus the majors. A free-text ISO field
 * would accept "XYZ" and produce a formatter that throws; module 17's `formatMoney`
 * survives that, but offering the mistake is not a reason to handle it.
 */
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY'];

export function AppearancePanel({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [dateFormat, setDateFormat] = useState<DateFormat>(dateFormatOf(profile.preferences));
  const [defaultSort, setDefaultSort] = useState<ItemSort>(defaultSortOf(profile.preferences));
  const [currency, setCurrency] = useState(profile.currency);
  const [cpwTarget, setCpwTarget] = useState(String(profile.cpwTarget));

  async function save(field: string, body: Record<string, unknown>) {
    setSaving(field);
    setError(null);
    setSaved(null);

    const response = await fetch('/api/account', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    setSaving(null);
    if (!response.ok) {
      setError('That did not save.');
      return;
    }
    setSaved(field);
    startTransition(() => router.refresh());
  }

  const note = (field: string) =>
    saving === field ? 'Saving…' : saved === field ? 'Saved' : null;

  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-surface px-6 py-2">
      <ThemeToggle />

      <SelectRow
        label="Date format"
        description={`Dates read as ${formatDate('2026-12-31', dateFormat)}.`}
        note={note('dateFormat')}
        value={dateFormat}
        options={(Object.keys(DATE_FORMAT_LABELS) as DateFormat[]).map((key) => ({
          value: key,
          label: DATE_FORMAT_LABELS[key],
        }))}
        onChange={(value) => {
          setDateFormat(value as DateFormat);
          void save('dateFormat', { preferences: { dateFormat: value } });
        }}
      />

      <SelectRow
        label="Default wardrobe sort"
        description="How the wardrobe is ordered before you change it."
        note={note('defaultSort')}
        value={defaultSort}
        options={(Object.keys(SORT_LABELS) as ItemSort[]).map((key) => ({
          value: key,
          label: SORT_LABELS[key],
        }))}
        onChange={(value) => {
          setDefaultSort(value as ItemSort);
          void save('defaultSort', { preferences: { defaultSort: value } });
        }}
      />

      <SelectRow
        label="Currency"
        description="What prices and cost per wear are shown in."
        note={note('currency')}
        value={currency}
        options={CURRENCIES.map((code) => ({ value: code, label: code }))}
        onChange={(value) => {
          setCurrency(value);
          void save('currency', { currency: value });
        }}
      />

      {/* Module 17 §2: a target the user chose, and the wording stays on that side of
          the line — progress toward a goal, never a verdict on what they spent. */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-4 last:border-b-0">
        <div>
          <p className="text-card font-medium">Cost-per-wear target</p>
          <p className="text-meta text-text-dim">
            What you would like your clothes to cost per wearing. An item can override it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={cpwTarget}
            onChange={(e) => setCpwTarget(e.target.value.replace(/[^0-9.]/g, ''))}
            onBlur={() => {
              const value = Number(cpwTarget);
              if (!Number.isFinite(value) || value <= 0) {
                setCpwTarget(String(profile.cpwTarget));
                return;
              }
              if (value === profile.cpwTarget) return;
              void save('cpwTarget', { cpwTarget: value });
            }}
            inputMode="decimal"
            aria-label="Cost-per-wear target"
            className="w-24 rounded-[var(--radius)] border border-border bg-bg px-3 py-2 text-right text-body text-text"
          />
          <span className="w-14 text-meta text-text-mute">{note('cpwTarget') ?? currency}</span>
        </div>
      </div>

      {error && (
        <p role="alert" className="pb-4 text-meta text-danger-600">
          {error}
        </p>
      )}
    </section>
  );
}

/** Module 16 §3's `SelectRow`: label + description + native select. */
export function SelectRow({
  label,
  description,
  note,
  value,
  options,
  onChange,
}: {
  label: string;
  description: string;
  note?: string | null;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-4 last:border-b-0">
      <div>
        <p className="text-card font-medium">{label}</p>
        <p className="text-meta text-text-dim">{note ?? description}</p>
      </div>
      <select
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-[var(--radius)] border border-border bg-bg px-3 py-2 text-meta text-text"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
