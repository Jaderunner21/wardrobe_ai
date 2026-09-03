/**
 * Sentry, server side — module 14 §4.
 *
 * Wired on the first deploy rather than after the first incident. With fifteen users you
 * get a stack trace instead of a message saying "it didn't work", and the difference
 * between those two is most of a week.
 *
 * INERT WITHOUT A DSN. `init` with no dsn is a no-op, so this file costs nothing until
 * `SENTRY_DSN` is set — which is the state through the whole test phase.
 *
 * Sampled at 100%: at this volume there is nothing to sample, and a sampled-away error
 * from one of fifteen testers is 7% of your evidence gone.
 */
import * as Sentry from '@sentry/nextjs';
import { scrubEvent } from '@/lib/sentry-scrub';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1,
  // §7 — you are recording people's wardrobes; do not also record their screens.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  // Request bodies can contain a whole item patch. The stack trace is the useful part.
  sendDefaultPii: false,
  beforeSend: (event) =>
    scrubEvent(event as unknown as Record<string, unknown>) as unknown as typeof event,
});
