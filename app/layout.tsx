import type { Metadata, Viewport } from 'next';
import { Playfair_Display, Plus_Jakarta_Sans } from 'next/font/google';
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

/*
 * Headings only — see --font-display in globals.css. Weights are pinned to the two the
 * app actually sets rather than loading the whole variable range: a display face used
 * on one line per screen does not earn 400KB.
 */
const playfair = Playfair_Display({
  subsets: ['latin'],
  display: 'swap',
  weight: ['600', '700'],
  variable: '--font-playfair',
});

export const metadata: Metadata = {
  title: 'Wardrobe AI',
  description: 'Your wardrobe, photographed once and dressed every day.',
  // The favicon is app/icon.svg (Next's file convention) — the same drawing as
  // components/BrandMark.tsx.
};

export const viewport: Viewport = {
  // Matches --bg in globals.css for each theme. The browser paints this behind the
  // page and around the notch, so a stale value here shows as a seam at the top.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbf8f6' },
    { media: '(prefers-color-scheme: dark)', color: '#141110' },
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
    /*
     * The font classes go on <html>, NOT <body>.
     *
     * next/font emits `--font-jakarta` on whatever element carries the class. The
     * stacks that consume it are declared on `:root` in globals.css, and a custom
     * property declared on :root that references a variable defined only on <body>
     * is invalid at computed-value time — it resolves to nothing, silently. That is
     * why the app rendered in the system font from L0 until this was found: nothing
     * errors, the page just looks very slightly wrong forever.
     */
    <html lang="en" className={`${jakarta.variable} ${playfair.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
