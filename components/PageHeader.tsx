/**
 * Page title block — module 16 §1 type scale (page title 40/1.1 semibold).
 */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[32px] font-semibold leading-tight tracking-tight md:text-page">
          {title}
        </h1>
        {subtitle && <p className="mt-2 text-body text-text-dim">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * Scaffolding for a screen whose module has not been built yet. It names the module
 * and the layer, so an empty screen reads as "not yet" rather than "broken".
 * Every one of these is deleted by the module that owns the screen.
 */
export function NotBuiltYet({ module: mod, layer }: { module: string; layer: string }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-dashed border-brand-300 bg-brand-50 px-6 py-10 text-center">
      <p className="text-body font-medium text-brand-800">This screen arrives with {mod}.</p>
      <p className="mt-1 text-meta text-text-dim">
        Build layer {layer}. The shell, tokens, auth and database beneath it are done.
      </p>
    </div>
  );
}
