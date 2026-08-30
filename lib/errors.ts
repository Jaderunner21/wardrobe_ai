/**
 * One shape for every API failure (module 01 — Error model).
 *
 * Never return a bare string, never a 500 with a stack trace. Client code switches
 * on `code`, never on `message`: messages are user-facing copy and will change,
 * codes are the contract.
 */
import type { ApiError, ErrorCode } from '@/types';

export type { ErrorCode };

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  ITEM_QUOTA_EXCEEDED: 409,
  DUPLICATE_ITEM: 409,
  PREMIUM_REQUIRED: 402,
  AI_BUDGET_EXCEEDED: 429,
  AI_UNAVAILABLE: 503,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status: number = STATUS[code],
    public fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errorBody = (e: AppError): ApiError => ({
  error: { code: e.code, message: e.message, fields: e.fields ?? null },
});

/** Default user-facing copy per code. Routes may pass their own. */
const MESSAGE: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'Sign in to continue.',
  FORBIDDEN: 'You do not have access to that.',
  NOT_FOUND: 'Not found.',
  VALIDATION_FAILED: 'Some fields need attention.',
  ITEM_QUOTA_EXCEEDED: 'Free plan is limited to 25 items.',
  DUPLICATE_ITEM: 'That photo is already in your wardrobe.',
  PREMIUM_REQUIRED: 'That feature is part of premium.',
  AI_BUDGET_EXCEEDED: "You've used today's AI allowance.",
  AI_UNAVAILABLE: 'Styling is unavailable right now. Try again shortly.',
  RATE_LIMITED: 'Too many requests. Slow down a moment.',
  INTERNAL: 'Something went wrong on our side.',
};

export const appError = (code: ErrorCode, message?: string, fields?: Record<string, string>) =>
  new AppError(code, message ?? MESSAGE[code], STATUS[code], fields);

/**
 * Postgres exceptions map to codes (module 01).
 *
 *   the quota trigger raises `ITEM_QUOTA_EXCEEDED` — matched on message
 *   the dedupe index raises 23505 on `items_dedupe_idx` — translated to DUPLICATE_ITEM
 *
 * Anything unrecognised becomes INTERNAL. It must never leak a Postgres message to
 * the client: those contain table and column names.
 */
export interface PgLikeError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

export function fromPostgres(e: PgLikeError): AppError {
  const message = e.message ?? '';
  const details = `${message} ${e.details ?? ''}`;

  if (message.includes('ITEM_QUOTA_EXCEEDED')) return appError('ITEM_QUOTA_EXCEEDED');
  if (e.code === '23505' && details.includes('items_dedupe_idx')) return appError('DUPLICATE_ITEM');
  if (e.code === '23505') return appError('VALIDATION_FAILED', 'That already exists.');
  if (message.includes('NOT_FOUND')) return appError('NOT_FOUND');
  if (message.startsWith('VALIDATION_FAILED')) {
    // functions raise `VALIDATION_FAILED: <user-safe reason>` (see 0005_wear_logging)
    const reason = message.slice('VALIDATION_FAILED:'.length).trim();
    return appError('VALIDATION_FAILED', reason || undefined);
  }
  // 42501 = insufficient_privilege — an RLS policy refused the row.
  if (e.code === '42501') return appError('FORBIDDEN');
  if (e.code === 'PGRST116') return appError('NOT_FOUND');

  return appError('INTERNAL');
}

/** Turn anything thrown inside a route handler into the one error shape. */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e && typeof e === 'object' && ('code' in e || 'message' in e)) {
    return fromPostgres(e as PgLikeError);
  }
  return appError('INTERNAL');
}
