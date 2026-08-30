/**
 * Postgres error -> ErrorCode mapping (module 01, module 15 CI step 3).
 *
 * Cheap to test, expensive to get wrong: a miss here is a silent wrong status code,
 * and the client switches on the code.
 */
import { describe, expect, it } from 'vitest';
import { appError, errorBody, fromPostgres, toAppError, AppError } from '@/lib/errors';
import type { ErrorCode } from '@/types';

describe('fromPostgres', () => {
  it('maps the quota trigger to ITEM_QUOTA_EXCEEDED with 409', () => {
    // schema.sql raises the bare string with errcode check_violation.
    const e = fromPostgres({ code: '23514', message: 'ITEM_QUOTA_EXCEEDED' });
    expect(e.code).toBe('ITEM_QUOTA_EXCEEDED');
    expect(e.status).toBe(409);
  });

  it('maps a dedupe index violation to DUPLICATE_ITEM', () => {
    const e = fromPostgres({
      code: '23505',
      message: 'duplicate key value violates unique constraint "items_dedupe_idx"',
    });
    expect(e.code).toBe('DUPLICATE_ITEM');
    expect(e.status).toBe(409);
  });

  it('maps other unique violations to VALIDATION_FAILED, not DUPLICATE_ITEM', () => {
    const e = fromPostgres({
      code: '23505',
      message: 'duplicate key value violates unique constraint "categories_user_slug_idx"',
    });
    expect(e.code).toBe('VALIDATION_FAILED');
    expect(e.status).toBe(400);
  });

  it('maps NOT_FOUND raised by rate_condition and log_wear', () => {
    expect(fromPostgres({ code: 'P0001', message: 'NOT_FOUND' }).code).toBe('NOT_FOUND');
  });

  it('carries the reason from a VALIDATION_FAILED raise', () => {
    const e = fromPostgres({
      code: 'P0001',
      message: 'VALIDATION_FAILED: cannot log a wear in the future',
    });
    expect(e.code).toBe('VALIDATION_FAILED');
    expect(e.message).toBe('cannot log a wear in the future');
  });

  it('maps an RLS refusal to FORBIDDEN', () => {
    expect(fromPostgres({ code: '42501', message: 'permission denied' }).code).toBe('FORBIDDEN');
  });

  it('never leaks an unrecognised Postgres message', () => {
    const e = fromPostgres({
      code: '42P01',
      message: 'relation "items" does not exist',
    });
    expect(e.code).toBe('INTERNAL');
    expect(e.status).toBe(500);
    expect(e.message).not.toContain('items');
  });
});

describe('toAppError', () => {
  it('passes an AppError through untouched', () => {
    const original = appError('PREMIUM_REQUIRED');
    expect(toAppError(original)).toBe(original);
  });

  it('turns anything unrecognisable into INTERNAL', () => {
    expect(toAppError('kaboom').code).toBe('INTERNAL');
    expect(toAppError(null).code).toBe('INTERNAL');
  });
});

describe('errorBody', () => {
  it('is the shape api-contracts.md promises', () => {
    const body = errorBody(new AppError('VALIDATION_FAILED', 'Some fields need attention.', 400, { name: 'Required' }));
    expect(body).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Some fields need attention.',
        fields: { name: 'Required' },
      },
    });
  });

  it('sends fields as null rather than omitting them', () => {
    expect(errorBody(appError('NOT_FOUND')).error.fields).toBeNull();
  });
});

describe('status codes', () => {
  it('matches the table in module 01', () => {
    const expected: Record<ErrorCode, number> = {
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
    for (const [code, status] of Object.entries(expected)) {
      expect(appError(code as ErrorCode).status).toBe(status);
    }
  });
});
