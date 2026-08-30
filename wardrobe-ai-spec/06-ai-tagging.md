# 06 — AI tagging

**Scope:** TEST · **Depends on:** 05, 12 · **Owns:** `lib/gemini.ts`,
`app/api/items/tag/route.ts`, `ai_jobs`

## Responsibility

Turn an uploaded photo into structured garment attributes using Gemini's vision capability,
with a strict output schema, a hard budget check, and graceful failure.

## Contracts

`POST /api/items/tag` → see `api-contracts.md`. Returns `TagResult` merged into the item.

```ts
// lib/gemini.ts
export function tagGarment(imageUrl: string): Promise<TagResult>;
export function callModel<T>(opts: {
  prompt: string;
  imageUrl?: string;
  schema: object;          // JSON Schema, enforced via responseSchema
  maxOutputTokens: number;
}): Promise<{ data: T; inTokens: number; outTokens: number }>;
```

Model: `gemini-2.5-flash-lite`.

| Phase | Tier | Why |
|---|---|---|
| Test (15 users) | **free tier** | ~122 requests/day against a 1,500/day ceiling — 8%. Even 15 testers each bulk-uploading 30 items on one afternoon is 450, still 30%. |
| Production (5,000) | **pay-as-you-go** | ~1,250/day leaves no margin for a spike. ₹871/month total, of which tagging is ₹2.32. |

Attach the billing account during the test but leave it unused, so the switch is an env
change rather than a signup.

## Behaviour

### 1. Structured output is non-negotiable

Pass `responseSchema` and `responseMimeType: 'application/json'`. Then Zod-parse the result
anyway, because a schema-conforming response can still contain a `category` string that
isn't one of your six slots.

```ts
const TagSchema = z.object({
  slot: z.enum(['top','bottom','fullbody','outerwear','footwear','accessory']),
  categorySlug: z.string(),   // matched against the user's categories; falls back by slot
  subtype: z.string().max(40),
  primaryColor: z.string().max(24),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  secondaryColors: z.array(z.string().max(24)).max(3),
  pattern: z.enum(['solid','striped','checked','printed','textured']),
  material: z.string().max(30),
  formality: z.number().int().min(1).max(5),
  warmth: z.number().int().min(1).max(5),
  seasons: z.array(z.enum(['summer','monsoon','winter','all'])).min(1),
  style: z.enum(['lounge','workout','casual','date-night','party','business','formal']),
  confidence: z.number().min(0).max(1),
});
```

Free-text parsing fails on roughly one call in thirty and corrupts attribute data silently.
You would find out at scale, in data you cannot recover.

### 2. The prompt

Anchor every scale with concrete examples, or the model's idea of "formality 3" drifts
between calls.

```
You are cataloguing a single garment for a personal wardrobe app.
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
If it contains no garment, return slot "accessory" with confidence 0.
```

### 3. Order of operations

```
1. load item; if status = 'tagging', return early (concurrent call)
2. assertBudget(userId, 'tag')          ← module 12, BEFORE the model call
3. status → 'tagging'
4. signedUrl(item.storagePath, 300)     ← the bucket is private; the model gets a short-lived URL
5. callModel(...)  with 2 retries, exponential backoff on 429/5xx
6. Zod-parse; on failure treat as a model failure
7. resolve categorySlug → categories.id for this user (fall back to the system
   category whose default_slot matches); write attributes + ai_raw + ai_model
   + status 'ready'
8. recordUsage(userId, 'tag', inTokens, outTokens)   ← module 12
9. bump profiles.wardrobe_version
```

Budget check before the call, usage recorded after. Never the reverse — a crash between
would either bill you for free or block a user who was never served.

### 4. Failure

After retries: `status = 'failed'`, `last_error` stored, `503 AI_UNAVAILABLE` returned. The
grid shows the item with a retry button. The item is fully usable and editable throughout.

**Test phase:** that is the whole failure story. No queue. With 15 users you will hear about
failures directly, which is better signal than a queue draining silently.

**Production:** failures insert into `ai_jobs`, drained every 5 minutes by `pg_cron` calling
a worker route (module 15) with exponential backoff and a `dead` state after 3 attempts.
The table already exists in the schema; the drain job is commented out.

### 5. Bulk tagging

Tagging is sequential per item and each call takes 2–4 seconds against a 300-second function
limit, so no queue is needed. Client-side, tag with concurrency 2 after uploads complete, so
the grid fills in progressively while the user is still looking at it.

### 6. Persist `ai_raw`

Store the complete model response. When you change the prompt or switch models, you can
re-derive attributes from stored responses without re-billing the vision call — and you can
diff old against new to see what actually changed.

### 7. Correction rate

The metric this module is judged on: fraction of AI-populated fields the user subsequently
edits. Emitted by module 05's PATCH handler, queried in module 14.

Target under 25%. If a specific field is much worse — `material` and `formality` are the
hard ones from a single photo — that is a prompt problem you can see in a query rather than
guess at. Fix the prompt, not the schema.

## Acceptance

- [ ] tagging a clear photo of a shirt returns a valid `TagResult` in under 5 seconds
- [ ] a malformed model response is caught by Zod and surfaces as `AI_UNAVAILABLE`, never a
      partially-written item
- [ ] a user over their daily tag budget gets `AI_BUDGET_EXCEEDED` and no model call is made
- [ ] two concurrent tag calls for the same item result in one model call
- [ ] a failed item is editable and retryable from the grid
- [ ] `ai_raw`, `ai_model`, and `ai_confidence` are populated on success
- [ ] no live Gemini call in any test — fixtures only

## Out of scope

- Fine-tuning or embeddings. Prompt iteration against the correction rate is the whole
  quality strategy.
- Multi-garment detection in one photo. One photo, one item (module 04).
- Background removal.
- **Condition assessment.** `condition` is user-rated (module 18 §1) for the same reason
  `price` is (module 17 §3): a wrong value silently corrupts the retailer durability signal,
  which is the entire point of collecting it. Keep it out of the tag schema.
