/**
 * Next.js loads this once per runtime at startup — module 14 §4's "wired on the first
 * deploy". The two configs are imported conditionally because the edge runtime cannot
 * load the Node SDK.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export { captureRequestError as onRequestError } from '@sentry/nextjs';
