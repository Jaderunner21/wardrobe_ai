# 11 — Stylist chat & LLM layer

**Scope:** TEST — everything runs on the Gemini free tier · **Depends on:** 05, 12 · **Owns:** `app/api/chat/route.ts`,
`app/(app)/chat`, the rerank path in `lib/gemini.ts`

## Responsibility

Two LLM surfaces on top of everything the rules engine already does: conversational styling
grounded in the user's actual wardrobe, and a rerank pass that writes the human-readable
reason an outfit works.

Both are premium. Both are capped. Both degrade to something useful when they fail.

## Contracts

`POST /api/chat` — streams, premium only. See `api-contracts.md`.

```ts
export function rerank(
  candidates: Recommendation[],
  ctx: RecommendationContext,
): Promise<Recommendation[]>;   // reordered, `rationale` filled, source 'llm'
```

## Behaviour

### 1. Wardrobe grounding — the compact summary

The model needs to know what the user owns. Sending 200 item rows as JSON would be ~8,000
tokens per message and is the fastest way to make chat expensive.

Send a compact summary instead — roughly 300 tokens for any wardrobe size:

```
WARDROBE (47 items)
tops (14): 4 white/cream, 3 navy, 2 olive, 2 black, 3 patterned · formality 2-4
bottoms (9): 3 blue denim, 2 beige chino, 2 black, 2 grey · formality 2-4
outerwear (4): navy blazer, grey overshirt, black puffer, denim jacket
footwear (6): white sneakers, brown loafers, black boots, running shoes
accessories (14)
RECENTLY WORN: navy top + beige chino (2d), white top + black bottom (4d)
PREFERS: navy, olive · AVOIDS: mustard · never pairs navy with black
```

Build it from the same `RecommendationContext` the rules engine uses. When the user asks
about something specific ("pair something with my black jeans"), resolve the referenced item
by name match and include its full attributes — but only that one.

### 2. Chat is grounded, not free-associating

System prompt, in substance:

> You are a personal stylist with access to this user's actual wardrobe, summarised below.
> Recommend only from what they own. If they ask about something they do not have, say so
> plainly rather than inventing it. Keep answers under 80 words unless asked for detail. Do
> not suggest purchases.

The last clause matters. Unprompted shopping suggestions are the fastest way to make the
product feel like an affiliate funnel, and shopping is explicitly out of scope (module 00).

### 3. Context window discipline

- last 8 messages only
- wardrobe summary regenerated per request, not carried in history
- `maxOutputTokens: 400`

At ~2,600 input and ~420 output tokens per message on Flash-Lite, one message costs about
₹0.038. Twenty a day per premium user is the cap in `AI_LIMITS`.

### 4. Rationale, and rerank during the test run

The premium recommendation path:

```
rules engine → top 8 candidates → ONE model call → reordered top 5 + rationale each
```

Input is the 8 candidates as compact descriptions plus their score terms, not full items.
Output is a JSON array of `{ index, rationale }` — schema-enforced, Zod-parsed.

One call per `(user, occasion, day)`, cached alongside the rules result. Not one call per
recommendation, and never one per refresh.

The model is not being asked to invent outfits. It is picking among eight the rules engine
already validated and explaining them. That distinction is what keeps it cheap, fast, and
incapable of suggesting a garment the user does not own.

### 5. What the user is actually paying for

This sentence:

> "The olive overshirt breaks up the navy, and it's cool enough this evening to justify the
> extra layer."

The rules engine can produce a mechanical version (module 08 §6). The model produces one
worth reading. That is a real difference and it is a reasonable thing to charge for — it is
not worth a model call for a free user refreshing a feed, and it is absolutely worth one for
a paying user getting dressed.

### 6. Failure degrades, never errors

| Failure | Behaviour |
|---|---|
| Rerank call fails | return rules-engine order with mechanical rationale, `source: 'rules'`. Never a 5xx. |
| Chat budget exhausted | `429 AI_BUDGET_EXCEEDED` before the stream opens, with a message saying when it resets |
| Chat model fails mid-stream | emit a stream error part; the UI keeps the partial response and offers retry |
| User is free plan | `402 PREMIUM_REQUIRED` |

### 7. Test phase

All 15 testers are premium (module 03) with raised limits (`AI_LIMITS_TEST`), on the Gemini
free tier. Chat at 9 daily-active testers × 10 messages is ~90 calls/day — 6% of the
1,500/day free ceiling. The whole feature set together, chat included, peaks at 38% of that
ceiling on the heaviest imaginable day.

Chat ships in the test run. There is no cost reason to hold it back.

## Acceptance

- [ ] the wardrobe summary stays under 400 tokens for a 200-item wardrobe
- [ ] the model never recommends an item the user does not own — test with an adversarial
      prompt ("suggest a red leather jacket")
- [ ] "pair something with my black jeans" resolves to the right item
- [ ] a free-plan user gets `PREMIUM_REQUIRED` and no model call is made
- [ ] a user at their chat cap gets `AI_BUDGET_EXCEEDED` and no model call is made
- [ ] a forced rerank failure returns rules-order results with a 200 status
- [ ] rerank issues exactly one model call per (user, occasion, day) — verified by counting
      `ai_usage` rows
- [ ] streaming works on mobile Safari

## Out of scope

- Image generation, virtual try-on.
- Multi-turn memory beyond the last 8 messages. Durable preference lives in
  `style_profiles` (module 10), which is a better place for it than a chat transcript.
- Tool calling. The wardrobe summary is sufficient grounding; tools would add latency and
  failure modes for no product gain here.
