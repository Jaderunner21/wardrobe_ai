'use client';

/**
 * Shell navigation — module 16 §2.
 *
 * Desktop: fixed white top bar, ~72px. Logo tile + wordmark left, six destinations
 * right. The active item is a brand-100 pill with brand-700 text.
 *
 * Mobile (< 768px): six items do not fit. Bottom tab bar with five — Dashboard,
 * Wardrobe, Upload (centre, elevated), Outfits, Settings. Bin moves into Settings.
 * People photograph clothes with a phone, so this is the primary upload surface, not
 * an afterthought.
 */
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import {
  HangerIcon,
  HomeIcon,
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

const DESTINATIONS: Destination[] = [
  { href: '/', label: 'Dashboard', Icon: HomeIcon, mobile: true },
  { href: '/upload', label: 'Upload', Icon: UploadIcon, mobile: true },
  { href: '/wardrobe', label: 'Wardrobe', Icon: HangerIcon, mobile: true },
  { href: '/outfits', label: 'Outfits', Icon: SparkleIcon, mobile: true },
  { href: '/bin', label: 'Bin', Icon: TrashIcon, mobile: false },
  { href: '/settings', label: 'Settings', Icon: SettingsIcon, mobile: true },
];

/** Mobile order puts Upload in the centre, elevated. */
const MOBILE_ORDER: Route[] = ['/', '/wardrobe', '/upload', '/outfits', '/settings'];

const isActive = (pathname: string, href: Route) =>
  href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

export function NavBar() {
  const pathname = usePathname();

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <div className="shell flex h-[72px] items-center justify-between gap-6">
          <Link href="/" className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] bg-brand-500 text-white"
            >
              <ShirtIcon size={18} />
            </span>
            <span className="text-card font-semibold tracking-tight">Wardrobe AI</span>
          </Link>

          <nav aria-label="Main" className="hidden md:block">
            <ul className="flex items-center gap-1">
              {DESTINATIONS.map(({ href, label, Icon }) => {
                const active = isActive(pathname, href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      className={[
                        'flex items-center gap-2 rounded-[var(--radius)] px-3 py-2 text-meta font-medium transition-colors',
                        active
                          ? 'bg-brand-100 text-brand-700'
                          : 'text-text-dim hover:bg-brand-50 hover:text-text',
                      ].join(' ')}
                    >
                      <Icon size={18} />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </header>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="flex items-stretch justify-around">
          {MOBILE_ORDER.map((href) => {
            const dest = DESTINATIONS.find((d) => d.href === href);
            if (!dest) return null;
            const { label, Icon } = dest;
            const active = isActive(pathname, href);
            const elevated = href === '/upload';

            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className="flex flex-col items-center gap-1 px-1 py-2 text-[11px] font-medium"
                >
                  <span
                    className={[
                      'flex h-9 w-9 items-center justify-center rounded-full transition-colors',
                      elevated
                        ? '-mt-5 h-12 w-12 bg-brand-500 text-white shadow-[var(--shadow-card)]'
                        : active
                          ? 'bg-brand-100 text-brand-700'
                          : 'text-text-mute',
                    ].join(' ')}
                  >
                    <Icon size={elevated ? 24 : 20} />
                  </span>
                  <span className={active && !elevated ? 'text-brand-700' : 'text-text-mute'}>
                    {label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
