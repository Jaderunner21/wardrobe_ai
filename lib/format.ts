/**
 * Date and preference formatting — module 16 §1 and §4. Pure.
 *
 * WHY THIS EXISTS AND NOT `toLocaleDateString()`. Module 16 §6.6 flags a real bug in the
 * prototype: "Member Since 8/28/2025" while the app reported 2026. A format where the
 * day and the month are both one or two digits and the order is decided by the browser
 * is a format in which a wrong date looks like a right one. So the format is a choice
 * the user makes and the app states, not something inferred from a locale header that
 * differs between the server render and the client hydration.
 *
 * Everything here takes the format as an argument. No module reads a preference for
 * itself — that is what makes these functions testable and what stops the server and
 * the browser disagreeing about what today looks like.
 */
import type { DateFormat, ItemSort, Preferences } from '@/types';

export const DEFAULT_DATE_FORMAT: DateFormat = 'dmy';
export const DEFAULT_SORT: ItemSort = 'recent';

export const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  dmy: '31/12/2026',
  mdy: '12/31/2026',
  iso: '2026-12-31',
  long: '31 December 2026',
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * A date-only string or a timestamp, in the chosen format. Dates are formatted from
 * their UTC parts: `purchased_on` is a Postgres `date` with no timezone, and running it
 * through a local-time constructor is how a purchase made on the 1st becomes the 31st
 * of the month before for anyone west of UTC.
 */
export function formatDate(
  value: string | null | undefined,
  format: DateFormat = DEFAULT_DATE_FORMAT,
): string {
  if (!value) return '—';

  const iso = value.slice(0, 10);
  const parsed = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed)) return '—';

  const date = new Date(parsed);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');

  switch (format) {
    case 'mdy':
      return `${pad(month)}/${pad(day)}/${year}`;
    case 'iso':
      return `${year}-${pad(month)}-${pad(day)}`;
    case 'long':
      return `${day} ${MONTHS[month - 1]} ${year}`;
    case 'dmy':
    default:
      return `${pad(day)}/${pad(month)}/${year}`;
  }
}

/**
 * jsonb comes back as whatever was last written to it, including by a version of the
 * app that is not this one. An unknown value is dropped rather than passed on: a bad
 * `defaultSort` reaching the wardrobe query would be a 400 on the user's own wardrobe.
 */
const DATE_FORMATS: DateFormat[] = ['dmy', 'mdy', 'iso', 'long'];
const SORTS: ItemSort[] = ['recent', 'least-worn', 'recently-worn', 'cost-per-wear'];

export function toPreferences(raw: unknown): Preferences {
  if (!raw || typeof raw !== 'object') return {};
  const record = raw as Record<string, unknown>;

  const preferences: Preferences = {};
  if (DATE_FORMATS.includes(record.dateFormat as DateFormat)) {
    preferences.dateFormat = record.dateFormat as DateFormat;
  }
  if (SORTS.includes(record.defaultSort as ItemSort)) {
    preferences.defaultSort = record.defaultSort as ItemSort;
  }
  if (record.wardrobeView === 'grid' || record.wardrobeView === 'list') {
    preferences.wardrobeView = record.wardrobeView;
  }
  return preferences;
}

export const dateFormatOf = (preferences: Preferences | undefined): DateFormat =>
  preferences?.dateFormat ?? DEFAULT_DATE_FORMAT;

export const defaultSortOf = (preferences: Preferences | undefined): ItemSort =>
  preferences?.defaultSort ?? DEFAULT_SORT;
