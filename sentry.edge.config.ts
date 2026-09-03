/** Sentry for the edge runtime — module 14 §4. Same scrubbing, same inert-without-DSN. */
import * as Sentry from '@sentry/nextjs';
import { scrubEvent } from '@/lib/sentry-scrub';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1,
  sendDefaultPii: false,
  beforeSend: (event) =>
    scrubEvent(event as unknown as Record<string, unknown>) as unknown as typeof event,
});
