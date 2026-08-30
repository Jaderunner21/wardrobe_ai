# 08 — Recommendation engine

**Scope:** TEST — the selection half is replaced by module 19 immediately after the test run
**Depends on:** 05, 07 · **Owns:** `lib/recommender/*`, `recommendation_cache`,
`app/api/recommendations/route.ts`

> **This is a scaffold, not the destination.** It ships for the 15-tester run because it is
> deterministic, free, and gets the product working end to end. The moment the test closes,
> **module 19** takes over garment selection and a model does the recommending — that is the
> product. What survives from this module: the candidate filter (§1), which stays as the
> guardrail, and the scoring and assembly (§2–4), which become the fallback when the AI is
> unavailable. Nothing here is wasted, and no migration is involved.

## Responsibility

Given a wardrobe, a style profile, a target style, and the weather, produce five ranked
outfits. Deterministic, in-process, no network call, ~40 ms, ₹0 per invocation.

During the test run this serves 100% of recommendations, at zero cost and about 40ms. It is
honest about what it is: a scoring function that knows hue distance, a formality integer and
a warmth integer. It does not know that a briefcase belongs with a suit or that a floral
dress does not take hiking boots. That is why module 19 exists and why it is next.

## Contracts

```ts
// lib/recommender/index.ts
export function recommend(ctx: RecommendationContext): Recommendation[];

// lib/recommender/color.ts
export function hexToHsl(hex: string): { h: number; s: number; l: number };
export function isNeutral(hsl: {h:number;s:number;l:number}): boolean;
export function colorHarmony(hexA: string, hexB: string): number;   // 0..1

// lib/recommender/score.ts
export function scorePair(a: Item, b: Item, ctx: RecommendationContext): ScoredPair;

// lib/recommender/beam.ts
export function assemble(candidates: Item[], ctx: RecommendationContext): Recommendation[];
```

`recommend` is **pure**. No database, no clock, no randomness. Everything it needs is in
`RecommendationContext`, which the route handler builds. This is what makes it unit-testable
against fixture wardrobes, and it is the only real algorithm in the codebase.

`GET /api/recommendations` → see `api-contracts.md`.

## Behaviour

### 1. Candidate filter

From `ctx.items`, keep items where all hold:

- `status === 'ready'`, `!archived`, `deletedAt === null`
- the item's category has `outfitEligible` — excludes Underwear and Sleepwear (module 16 §7.1)
- `seasons` includes `ctx.season` or `'all'`
- `|warmth − bucketWarmth| ≤ 2` where `bucketWarmth = TARGET_WARMTH_SUM[bucket] / 3`
- `|formality − targetFormality| ≤ 1`

```ts
const targetFormality = clamp(
  STYLE_FORMALITY[ctx.style] + ctx.styleProfile.formalityBias,
  1, 5
);
```

Skip the warmth filter entirely when `ctx.weather === null`.

**Fallback:** if fewer than 2 slots survive, relax the formality window to ±2, then
drop the season filter. A small or new wardrobe must still get suggestions — returning
nothing to a user with 8 items is the worst possible first experience.

### 2. Pair scoring

Weights sum to 1.0. When the thermal term is unavailable (no weather), drop it and
renormalise the rest — do not substitute a neutral 0.5, which biases every score toward the
middle.

| Term | Weight | Range |
|---|---|---|
| `colorHarmony` | 0.30 | 0..1 |
| `formalityCoherence` | 0.20 | 0..1 |
| `thermalFit` | 0.20 | 0..1 |
| `styleAffinity` | 0.15 | 0..1 |
| `recency` | 0.10 | 0..1 |
| `novelty` | 0.05 | 0..1 |

```ts
formalityCoherence = 1 − |a.formality − b.formality| / 4

thermalFit         = 1 − |Σ warmth − TARGET_WARMTH_SUM[bucket]| / 6   (clamped ≥ 0)

styleAffinity      = mean over the pair's colours of
                     ((colorAffinity[colour] ?? 0) + 1) / 2

recency            = 1.0  if neither worn in the last 7 days
                     0.6  if either worn 4–7 days ago
                     0.4  if either worn within 3 days

novelty            = 1.0  if this item pair has never appeared in an outfit together
                     0.3  otherwise
```

**Hard veto:** if `{a.primaryColor, b.primaryColor}` matches any entry in
`styleProfile.rejectedPairs` (order-insensitive), the pair scores 0 and is discarded. Not a
penalty — a veto. The user told you three times.

### 3. Colour harmony

```ts
function colorHarmony(hexA, hexB) {
  const A = hexToHsl(hexA), B = hexToHsl(hexB);
  if (isNeutral(A) || isNeutral(B)) return 0.85;   // neutrals pair with anything

  const d = Math.min(Math.abs(A.h - B.h), 360 - Math.abs(A.h - B.h));

  if (d >= 150 && d <= 210) return 0.90;   // complementary
  if (d < 40)               return 0.80;   // analogous
  if (d >= 100 && d < 140)  return 0.70;   // triadic-ish
  if (A.s > 0.6 && B.s > 0.6 && d >= 40 && d < 100) return 0.15;  // two loud clashing hues
  return 0.35;
}

const isNeutral = ({s, l}) => s < 0.15 || l < 0.15 || l > 0.85;
```

Neutral covers black, white, grey, navy, beige, cream — most of most wardrobes, which is why
the neutral branch fires first and returns a high, flat score. That is correct behaviour, not
a shortcut: navy trousers genuinely do go with almost everything.

### 4. Slot assembly — beam search

Slot order, filled left to right:

```
top → bottom → footwear → outerwear?
```

`fullbody` (a dress, a kurta) occupies `top` and `bottom` together — when a fullbody item is
chosen at the first slot, skip the second.

`outerwear` is included only when `TARGET_WARMTH_SUM[bucket] ≥ 7` (buckets 0–2) or
precipitation is non-zero. Do not put a jacket on someone in a 34° Udaipur afternoon.

`accessory` is never auto-assembled. Suggesting a belt the user did not ask about is noise.

**Beam width 8.** At each slot, extend every partial outfit with each candidate, score the
new item against every item already in the partial (mean of pair scores), keep the top 8.
Bounded work — never combinatorial, regardless of wardrobe size.

```
partials = [[]]
for slot in slots:
  next = []
  for p in partials:
    for c in candidates[slot]:
      next.push({ items: p.items + [c], score: meanPairScore(p.items + [c]) })
  partials = topN(next, 8)
return topN(partials, ctx.limit)
```

Final outfit score is the mean of all pair scores within it, so a 3-item outfit and a 4-item
outfit are comparable.

**Diversity:** no two returned outfits may share more than one item. Enforce while taking the
final top-N — five near-identical outfits is a worse answer than three varied ones.

### 5. Caching

Key: `md5(style + ':' + tempBucket + ':' + wardrobeVersion)`, stored in
`recommendation_cache` with a 24-hour expiry.

`wardrobeVersion` (module 05) means the cache invalidates precisely when the wardrobe
changes, not on a timer. A user who hasn't added anything today gets the cached response
however many times they open the app — free, instant, and stable, which also means the
recommendations don't shuffle between refreshes for no visible reason.

`?refresh=true` bypasses the cache. Rate-limit it separately; it is the one endpoint a bored
user will hammer.

### 6. Explainability without the LLM

The rules engine emits a mechanical rationale from the dominant score terms, so free users
get *some* reason and the feature is not empty without AI:

```
"Navy and cream sit well together, and this is warm enough for 19°."
```

Template from the two highest-weighted terms. Module 11 replaces this with the model's prose
for premium users. Keep both — when the LLM layer fails, this is the fallback.

### 7. Degradation ladder

Never return an error from this endpoint. In order:

1. full scoring with weather
2. no weather → drop thermal term, renormalise
3. thin wardrobe → relax filters (§1 fallback)
4. fewer than 2 usable slots → return an empty array with a `reason` field the UI can
   render as "add a few more items to get outfit suggestions"

## Acceptance

- [ ] `recommend()` is pure — passes tests with no DB, no network, no `Date.now()`
- [ ] colour harmony returns expected values for a fixture table: navy/white high,
      red/green mid, orange/pink low
- [ ] a wardrobe of 8 items still returns at least one outfit
- [ ] a wardrobe with no bottoms returns empty with a reason, not a crash
- [ ] no returned pair appears in `rejectedPairs`
- [ ] outerwear absent from results at bucket 4
- [ ] two calls with an unchanged wardrobe return identical results and the second is served
      from cache
- [ ] adding one item invalidates the cache
- [ ] no two returned outfits share more than one item
- [ ] p95 latency under 100 ms for a 200-item wardrobe

## Reference validation

This algorithm was implemented as a reference prototype and run against an 11-item fixture
wardrobe before this spec was written. Observed, and expected from your implementation:

```
casual, 28°C, summer     0.828  white top + navy bottom + white footwear
                         0.794  olive top + beige bottom + white footwear
work (formality 4)       0.833  white top + navy bottom + brown footwear
cold (bucket 1)          0.733  … + grey outerwear      ← outerwear appears
hot (bucket 4)           outerwear present: False       ← and never here
veto navy+beige          vetoed pair present: False
no weather               2 outfits, top 0.827           ← renormalisation works
5-item wardrobe          2 outfits                      ← thin wardrobe still served
diversity (≤1 shared)    holds

colour harmony:  navy/white 0.85 · red/green 0.70 · orange/pink 0.15 · navy/navy 0.80
```

Scores in the 0.7–0.85 band for good outfits are expected — the neutral colour branch
returns a flat 0.85 and most wardrobes are mostly neutral. Do not tune the weights to push
scores toward 1.0; the ranking is what matters, not the absolute value.

## Out of scope

- AI-driven selection — module 19, built immediately after the test run.
- LLM prose — module 11.
- Persisting a recommendation as an outfit — module 09.
- Updating the style profile — module 10. This module reads it and never writes it.
