# 19 — AI recommendation engine

**Scope:** NEXT — built immediately after the test run, before anything else
**Depends on:** 08, 12 · **Owns:** `lib/recommender/ai.ts`, the selection half of
`/api/recommendations`

## Status

This module is not deferred. It is the **first thing built after the 15-tester run closes**,
ahead of billing, ahead of hardening, ahead of every other PROD item.

Module 08's rules engine ships for the test phase because it is deterministic, free, and
lets the product work end to end while you learn whether people use it at all. It is a
scaffold, not the destination. The product is *AI recommending clothes from your wardrobe*,
and a colour-wheel heuristic is not that.

## What changes, and what does not

Module 08 has two jobs. This module takes one of them.

| Job | Test run | After |
|---|---|---|
| **Filter** — season, weather, formality window, eligibility, status | rules (08 §1) | **unchanged** |
| **Select** — which garments go together | rules scoring + beam search (08 §2–4) | **the model** |
| **Explain** — why it works | template, then LLM copy | the model, same call |
| **Fallback** — AI down or budget spent | — | rules (08 §2–4) |

The filter stays because it is cheap, deterministic, and stops the model from ever seeing a
winter coat in a Udaipur summer. The scoring and beam search stay too — they become the
fallback path, so the screen is never empty.

**Nothing about the data model changes.** No migration. That is the point of having built
08 as a pure function over `RecommendationContext`.

## Why the model selects better than the scoring function

Worth being explicit, because the rules engine looks respectable on paper.

It knows hue distance on a colour wheel, a formality integer, and a warmth integer. It does
not know that a briefcase belongs with a suit, that a floral summer dress does not take
hiking boots, that a kurta pairs differently from a shirt, or anything about proportion,
silhouette, or how fabrics read together. Those are not gaps you close by adding terms —
they are fashion knowledge, and a language model has read a great deal of it.

The measured difference will show up in the thumbs-up rate (module 14). If the AI engine
does not beat the rules engine on that number, keep the rules engine and say so.

## Contracts

```ts
// lib/recommender/ai.ts
export async function recommendAI(
  ctx: RecommendationContext,
): Promise<Recommendation[]>;   // falls back to recommend() from 08 on any failure
```

The route signature does not change. `GET /api/recommendations` gains nothing; `source`
already distinguishes `'rules'` from `'llm'`.

## Behaviour

### 1. The flow

```
wardrobe
   ↓  rules filter (08 §1)          → 15-30 eligible garments
   ↓
   compact candidate list to the model, as text — id, name, category,
   colour, formality, warmth, last worn
   ↓
   MODEL SELECTS 5 OUTFITS         ← this module
   returns item ids + slot + rationale per outfit
   ↓
   VALIDATE every id against the filtered set    ← cannot invent garments
   ↓
   drop any outfit containing an unknown id, backfill from the rules engine
   ↓
   cache on (user, style, tempBucket, wardrobeVersion)
```

### 2. Validation is not optional

The model returns ids. Every one is checked against the candidate set that was sent. An id
that was not in that set means the model invented a garment, and the outfit is discarded.

This is the whole safety property. Without it the product suggests clothes the user does not
own, which is worse than suggesting nothing.

If fewer than five outfits survive validation, backfill from the rules engine rather than
asking the model again.

### 3. The prompt

Send the candidate list, the context, and the user's learned profile. Not images — the
attributes are enough and images would cost 20× the tokens.

```
You are a stylist. Build 5 outfits from ONLY the garments listed below.

CONTEXT
  occasion: work        weather: 19°C, light rain      season: monsoon
  prefers: navy, olive  ·  avoids: mustard  ·  never pairs navy with black

CANDIDATES
  a1  White Oxford Shirt      top        white   formality 4  warmth 2  worn 3d ago
  a2  Navy Blazer             outerwear  navy    formality 4  warmth 3  worn 12d ago
  ...

RULES
  - Every outfit needs a top and a bottom, or one full-body garment.
  - Include footwear. Include outerwear only if the weather calls for it.
  - Use only the ids listed. Never invent a garment.
  - No two outfits may share more than one garment.
  - Prefer garments not worn recently.
  - Respect the avoid list and the never-pair list absolutely.

Return JSON: [{ items: [{id, slot}], rationale: "one or two sentences" }]
```

Schema-enforced output, Zod-parsed, same as module 06.

### 4. Comfort zone

The user's learned profile (module 10) goes in as preference, not as law — except the
vetoes, which are absolute.

Your stated intent is that suggestions stay mostly within the user's comfort zone during the
test phase and stretch it later. Implement that as an explicit dial rather than prompt
vibes:

```
outfits 1-4   within the learned profile
outfit 5      one deliberate stretch — a pairing they have not tried,
              still inside the vetoes, labelled "Something different"
```

Labelling it matters. An unexplained odd suggestion reads as the AI being wrong; a labelled
one reads as an offer, and the thumbs-up rate tells you whether people want more of them.

### 5. Cost and caching

One call per `(user, style, tempBucket, wardrobeVersion)` per day, cached in
`recommendation_cache` exactly as module 08 already does. `?refresh=true` costs a call and
is rate-limited.

Test-phase and near-term volume sits inside the Gemini free tier with large headroom — at 15
users the recommendation traffic is roughly 9 calls a day against a 1,500/day ceiling. The
per-user daily caps from module 12 still apply, unchanged.

### 6. Degradation

Every failure path lands on the rules engine, which is already built and already tested:

| Failure | Behaviour |
|---|---|
| Model unavailable | rules engine, `source: 'rules'` |
| Malformed response | rules engine |
| All outfits fail validation | rules engine |
| Some fail validation | keep the valid ones, backfill from rules |
| Budget exhausted | rules engine, no message needed — the user gets outfits either way |

The rules engine is not dead code after this ships. It is the reason this module can fail
safely.

### 7. Measure the swap

Ship it behind a per-user flag and compare, for at least two weeks:

- thumbs-up rate, rules vs AI
- saved-outfit rate
- how often a suggestion is actually worn

Those three numbers decide whether the model earned the swap. Run the comparison rather than
assuming — this module exists on a strong argument, not on evidence, until then.

## Acceptance

- [ ] every returned garment id exists in the candidate set sent to the model
- [ ] an outfit containing an invented id is discarded, not shown
- [ ] a forced model failure returns rules-engine outfits with a 200 status
- [ ] a vetoed colour pair never appears, even when the model proposes it
- [ ] outfit 5 is a labelled stretch and the other four are not
- [ ] one model call per user per style per day; a refresh is the only way to spend another
- [ ] no two outfits share more than one garment
- [ ] the wardrobe fits in the prompt for a 200-item wardrobe after filtering
- [ ] thumbs-up rate is compared against the rules engine before the flag is removed

## Out of scope

- Sending images to the model. Attributes are enough and images cost 20× the tokens.
- Letting the model change item attributes. It selects; it does not edit the wardrobe.
- Trend data, purchase suggestions, body-shape reasoning. All roadmap, none of it here.
