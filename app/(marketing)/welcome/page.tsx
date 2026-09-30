/**
 * The public landing page. Signed-out visitors see it at `/` (middleware rewrites).
 *
 * Every colour is a token (module 16 §1). The garment photos are the same openly
 * licensed ones the demo wardrobes use — credited on /credits.
 */
import Link from 'next/link';
import { BrandMark } from '@/components/BrandMark';
import { DemoButton } from '@/components/DemoButton';
import { CalendarIcon, GridIcon, HangerIcon, ShirtIcon, SparkleIcon, UploadIcon } from '@/components/icons';

export const metadata = {
  title: 'Wardrobe AI — get dressed from what you already own',
};

const img = (key: string) => `/landing/${key}.webp`;

const OUTFIT = [
  { key: 'ivory-silk-blouse', label: 'Ivory satin blouse' },
  { key: 'black-tailored-trousers', label: 'Black slim trousers' },
  { key: 'camel-trench', label: 'Camel trench' },
  { key: 'block-heels', label: 'Nude block heels' },
];

const STEPS = [
  {
    n: '01',
    title: 'Photograph it once',
    body: 'Snap a few pieces at a time. AI fills in the category, colour, fabric and season, and you can fix anything it gets wrong.',
    icon: UploadIcon,
  },
  {
    n: '02',
    title: 'Get today’s outfit',
    body: 'Every morning, a complete look from your own clothes, matched to your city’s forecast and the plan for the day.',
    icon: SparkleIcon,
  },
  {
    n: '03',
    title: 'It learns your taste',
    body: 'Log what you wore and rate suggestions. Colours you skip stop showing up; pieces you love show up more.',
    icon: HangerIcon,
  },
];

const FEATURES = [
  { title: 'AI tagging', body: 'Category, colour, pattern, fabric, formality and warmth read from a single photo.', icon: SparkleIcon },
  { title: 'Weather-aware outfits', body: 'Linen when it’s 34°, layers when the monsoon rolls in. Built around Indian seasons.', icon: ShirtIcon },
  { title: 'Outfit planner', body: 'Save looks you like and put them on the calendar for the week ahead.', icon: CalendarIcon },
  { title: 'Cost per wear', body: 'See what each piece really costs you, and which ones are earning their place.', icon: GridIcon },
  { title: 'Wear & condition', body: 'Track how often you wear things and how they’re holding up, shop by shop.', icon: HangerIcon },
  { title: 'Private by design', body: 'Your photos live in a private store only you can read. Export or delete everything anytime.', icon: UploadIcon },
];

const GRID = [
  'white-oxford-shirt', 'floral-midi-dress', 'denim-jacket', 'white-sneakers',
  'emerald-saree', 'navy-blazer', 'tan-tote', 'khaki-chinos',
  'mustard-anarkali', 'leather-watch', 'black-slip-dress', 'brown-loafers',
];

const primaryBtn =
  'inline-flex items-center justify-center rounded-[var(--radius)] bg-brand-500 px-6 py-3 text-body font-semibold text-on-brand transition-colors hover:bg-brand-600';
const secondaryBtn =
  'inline-flex items-center justify-center rounded-[var(--radius)] border border-border bg-surface px-6 py-3 text-body font-semibold text-text transition-colors hover:bg-brand-50';

export default function WelcomePage() {
  return (
    <main className="min-h-dvh overflow-x-hidden bg-bg text-text">
      {/* ─────────────── nav */}
      <header className="sticky top-0 z-20 border-b border-border/70 bg-bg/85 backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <BrandMark size={32} />
            <span className="font-display text-xl font-bold tracking-tight">Wardrobe AI</span>
          </Link>
          <div className="flex items-center gap-1 sm:gap-2">
            <a href="#how" className="hidden px-3 py-2 text-meta font-medium text-text-dim hover:text-text md:block">How it works</a>
            <a href="#features" className="hidden px-3 py-2 text-meta font-medium text-text-dim hover:text-text md:block">Features</a>
            <Link href="/login" className="px-3 py-2 text-meta font-semibold text-text-dim hover:text-text">Sign in</Link>
            <Link href="/login?mode=signup" className="rounded-[var(--radius)] bg-brand-500 px-4 py-2 text-meta font-semibold text-on-brand hover:bg-brand-600">
              Get started
            </Link>
          </div>
        </nav>
      </header>

      {/* ─────────────── hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pt-24">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-meta text-text-dim">
            <SparkleIcon size={14} /> Your AI stylist, working from your own closet
          </span>
          <h1 className="mt-6 font-display text-5xl font-bold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
            Get dressed from what you <em className="text-brand-700">already</em> own.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-text-dim">
            Photograph each piece once. Wardrobe AI organises your closet and puts together an
            outfit every morning, matched to your weather, your plans and your style.
          </p>
          <div className="mt-9 flex flex-wrap items-start gap-3">
            <Link href="/login?mode=signup" className={primaryBtn}>Create your wardrobe</Link>
            <DemoButton className={secondaryBtn}>Explore the demo →</DemoButton>
          </div>
          <p className="mt-4 text-meta text-text-mute">Free · no email confirmation · works on your phone</p>
        </div>

        {/* the product, not a picture of it */}
        <div className="relative mx-auto w-full max-w-md">
          <div className="absolute -inset-6 -z-10 rounded-[32px] bg-brand-100/60 blur-2xl" aria-hidden />
          <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-meta text-text-mute">Today · Bengaluru</p>
                <p className="font-display text-2xl font-bold">Today’s outfit</p>
              </div>
              <span className="rounded-full bg-brand-100 px-3 py-1 text-meta font-medium text-brand-800">☁ 24° · light rain</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {OUTFIT.map((o) => (
                <figure key={o.key} className="overflow-hidden rounded-[var(--radius)] bg-brand-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img(o.key)} alt={o.label} width={220} height={220} className="aspect-square w-full object-cover" />
                  <figcaption className="px-2.5 py-2 text-meta text-text-dim">{o.label}</figcaption>
                </figure>
              ))}
            </div>
            <p className="mt-4 rounded-[var(--radius)] bg-brand-50 px-3.5 py-3 text-meta leading-relaxed text-text-dim">
              <span className="font-semibold text-text">Why this works: </span>
              neutrals that pair with anything, and the trench handles the afternoon showers.
              You haven’t worn the blouse in three weeks.
            </p>
            <div className="mt-4 flex gap-2">
              <span className="flex-1 rounded-[var(--radius)] bg-brand-500 py-2.5 text-center text-meta font-semibold text-on-brand">Wear this</span>
              <span className="flex-1 rounded-[var(--radius)] border border-border py-2.5 text-center text-meta font-semibold">Another option</span>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────── wardrobe strip */}
      <section aria-label="A wardrobe in Wardrobe AI" className="border-y border-border bg-surface py-10">
        <div className="mx-auto grid max-w-6xl grid-cols-4 gap-3 px-4 sm:grid-cols-6 sm:px-6 lg:grid-cols-12">
          {GRID.map((key, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={key}
              src={img(key)}
              alt=""
              width={120}
              height={120}
              className={`aspect-square w-full rounded-[var(--radius)] bg-brand-50 object-cover ${i >= 8 ? 'hidden lg:block' : ''} ${i >= 4 && i < 8 ? 'hidden sm:block' : ''}`}
            />
          ))}
        </div>
      </section>

      {/* ─────────────── how */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
        <p className="text-meta font-semibold uppercase tracking-[0.14em] text-text-mute">How it works</p>
        <h2 className="mt-3 max-w-2xl font-display text-4xl font-bold leading-tight sm:text-5xl">
          From camera roll to a daily outfit in minutes.
        </h2>
        <ol className="mt-14 grid gap-6 md:grid-cols-3">
          {STEPS.map(({ n, title, body, icon: Icon }) => (
            <li key={n} className="rounded-[var(--radius-lg)] border border-border bg-surface p-7">
              <div className="flex items-center justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-[var(--radius)] bg-brand-100 text-brand-800">
                  <Icon size={20} />
                </span>
                <span className="font-display text-3xl font-bold text-brand-300">{n}</span>
              </div>
              <h3 className="mt-6 text-card font-semibold">{title}</h3>
              <p className="mt-2 text-body text-text-dim">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ─────────────── features */}
      <section id="features" className="scroll-mt-20 bg-surface py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="text-meta font-semibold uppercase tracking-[0.14em] text-text-mute">Features</p>
          <h2 className="mt-3 max-w-2xl font-display text-4xl font-bold leading-tight sm:text-5xl">
            Built around the clothes you have. Not the ones you’re sold.
          </h2>
          <div className="mt-14 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ title, body, icon: Icon }) => (
              <article key={title}>
                <span className="flex h-10 w-10 items-center justify-center rounded-[var(--radius)] bg-brand-50 text-brand-700">
                  <Icon size={19} />
                </span>
                <h3 className="mt-4 text-card font-semibold">{title}</h3>
                <p className="mt-2 text-body text-text-dim">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────── cta */}
      <section className="px-4 py-24 sm:px-6">
        <div className="mx-auto max-w-4xl rounded-[28px] bg-rail px-6 py-16 text-center text-rail-strong sm:px-12">
          <h2 className="font-display text-4xl font-bold leading-tight sm:text-5xl">Open your wardrobe.</h2>
          <p className="mx-auto mt-4 max-w-lg text-rail-text">
            Create an account in under a minute, or look around a fully stocked demo wardrobe first.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link href="/login?mode=signup" className="inline-flex items-center justify-center rounded-[var(--radius)] bg-rail-strong px-6 py-3 text-body font-semibold text-rail hover:opacity-90">
              Create your wardrobe
            </Link>
            <DemoButton className="inline-flex items-center justify-center rounded-[var(--radius)] border border-rail-line px-6 py-3 text-body font-semibold text-rail-strong hover:bg-rail-hover">
              Explore the demo →
            </DemoButton>
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-meta text-text-mute sm:px-6">
          <span className="flex items-center gap-2">
            <BrandMark size={22} /> Wardrobe AI
          </span>
          <span className="flex gap-5">
            <Link href="/login" className="hover:text-text">Sign in</Link>
            <Link href="/credits" className="hover:text-text">Photo credits</Link>
          </span>
        </div>
      </footer>
    </main>
  );
}
