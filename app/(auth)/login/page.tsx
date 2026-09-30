'use client';

/**
 * Sign in / create account — module 03 §1.
 *
 * WHY A PASSWORD FORM AND NOT A MAGIC LINK. Supabase's built-in mailer sends 2 emails an
 * hour per project, so any flow that emails on sign-up fails for the third person in an
 * hour. Accounts are created server-side already confirmed (app/api/auth/signup), and
 * nothing is ever emailed. `/callback` still handles `token_hash`, so magic links are a
 * UI change once custom SMTP exists (docs/email-smtp.md).
 *
 * The demo button signs into a seeded wardrobe without the visitor ever seeing a
 * password (app/api/auth/demo).
 */
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { BrandMark } from '@/components/BrandMark';
import type { ApiError } from '@/types';

type Mode = 'signin' | 'signup';
type State =
  | { kind: 'idle' }
  | { kind: 'busy'; what: 'form' | 'demo' | 'google' }
  | { kind: 'error'; message: string };

const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_ENABLE_GOOGLE === 'true';

const errorMessage = async (res: Response, fallback: string) => {
  const body = (await res.json().catch(() => null)) as ApiError | null;
  return body?.error.message ?? fallback;
};

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/';
  const [mode, setMode] = useState<Mode>(params.get('mode') === 'signup' ? 'signup' : 'signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<State>(() => {
    const failure = params.get('error');
    return failure ? { kind: 'error', message: failure } : { kind: 'idle' };
  });

  /**
   * Hand off to /callback rather than pushing `next` directly: the server has not seen
   * the new session cookie yet, and /callback is where `signup` is tracked for every way
   * of getting in (module 14).
   */
  const enter = (to = next) => router.replace(`/callback?next=${encodeURIComponent(to)}`);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState({ kind: 'busy', what: 'form' });
    const supabase = createClient();

    if (mode === 'signup') {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      if (!res.ok) {
        setState({ kind: 'error', message: await errorMessage(res, 'Could not create your account.') });
        return;
      }
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setState({
        kind: 'error',
        message:
          mode === 'signin'
            ? 'That email and password do not match an account.'
            : 'Your account was created, but signing in failed. Try signing in.',
      });
      return;
    }
    // A brand-new wardrobe starts with the first upload.
    enter(mode === 'signup' && next === '/' ? '/upload' : next);
  }

  async function exploreDemo() {
    setState({ kind: 'busy', what: 'demo' });
    const res = await fetch('/api/auth/demo', { method: 'POST' });
    if (!res.ok) {
      setState({ kind: 'error', message: await errorMessage(res, 'The demo is unavailable right now.') });
      return;
    }
    enter('/');
  }

  async function signInWithGoogle() {
    setState({ kind: 'busy', what: 'google' });
    const { error } = await createClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) setState({ kind: 'error', message: error.message });
  }

  const busy = state.kind === 'busy';
  const switchMode = (m: Mode) => {
    setMode(m);
    if (state.kind === 'error') setState({ kind: 'idle' });
  };

  return (
    <>
      <Link href="/" className="mb-10 flex items-center gap-3 lg:hidden">
        <BrandMark size={40} />
        <span className="font-display text-xl font-bold tracking-tight">Wardrobe AI</span>
      </Link>

      <h1 className="font-display text-3xl font-bold tracking-tight">
        {mode === 'signin' ? 'Welcome back' : 'Create your wardrobe'}
      </h1>
      <p className="mt-2 text-body text-text-dim">
        {mode === 'signin'
          ? 'Sign in to see today’s outfit.'
          : 'Free, and ready in under a minute. No email confirmation.'}
      </p>

      <div role="tablist" className="mt-8 grid grid-cols-2 rounded-[var(--radius)] bg-brand-50 p-1">
        {(['signin', 'signup'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => switchMode(m)}
            className={`rounded-[var(--radius-sm)] py-2 text-meta font-medium transition-colors ${
              mode === m ? 'bg-surface text-text shadow-[var(--shadow-card)]' : 'text-text-dim hover:text-text'
            }`}
          >
            {m === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-5 space-y-3">
        {mode === 'signup' && (
          <Field label="Your name">
            <input
              required
              autoComplete="name"
              placeholder="Ananya Iyer"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </Field>
        )}
        <Field label="Email">
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            required
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            minLength={mode === 'signup' ? 8 : 6}
            placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </Field>

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-[var(--radius)] bg-brand-500 px-4 py-3 text-body font-semibold text-on-brand transition-colors hover:bg-brand-600 disabled:opacity-60"
        >
          {state.kind === 'busy' && state.what === 'form'
            ? 'One moment…'
            : mode === 'signin'
              ? 'Sign in'
              : 'Create account'}
        </button>
      </form>

      {state.kind === 'error' && (
        <p role="alert" className="mt-4 rounded-[var(--radius)] bg-danger-50 px-4 py-3 text-meta text-danger-600">
          {state.message}
        </p>
      )}

      <div className="my-6 flex items-center gap-3 text-meta text-text-mute">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="space-y-3">
        <button
          type="button"
          onClick={exploreDemo}
          disabled={busy}
          className="w-full rounded-[var(--radius)] border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-brand-50 disabled:opacity-60"
        >
          <span className="block text-body font-semibold">
            {state.kind === 'busy' && state.what === 'demo' ? 'Opening a demo wardrobe…' : 'Explore a demo wardrobe →'}
          </span>
          <span className="mt-0.5 block text-meta text-text-dim">
            Look around a fully stocked wardrobe. No account needed.
          </span>
        </button>

        {GOOGLE_ENABLED && (
          <button
            type="button"
            onClick={signInWithGoogle}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-[var(--radius)] border border-border bg-surface px-4 py-3 text-body font-medium text-text transition-colors hover:bg-brand-50 disabled:opacity-60"
          >
            <GoogleGlyph />
            Continue with Google
          </button>
        )}
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-meta font-medium text-text-dim">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  'w-full rounded-[var(--radius)] border border-border bg-surface px-4 py-3 text-body text-text placeholder:text-text-mute focus:border-brand-500 focus:outline-none';

/** The garments on the brand panel — the same photos the demo wardrobes use. */
const PANEL = ['camel-trench', 'white-sneakers', 'floral-midi-dress', 'navy-blazer', 'tan-tote', 'indigo-slim-jeans'];

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh bg-bg lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-rail p-12 text-rail-strong lg:flex lg:flex-col">
        <Link href="/" className="flex items-center gap-3">
          <BrandMark size={40} />
          <span className="font-display text-xl font-bold tracking-tight">Wardrobe AI</span>
        </Link>
        <div className="mt-auto">
          <div className="mb-10 grid max-w-md grid-cols-3 gap-3">
            {PANEL.map((key, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={key}
                src={`/landing/${key}.webp`}
                alt=""
                width={160}
                height={160}
                className={`aspect-square w-full rounded-[var(--radius-lg)] object-cover ${i % 2 ? 'translate-y-6' : ''}`}
              />
            ))}
          </div>
          <p className="max-w-md font-display text-4xl font-bold leading-tight">
            Get dressed from what you already own.
          </p>
          <p className="mt-4 max-w-md text-rail-text">
            Photograph each piece once. Every morning, an outfit picked for your weather, your
            plans, and your style.
          </p>
        </div>
      </aside>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
      </section>
    </main>
  );
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.6 12.2c0-.8-.1-1.4-.2-2H12v3.9h6c-.1 1-.8 2.5-2.2 3.5l3.4 2.6c2-1.8 3.4-4.6 3.4-8Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.9 0 5.3-1 7.1-2.6l-3.4-2.6c-.9.6-2.1 1.1-3.7 1.1-2.8 0-5.2-1.9-6.1-4.5l-3.5 2.7C4.2 20.5 7.8 23 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.9 14.4a6.7 6.7 0 0 1 0-4.3L2.4 7.4a11 11 0 0 0 0 9.7l3.5-2.7Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.4c2 0 3.3.9 4.1 1.6l3-2.9C17.3 2.4 14.9 1.4 12 1.4 7.8 1.4 4.2 3.9 2.4 7.4l3.5 2.7C6.8 7.5 9.2 5.4 12 5.4Z"
      />
    </svg>
  );
}
