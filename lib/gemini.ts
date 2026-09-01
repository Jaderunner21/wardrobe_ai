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

export const MODEL = 'gemini-2.5-flash-lite';

const ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

/**
 * A schema-conforming response can still contain a `slot` that is not one of the six,
 * so the output is Zod-parsed even though `responseSchema` was sent. Free-text parsing
 * fails on roughly one call in thirty and corrupts attribute data silently — you find
 * out at scale, in data you cannot recover (module 06 §1).
 */
export const TagSchema = z.object({
  slot: z.enum(['top', 'bottom', 'fullbody', 'outerwear', 'footwear', 'accessory']),
  categorySlug: z.string(),
  subtype: z.string().max(40),
  primaryColor: z.string().max(24),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  secondaryColors: z.array(z.string().max(24)).max(3),
  pattern: z.enum(['solid', 'striped', 'checked', 'printed', 'textured']),
  material: z.string().max(30),
  formality: z.number().int().min(1).max(5),
  warmth: z.number().int().min(1).max(5),
  seasons: z.array(z.enum(['summer', 'monsoon', 'winter', 'all'])).min(1),
  style: z.enum(['lounge', 'workout', 'casual', 'date-night', 'party', 'business', 'formal']),
  confidence: z.number().min(0).max(1),
});

/** The same shape as JSON Schema, for `responseSchema`. */
const TAG_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
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

formality: 1 = loungewear/pyjamas · 2 = t-shirt, jeans · 3 = shirt, chinos ·
           4 = blazer, dress trousers · 5 = tuxedo, formal gown
warmth:    1 = single thin layer · 3 = sweatshirt, light jacket ·
           5 = heavy winter coat
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
