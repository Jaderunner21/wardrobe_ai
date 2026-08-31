'use client';

/**
 * Sign-in — module 03 §1.
 *
 * Email OTP (magic link) and Google OAuth. No passwords: nothing to leak, nothing to
 * reset, and one less form.
 */
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { BrandMark } from '@/components/BrandMark';

type State = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'error'; message: string };

function LoginForm() {
  const params = useSearchParams();
  const next = params.get('next') ?? '/';
  const [email, setEmail] = useState('');
  // /callback bounces a failed or expired link back here with the reason.
  const [state, setState] = useState<State>(() => {
    const failure = params.get('error');
    return failure ? { kind: 'error', message: failure } : { kind: 'idle' };
  });

  const redirectTo = () =>
    `${window.location.origin}/callback?next=${encodeURIComponent(next)}`;

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setState({ kind: 'sending' });
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo() },
    });
    setState(error ? { kind: 'error', message: error.message } : { kind: 'sent' });
  }

  async function signInWithGoogle() {
    setState({ kind: 'sending' });
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectTo() },
    });
    if (error) setState({ kind: 'error', message: error.message });
  }

  if (state.kind === 'sent') {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[var(--radius)] bg-brand-100 text-brand-700">
          <MailGlyph />
        </div>
        <h1 className="text-section font-semibold">Check your email</h1>
        <p className="mt-2 text-body text-text-dim">
          We sent a sign-in link to <span className="text-text">{email}</span>. It expires in an
          hour.
        </p>
        <button
          type="button"
          className="mt-6 text-meta text-brand-700 underline underline-offset-4"
          onClick={() => setState({ kind: 'idle' })}
        >
          Use a different address
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-8 flex flex-col items-center text-center">
        <BrandMark size={72} />
        <span className="mt-3 text-section font-semibold tracking-tight">Wardrobe AI</span>
      </div>

      <h1 className="text-section font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-meta text-text-dim">
        No password. We send a link, or you can use Google.
      </p>

      <form onSubmit={sendMagicLink} className="mt-6 space-y-3">
        <label htmlFor="email" className="sr-only">
          Email address
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-[var(--radius)] border border-border bg-surface px-4 py-3 text-body text-text placeholder:text-text-mute"
        />
        <button
          type="submit"
          disabled={state.kind === 'sending'}
          className="w-full rounded-[var(--radius)] bg-brand-500 px-4 py-3 text-body font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
        >
          {state.kind === 'sending' ? 'Sending…' : 'Email me a link'}
        </button>
      </form>

      <div className="my-6 flex items-center gap-3 text-meta text-text-mute">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={state.kind === 'sending'}
        className="flex w-full items-center justify-center gap-2 rounded-[var(--radius)] border border-border bg-surface px-4 py-3 text-body font-medium text-text transition-colors hover:bg-brand-50 disabled:opacity-60"
      >
        <GoogleGlyph />
        Continue with Google
      </button>

      {state.kind === 'error' && (
        <p role="alert" className="mt-4 rounded-[var(--radius)] bg-danger-50 px-4 py-3 text-meta text-danger-600">
          {state.message}
        </p>
      )}
    </>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}

function MailGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

/**
 * The one deliberate exception to "no literal hex outside globals.css" (module 16 §1):
 * these are Google's brand colours on Google's mark. A brand mark that follows our
 * theme tokens is a brand mark we have altered.
 */
function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7c2.2-2 3.4-5 3.4-8.6Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3A11.9 11.9 0 0 0 12 24Z"
      />
      <path fill="#FBBC05" d="M5.6 14.7a7.1 7.1 0 0 1 0-4.5v-3H1.8a12 12 0 0 0 0 10.5l3.8-3Z" />
      <path
        fill="#EA4335"
        d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3A11.7 11.7 0 0 0 12 0 11.9 11.9 0 0 0 1.8 6.2l3.8 3C6.5 6.7 9 4.8 12 4.8Z"
      />
    </svg>
  );
}
