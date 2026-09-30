'use client';

/**
 * Shell navigation — module 16 §2.
 *
 * Desktop (md+): a fixed dark sidebar, 272px. The near-black rail against the cream
 * content is what makes the content read as the object and the navigation recede —
 * it does the job a border would otherwise have to do, and does it better.
 *
 * Mobile (< 768px): unchanged, and deliberately. A 272px rail cannot collapse into a
 * phone, and module 16's acceptance asks for a bottom tab bar with Upload elevated in
 * the centre: people photograph clothes with a phone, so that is the primary upload
 * surface rather than an afterthought.
 *
 * The rail is dark in BOTH themes. Every other surface swaps; this one does not,
 * because the sidebar is the app's frame rather than part of its page, and a frame
 * that changes colour with the content stops being a frame.
 */
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import {
  CalendarIcon,
  GridIcon,
  HangerIcon,
  SettingsIcon,
  ShirtIcon,
  SparkleIcon,
  TrashIcon,
  UploadIcon,
} from '@/components/icons';

type Destination = {
  href: Route;
  label: string;
  Icon: (props: { size?: number; className?: string }) => React.ReactElement;
  /** Bin lives in Settings on mobile. */
  mobile: boolean;
};

/**
 * `/planner` is here for the first time. The page has existed since module 09 and was
 * reachable only by typing the URL — a whole screen nobody could find.
 */
const PRIMARY: Destination[] = [
  { href: '/', label: 'Dashboard', Icon: GridIcon, mobile: true },
  { href: '/wardrobe', label: 'Wardrobe', Icon: HangerIcon, mobile: true },
  { href: '/upload', label: 'Upload', Icon: UploadIcon, mobile: true },
  { href: '/outfits', label: 'Outfits', Icon: SparkleIcon, mobile: true },
  { href: '/planner', label: 'Calendar', Icon: CalendarIcon, mobile: false },
];

/** Below the divider: the things you visit occasionally rather than daily. */
const SECONDARY: Destination[] = [
  { href: '/settings', label: 'Settings', Icon: SettingsIcon, mobile: true },
  { href: '/bin', label: 'Bin', Icon: TrashIcon, mobile: false },
];

const ALL = [...PRIMARY, ...SECONDARY];

/** Mobile order puts Upload in the centre, elevated. */
const MOBILE_ORDER: Route[] = ['/', '/wardrobe', '/upload', '/outfits', '/settings'];

const isActive = (pathname: string, href: Route) =>
  href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

export function NavBar({ email, displayName }: { email?: string; displayName?: string | null }) {
  const pathname = usePathname();
  const initial = (displayName ?? email ?? '?').trim().charAt(0).toUpperCase();

  return (
    <>
      {/* ───────────────────────────────────────────────── desktop rail */}
      <aside
        className="fixed inset-y-0 left-0 z-30 hidden w-[272px] flex-col bg-rail text-rail-text md:flex"
        aria-label="Main"
      >
        <Link
          href="/"
          className="flex h-[88px] shrink-0 items-center gap-3 border-b border-rail-line px-6"
        >
          <span
            aria-hidden
            className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] bg-brand-100 text-rail"
          >
            <ShirtIcon size={21} />
          </span>
          <span className="font-display text-[19px] font-bold tracking-tight text-rail-strong">
            Wardrobe AI
          </span>
        </Link>

        <nav className="flex-1 overflow-y-auto px-4 py-5">
          <ul className="space-y-1">
            {PRIMARY.map((d) => (
              <RailItem key={d.href} {...d} active={isActive(pathname, d.href)} />
            ))}
          </ul>

          <hr className="my-5 border-rail-line" />

          <ul className="space-y-1">
            {SECONDARY.map((d) => (
              <RailItem key={d.href} {...d} active={isActive(pathname, d.href)} />
            ))}
          </ul>
        </nav>

        {/*
          Who you are signed in as. It is the last thing in the rail because it is the
          thing you look at least — but on a product holding photographs of your own
          clothes, "which account is this" should never need a click to answer.
        */}
        <div className="flex shrink-0 items-center gap-3 border-t border-rail-line px-6 py-4">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rail-active text-meta font-semibold text-rail-strong"
          >
            {initial}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-meta font-medium text-rail-strong">
              {displayName ?? 'Your account'}
            </span>
            <span className="block truncate text-chip text-rail-muted">{email}</span>
          </span>
        </div>
      </aside>

      {/* ───────────────────────────────────────────────── mobile tabs */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="flex items-stretch justify-around">
          {MOBILE_ORDER.map((href) => {
            const dest = ALL.find((d) => d.href === href);
            if (!dest) return null;

            const active = isActive(pathname, href);
            const elevated = href === '/upload';

            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'flex flex-col items-center gap-1 py-2.5 text-chip font-medium transition-colors',
                    elevated
                      ? 'text-brand-700'
                      : active
                        ? 'text-brand-700'
                        : 'text-text-mute hover:text-text-dim',
                  ].join(' ')}
                >
                  <span
                    className={
                      elevated
                        ? 'flex h-10 w-10 items-center justify-center rounded-full bg-brand-500 text-on-brand'
                        : ''
                    }
                  >
                    <dest.Icon size={20} />
                  </span>
                  {dest.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

/**
 * One rail row. The active state is a filled block rather than a tinted pill: on a dark
 * rail a tint is nearly invisible, and the whole point of the row is to be findable
 * without reading it.
 */
function RailItem({
  href,
  label,
  Icon,
  active,
}: Destination & { active: boolean }) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={[
          'flex items-center gap-3 rounded-[var(--radius)] px-4 py-3 text-body font-medium transition-colors',
          active
            ? 'bg-rail-active text-rail-strong'
            : 'text-rail-text hover:bg-rail-hover hover:text-rail-strong',
        ].join(' ')}
      >
        <Icon size={19} />
        {label}
      </Link>
    </li>
  );
}
