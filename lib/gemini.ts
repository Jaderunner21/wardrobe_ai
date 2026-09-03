/**
 * Gemini calls, schema enforcement, retries — module 06. Server only.
 *
 * NOTHING HERE CHECKS THE BUDGET. `assertBudget` is the caller's job, before it gets
 * this far (module 12 §1), and `scripts/check-budget-guard.sh` fails the build if a
 * call site forgets. This file is the wrapper the guard is applied around, which is
 * why it is the one file that grep exempts.
 *
 * Raw fetch rather than an SDK: the request is three fields, the SDK is a dependency
 * that would need pinning and auditing, and the retry policy here is specific enough
 * that we would be fighting it anyway.
 */
import 'server-only';
import { z } from 'zod';
import { appError } from '@/lib/errors';
import { serverEnv } from '@/lib/env';
import type { TagResult } from '@/types';

/**
 * DIVERGES from module 06, which pins `gemini-2.5-flash-lite`. That model now returns
 * 404 for new API keys — "no longer available to new users… use models/
 * gemini-3.5-flash-lite" — so every tagging call failed with AI_UNAVAILABLE and every
 * upload landed in the Review step blank. Same family, same price band, same latency
 * (~2s for a tag). Verified against the live API before changing.
 */
export const MODEL = 'gemini-3.5-flash-lite';

const ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

/**
 * A schema-conforming response can still contain a `slot` that is not one of the six,
 * so the output is Zod-parsed even though `responseSchema` was sent. Free-text parsing
 * fails on roughly one call in thirty and corrupts attribute data silently — you find
 * out at scale, in data you cannot recover (module 06 §1).
 */
export const TagSchema = z.object({
  /** Module 05 §2b: what a person recognises in a grid of 60 thumbnails. */
  name: z.string().max(60).optional(),
  slot: z.enum(['top', 'bottom', 'fullbody', 'outerwear', 'footwear', 'accessory']),
  categorySlug: z.string(),
  subtype: z.string().max(40),
  primaryColor: z.string().max(24),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  secondaryColors: z.array(z.string().max(24)).max(3),
  pattern: z.enum(['solid', 'striped', 'checked', 'printed', 'textured']),
  material: z.string().max(30),
  /**
   * The model answers 0 on these when it cannot tell — a blank image, a garment it
   * cannot read. Clamping into range keeps an otherwise good tag rather than throwing
   * the whole thing away: `confidence` is the honest signal for "I do not know", and
   * every one of these fields is editable on the Review screen anyway.
   */
  formality: z.number().int().catch(3).transform((n) => Math.min(5, Math.max(1, n))),
  warmth: z.number().int().catch(3).transform((n) => Math.min(5, Math.max(1, n))),
  seasons: z.array(z.enum(['summer', 'monsoon', 'winter', 'all'])).min(1),
  style: z.enum(['lounge', 'workout', 'casual', 'date-night', 'party', 'business', 'formal']),
  confidence: z.number().min(0).max(1),
});

/** The same shape as JSON Schema, for `responseSchema`. */
const TAG_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    slot: { type: 'string', enum: ['top', 'bottom', 'fullbody', 'outerwear', 'footwear', 'accessory'] },
    categorySlug: { type: 'string' },
    subtype: { type: 'string' },
    primaryColor: { type: 'string' },
    colorHex: { type: 'string' },
    secondaryColors: { type: 'array', items: { type: 'string' } },
    pattern: { type: 'string', enum: ['solid', 'striped', 'checked', 'printed', 'textured'] },
    material: { type: 'string' },
    formality: { type: 'integer' },
    warmth: { type: 'integer' },
    seasons: { type: 'array', items: { type: 'string', enum: ['summer', 'monsoon', 'winter', 'all'] } },
    style: {
      type: 'string',
      enum: ['lounge', 'workout', 'casual', 'date-night', 'party', 'business', 'formal'],
    },
    confidence: { type: 'number' },
  },
  required: [
    'name',
    'slot',
    'categorySlug',
    'subtype',
    'primaryColor',
    'colorHex',
    'secondaryColors',
    'pattern',
    'material',
    'formality',
    'warmth',
    'seasons',
    'style',
    'confidence',
  ],
} as const;

/**
 * Every scale is anchored with concrete examples, or the model's idea of "formality 3"
 * drifts between calls (module 06 §2).
 */
const TAG_PROMPT = `You are cataloguing a single garment for a personal wardrobe app.
Return only the JSON described by the schema.

formality: an integer 1-5, never 0. 1 = loungewear/pyjamas · 2 = t-shirt, jeans ·
           3 = shirt, chinos · 4 = blazer, dress trousers · 5 = tuxedo, formal gown
warmth:    an integer 1-5, never 0. 1 = single thin layer ·
           3 = sweatshirt, light jacket · 5 = heavy winter coat
name:      a short human name for the garment, as a person would say it —
           "Brown Leather Briefcase", "Navy Oxford Shirt". Title case, under 5 words.
seasons:   pick every season the garment is wearable in; use ["all"] if unrestricted.
           Assume an Indian climate: hot summers, humid monsoon, mild winters.
colorHex:  the dominant colour of the fabric, not the background or any shadow.
confidence: your own certainty, 0-1. Be honest — a low score is more useful than a
           confident guess.

categorySlug: one of the user's categories, listed below. Prefer a specific one
           (activewear, sleepwear, underwear) over the generic slot category when the
           garment clearly belongs there.
style:     the single occasion this garment is most typically worn for.

If the image contains more than one garment, describe the most prominent one.
If it contains no garment, return slot "accessory" with confidence 0.`;

export interface ModelResult<T> {
  data: T;
  inTokens: number;
  outTokens: number;
  /** The complete response, stored in `items.ai_raw` (module 06 §6). */
  raw: unknown;
}

interface CallOptions {
  prompt: string;
  imageUrl?: string;
  schema: object;
  maxOutputTokens: number;
}

const RETRY_DELAYS_MS = [500, 1500];

export async function callModel<T>(opts: CallOptions): Promise<ModelResult<T>> {
  const apiKey = serverEnv().GEMINI_API_KEY;
  if (!apiKey) throw appError('AI_UNAVAILABLE', 'Tagging is not configured.');

  const parts: unknown[] = [{ text: opts.prompt }];

  if (opts.imageUrl) {
    // The bucket is private, so the caller hands us a short-lived signed URL and we
    // inline the bytes: the Gemini API takes base64 or its own File API, never an
    // arbitrary third-party URL.
    const image = await fetch(opts.imageUrl);
    if (!image.ok) throw appError('AI_UNAVAILABLE', 'Could not read that photo.');
    const bytes = Buffer.from(await image.arrayBuffer());
    parts.push({
      inline_data: {
        mime_type: image.headers.get('content-type') ?? 'image/webp',
        data: bytes.toString('base64'),
      },
    });
  }

  const body = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: opts.schema,
      maxOutputTokens: opts.maxOutputTokens,
      temperature: 0.2,
    },
  });

  let lastError: unknown = null;

  // Two retries, exponential backoff, on 429 and 5xx only. A 400 is a bad request and
  // retrying it just spends the budget twice.
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(ENDPOINT(MODEL), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body,
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        lastError = new Error(`gemini ${response.status}`);
        if (!retryable) break;
      } else {
        return parseModelResponse<T>(await response.json());
      }
    } catch (e) {
      lastError = e;
    }

    const delay = RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) await new Promise((resolve) => setTimeout(resolve, delay));
  }

  console.error('[gemini] call failed after retries', lastError);
  throw appError('AI_UNAVAILABLE');
}

/**
 * Pulled out of `callModel` so it can be tested against recorded fixtures without a
 * network call — module 06 acceptance: no live Gemini call in any test.
 */
export function parseModelResponse<T>(payload: unknown): ModelResult<T> {
  const envelope = z
    .object({
      candidates: z
        .array(
          z.object({
            content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }).optional(),
            finishReason: z.string().optional(),
          }),
        )
        .min(1),
      usageMetadata: z
        .object({
          promptTokenCount: z.number().optional(),
          candidatesTokenCount: z.number().optional(),
        })
        .optional(),
    })
    .safeParse(payload);

  if (!envelope.success) throw appError('AI_UNAVAILABLE');

  const candidate = envelope.data.candidates[0];

  // MAX_TOKENS means the JSON is truncated — it will not parse, and half a garment is
  // worse than no garment.
  if (candidate?.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason)) {
    throw appError('AI_UNAVAILABLE');
  }

  const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text.trim()) throw appError('AI_UNAVAILABLE');

  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw appError('AI_UNAVAILABLE');
  }

  return {
    data,
    inTokens: envelope.data.usageMetadata?.promptTokenCount ?? 0,
    outTokens: envelope.data.usageMetadata?.candidatesTokenCount ?? 0,
    raw: payload,
  };
}

/** Validates a model payload into a TagResult, or throws AI_UNAVAILABLE. */
export function parseTagResult(data: unknown): TagResult {
  const parsed = TagSchema.safeParse(data);
  if (!parsed.success) {
    console.error('[gemini] response failed schema', parsed.error.issues);
    throw appError('AI_UNAVAILABLE');
  }
  return parsed.data as TagResult;
}

/**
 * One garment, one photo. `categorySlugs` are the caller's own categories, so the
 * model picks from what the user actually has rather than inventing one.
 */
export async function tagGarment(
  imageUrl: string,
  categorySlugs: string[],
): Promise<ModelResult<TagResult>> {
  const result = await callModel<unknown>({
    prompt: `${TAG_PROMPT}\n\nThe user's categories: ${categorySlugs.join(', ')}`,
    imageUrl,
    schema: TAG_RESPONSE_SCHEMA,
    maxOutputTokens: 512,
  });

  return { ...result, data: parseTagResult(result.data) };
}

// ─────────────────────────────────────────────────────────── rerank (module 11 §4)

/**
 * The premium recommendation path:
 *
 *   rules engine → top 8 candidates → ONE model call → reordered top 5 + a rationale
 *
 * The model is not inventing outfits. It is picking among eight the rules engine already
 * validated, and explaining them. That distinction is what keeps this cheap, fast, and
 * structurally incapable of suggesting a garment the user does not own.
 *
 * NOTE: the caller must have called assertBudget(userId, 'rerank') first, and must
 * recordUsage after. This file is the wrapper the guard is applied around.
 */
const RERANK_SCHEMA = {
  type: 'object',
  properties: {
    ranked: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          rationale: { type: 'string' },
        },
        required: ['index', 'rationale'],
      },
    },
  },
  required: ['ranked'],
} as const;

const RerankSchema = z.object({
  ranked: z
    .array(
      z.object({
        index: z.number().int().min(0),
        rationale: z.string().min(1).max(400),
      }),
    )
    .min(1),
});

export interface RerankCandidate {
  /** One line per outfit: what it is, and why the rules engine liked it. */
  description: string;
}

const RERANK_PROMPT = `You are a personal stylist. Below are outfits assembled from a
single person's own wardrobe, each with the scores that selected it.

Rank them best first and write one sentence for each saying why it works. Reference the
actual garments and the weather where it is relevant — "the olive overshirt breaks up the
navy, and it is cool enough this evening to justify the extra layer" is the register.

Rules:
- Rank only the outfits given. Never mention a garment that is not in one of them.
- Never suggest buying anything.
- One sentence each, under 30 words, no preamble.
- Return every outfit exactly once, by its index.`;

export async function rerankOutfits(
  candidates: RerankCandidate[],
  context: string,
): Promise<ModelResult<{ ranked: { index: number; rationale: string }[] }>> {
  const lines = candidates.map((c, i) => `${i}. ${c.description}`).join('\n');

  const result = await callModel<unknown>({
    prompt: `${RERANK_PROMPT}\n\n${context}\n\nOUTFITS:\n${lines}`,
    schema: RERANK_SCHEMA,
    maxOutputTokens: 400,
  });

  const parsed = RerankSchema.safeParse(result.data);
  if (!parsed.success) {
    console.error('[gemini] rerank failed schema', parsed.error.issues);
    throw appError('AI_UNAVAILABLE');
  }

  // An index the model invented would silently drop or duplicate an outfit.
  const valid = parsed.data.ranked.filter((r) => r.index >= 0 && r.index < candidates.length);
  if (valid.length === 0) throw appError('AI_UNAVAILABLE');

  return { ...result, data: { ranked: dedupeByIndex(valid) } };
}

const dedupeByIndex = <T extends { index: number }>(rows: T[]): T[] => {
  const seen = new Set<number>();
  return rows.filter((r) => (seen.has(r.index) ? false : (seen.add(r.index), true)));
};

// ═══════════════════════════════════════════ outfit selection (module 19)

/**
 * Module 19: the model does the SELECTING, not just the ranking.
 *
 * Module 08's scoring survives as the fallback, and this is why it has to: the model
 * returns garment ids, and an id it was not given means it invented a garment. Nothing
 * here trusts the response — the caller checks every id against the candidate set it
 * sent, and `lib/recommender/ai.ts` is where that happens.
 *
 * `stretch` is module 19 §4's dial made explicit rather than left to prompt vibes. Four
 * outfits inside the learned profile, one deliberate step outside it, LABELLED — because
 * an unexplained odd suggestion reads as the AI being wrong, and a labelled one reads as
 * an offer the user can accept or refuse.
 */
const SELECT_SCHEMA = {
  type: 'object',
  properties: {
    outfits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          itemIds: { type: 'array', items: { type: 'string' } },
          rationale: { type: 'string' },
          stretch: { type: 'boolean' },
        },
        required: ['itemIds', 'rationale', 'stretch'],
      },
    },
  },
  required: ['outfits'],
} as const;

const SelectSchema = z.object({
  outfits: z
    .array(
      z.object({
        itemIds: z.array(z.string().min(1)).min(2).max(6),
        rationale: z.string().min(1).max(400),
        stretch: z.boolean().catch(false),
      }),
    )
    .min(1),
});

export interface SelectedOutfit {
  itemIds: string[];
  rationale: string;
  stretch: boolean;
}

const SELECT_PROMPT = `You are a stylist. Build outfits from ONLY the garments listed below.

RULES
  - Every outfit needs a top and a bottom, or one full-body garment.
  - Include footwear when it is listed. Include outerwear only if the weather calls for it.
  - Use only the ids listed. Never invent a garment.
  - No two outfits may share more than one garment.
  - Prefer garments not worn recently.
  - Respect the avoid list and the never-pair list absolutely.
  - Make the LAST outfit one deliberate stretch: a pairing this person has not tried,
    still inside the never-pair rules, with stretch set to true. Every other outfit has
    stretch set to false.
  - The rationale references the actual garments and the weather where it matters. One or
    two sentences, no preamble, never suggest buying anything.`;

export async function selectOutfits(
  candidateLines: string[],
  context: string,
  count: number,
): Promise<ModelResult<{ outfits: SelectedOutfit[] }>> {
  const result = await callModel<unknown>({
    prompt: [
      SELECT_PROMPT.replace('Build outfits', `Build ${count} outfits`),
      `\nCONTEXT\n${context}`,
      `\nCANDIDATES\n${candidateLines.join('\n')}`,
    ].join('\n'),
    schema: SELECT_SCHEMA,
    // ~80 tokens of JSON per outfit plus its rationale, with room for a long one.
    maxOutputTokens: 200 * count,
  });

  const parsed = SelectSchema.safeParse(result.data);
  if (!parsed.success) {
    console.error('[gemini] selection failed schema', parsed.error.issues);
    throw appError('AI_UNAVAILABLE');
  }

  return { ...result, data: { outfits: parsed.data.outfits } };
}
