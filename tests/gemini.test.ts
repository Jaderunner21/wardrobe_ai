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
import rerank from './fixtures/gemini-rerank.json';
import rerankBadIndex from './fixtures/gemini-rerank-bad-index.json';
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

  it('clamps a formality outside 1..5 instead of throwing the whole tag away', () => {
    /**
     * The live model answers 0 on formality and warmth when it cannot tell — a blank
     * image, a garment it cannot read — and the DB check constraint would refuse that.
     * Rejecting the response would lose an otherwise good tag over one field, so it is
     * clamped into range; `confidence` is the honest "I do not know" signal, and every
     * one of these fields is editable on the Review screen.
     */
    const tag = parseTagResult(parseModelResponse(outOfRange).data);
    expect(tag.formality).toBe(5); // fixture says 7
    expect(parseTagResult({ ...tag, formality: 0, warmth: 0 }).formality).toBe(1);
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

/**
 * The rerank half of module 11. The model is ranking eight outfits the rules engine
 * already validated, so the only things that can go wrong are structural: an index that
 * is not one of the candidates, a duplicate, or a response that will not parse. All
 * three degrade to the rules order rather than erroring (module 11 §6), and all three
 * are cheap to get wrong silently.
 */
describe('rerank responses', () => {
  interface Ranked {
    ranked: { index: number; rationale: string }[];
  }

  it('parses a well-formed ranking', () => {
    const { data, inTokens, outTokens } = parseModelResponse<Ranked>(rerank);
    expect(data.ranked.map((r) => r.index)).toEqual([2, 0, 1]);
    expect(data.ranked[0]?.rationale).toContain('olive overshirt');
    expect(inTokens).toBe(412);
    expect(outTokens).toBe(96);
  });

  it('carries a rationale worth reading, not a mechanical one', () => {
    // Module 11 §5: this sentence is what a premium user is paying for.
    const { data } = parseModelResponse<Ranked>(rerank);
    for (const row of data.ranked) {
      expect(row.rationale.split(' ').length).toBeGreaterThan(6);
      expect(row.rationale.length).toBeLessThanOrEqual(400);
    }
  });

  it('exposes the out-of-range and duplicate indexes the caller has to drop', () => {
    // The fixture names a garment the user does not own, at an index that does not
    // exist. `rerankOutfits` filters both; this asserts the shape it filters on.
    const { data } = parseModelResponse<Ranked>(rerankBadIndex);
    expect(data.ranked.map((r) => r.index)).toEqual([9, 0, 0]);
  });
});
