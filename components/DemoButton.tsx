'use client';

/**
 * "Explore the demo" — signs into a seeded wardrobe server-side (app/api/auth/demo) and
 * hands off to /callback like every other way in.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ApiError } from '@/types';

export function DemoButton({
  className,
  children = 'Explore the demo',
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const [message, setMessage] = useState('');

  async function go() {
    setState('busy');
    const res = await fetch('/api/auth/demo', { method: 'POST' });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setMessage(body?.error.message ?? 'The demo is unavailable right now.');
      setState('failed');
      return;
    }
    router.replace('/callback?next=%2F');
  }

  return (
    <span className="inline-flex flex-col items-center">
      <button type="button" onClick={go} disabled={state === 'busy'} className={className}>
        {state === 'busy' ? 'Opening a wardrobe…' : children}
      </button>
      {state === 'failed' && (
        <span role="alert" className="mt-2 text-meta text-danger-600">
          {message}
        </span>
      )}
    </span>
  );
}
