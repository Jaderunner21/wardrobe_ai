/**
 * Route handler plumbing. One place that turns a thrown error into the one error
 * shape from module 01, so no handler has to remember to.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { appError, errorBody, toAppError } from '@/lib/errors';

export const ok = <T>(body: T, init?: ResponseInit) => NextResponse.json(body, init);

/** Wrap a handler: anything it throws comes back as `{ error: { code, message } }`. */
export function handle<Args extends unknown[]>(
  fn: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (e) {
      const err = toAppError(e);
      if (err.status >= 500) {
        // The message may contain table and column names — log it, never send it.
        console.error('[api]', err.code, e);
      }
      return NextResponse.json(errorBody(err), { status: err.status });
    }
  };
}

/** Zod at every trust boundary (module 01 — Validation). */
export async function parseBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw appError('VALIDATION_FAILED', 'Expected a JSON body.');
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fields[issue.path.join('.') || '_'] = issue.message;
    }
    throw appError('VALIDATION_FAILED', undefined, fields);
  }
  return parsed.data;
}
