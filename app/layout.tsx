import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

/*
 * Loaded through next/font, not a <link> — a stylesheet link to Google Fonts blocks
 * render (module 16 §1).
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jakarta',
});

export const metadata: Metadata = {
  title: 'Wardrobe AI',
  description: 'Your wardrobe, photographed once and dressed every day.',
  // The same file the login page shows (components/BrandMark.tsx) — one asset, the
  // two places the mark is meant to appear.
  icons: { icon: '/logo.png', apple: '/logo.png' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#121311' },
  ],
};

/*
 * Applies the saved theme before first paint. Without it the page flashes light on
 * every load for a user who chose dark — the toggle in Settings is a promise, and a
 * flash is the promise being broken twice a day.
 */
const THEME_SCRIPT = `
try {
  var saved = localStorage.getItem('theme');
  var theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className={jakarta.variable}>{children}</body>
    </html>
  );
}
