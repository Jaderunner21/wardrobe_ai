/**
 * Gemini response parsing, against recorded fixtures — module 06 acceptance:
 * no live Gemini call in any test.
 *
 * The thing being defended here is module 06 §1: `responseSchema` is sent, and the
 * result is Zod-parsed anyway. A schema-conforming response can still carry a slot
 * that is not one of the six, and free-text parsing fails on roughly one call in
 * thirty. The failure is silent — corrupt attributes in data you cannot recover —
 * which is exactly the kind that needs a test rather than a code review.
 *
 * The fixtures are hand-authored to the documented response shape. Replace them with
 * genuine recorded responses the first time the live call runs; the assertions should
 * not need to change.
 */
import { describe, expect, it } from 'vitest';
import { parseModelResponse, parseTagResult, TagSchema } from '@/lib/gemini';
import { AppError } from '@/lib/errors';
import type { TagResult } from '@/types';

import shirt from './fixtures/gemini-tag-shirt.json';
import outOfRange from './fixtures/gemini-tag-out-of-range.json';
import badSlot from './fixtures/gemini-tag-bad-slot.json';
import truncated from './fixtures/gemini-truncated.json';
import blocked from './fixtures/gemini-blocked.json';

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return e instanceof AppError ? e.code : 'NOT_AN_APP_ERROR';
  }
  return 'DID_NOT_THROW';
};

describe('parseModelResponse', () => {
  it('extracts the JSON payload and the token counts', () => {
    const result = parseModelResponse<TagResult>(shirt);
    expect(result.data.subtype).toBe('oxford shirt');
    expect(result.inTokens).toBe(271);
    expect(result.outTokens).toBe(118);
  });

  it('keeps the whole response for ai_raw', () => {
    // Module 06 §6: stored so a prompt change can be re-derived without re-billing.
    expect(parseModelResponse(shirt).raw).toBe(shirt);
  });

  it('rejects a truncated response rather than half-parsing it', () => {
    // MAX_TOKENS leaves invalid JSON. Half a garment is worse than no garment.
    expect(codeOf(() => parseModelResponse(truncated))).toBe('AI_UNAVAILABLE');
  });

  it('rejects a blocked response with no content', () => {
    expect(codeOf(() => parseModelResponse(blocked))).toBe('AI_UNAVAILABLE');
  });

  it('rejects a response with no candidates at all', () => {
    expect(codeOf(() => parseModelResponse({ candidates: [] }))).toBe('AI_UNAVAILABLE');
    expect(codeOf(() => parseModelResponse({}))).toBe('AI_UNAVAILABLE');
  });

  it('treats missing usage metadata as zero rather than NaN', () => {
    const result = parseModelResponse({
      candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }],
    });
    expect(result.inTokens).toBe(0);
    expect(result.outTokens).toBe(0);
  });
});

describe('parseTagResult', () => {
  it('accepts a well-formed garment', () => {
    const tag = parseTagResult(parseModelResponse(shirt).data);
    expect(tag.slot).toBe('top');
    expect(tag.formality).toBe(3);
    expect(tag.seasons).toEqual(['summer', 'monsoon']);
    expect(tag.confidence).toBeCloseTo(0.92);
  });

  it('rejects a formality outside 1..5, which the DB check would refuse anyway', () => {
    expect(codeOf(() => parseTagResult(parseModelResponse(outOfRange).data))).toBe(
      'AI_UNAVAILABLE',
    );
  });

  it('rejects a slot the outfit engine cannot assemble on', () => {
    // "headwear" is schema-shaped and still meaningless to module 08.
    expect(codeOf(() => parseTagResult(parseModelResponse(badSlot).data))).toBe('AI_UNAVAILABLE');
  });

  it('rejects a colour that is not #rrggbb', () => {
    const base = TagSchema.parse(parseModelResponse(shirt).data);
    expect(codeOf(() => parseTagResult({ ...base, colorHex: 'light blue' }))).toBe(
      'AI_UNAVAILABLE',
    );
    expect(codeOf(() => parseTagResult({ ...base, colorHex: '#abc' }))).toBe('AI_UNAVAILABLE');
  });

  it('requires at least one season', () => {
    const base = TagSchema.parse(parseModelResponse(shirt).data);
    expect(codeOf(() => parseTagResult({ ...base, seasons: [] }))).toBe('AI_UNAVAILABLE');
  });

  it('accepts confidence 0 — the documented "no garment in this photo" answer', () => {
    const base = TagSchema.parse(parseModelResponse(shirt).data);
    expect(parseTagResult({ ...base, slot: 'accessory', confidence: 0 }).confidence).toBe(0);
  });

  it('does not accept a condition field — condition is user-rated only', () => {
    // Module 06 out-of-scope, module 18 §1: a guessed condition silently corrupts the
    // retailer durability signal, which is the entire point of collecting it.
    const base = TagSchema.parse(parseModelResponse(shirt).data);
    const tagged = parseTagResult({ ...base, condition: 4 });
    expect('condition' in tagged).toBe(false);
  });
});
