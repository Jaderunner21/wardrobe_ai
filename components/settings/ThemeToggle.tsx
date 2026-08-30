'use client';

/**
 * Dark mode — module 16 §1.
 *
 * The whole implementation is one attribute on <html>. Every colour in the app is a
 * token, so the swap is a repaint, not a redesign. The preference is stored per
 * device in localStorage and applied before first paint by the script in
 * app/layout.tsx.
 */
import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'dark' ? 'dark' : 'light');
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      // Private mode with storage disabled: the toggle still works for this session.
    }
  }

  const on = theme === 'dark';

  return (
    <ToggleRow
      label="Dark mode"
      description="Follows your system setting until you change it here."
      checked={on}
      onChange={(next) => apply(next ? 'dark' : 'light')}
    />
  );
}

export function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-border py-4 last:border-b-0">
      <div>
        <p className="text-card font-medium">{label}</p>
        <p className="text-meta text-text-dim">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={[
          'relative h-6 w-11 shrink-0 rounded-full transition-colors',
          checked ? 'bg-brand-500' : 'bg-border',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 h-5 w-5 rounded-full bg-surface transition-transform',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          ].join(' ')}
        />
      </button>
    </div>
  );
}
