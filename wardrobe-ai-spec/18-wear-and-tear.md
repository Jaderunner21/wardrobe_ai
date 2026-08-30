# 18 — Wear & tear

**Scope:** TEST · **Depends on:** 05, 17 · **Owns:** `condition_log`, the condition columns,
`rate_condition()`, `retailer_durability`

## Responsibility

Track how garments hold up over time, so the user knows which shops sell things that last.

## Why this is built now and not later

Everything else on the long-term roadmap is a column you can add whenever you get to it.
This one isn't.

**Condition is a time series.** "This jacket started failing at 20 wears" only exists if
condition was recorded at wear 5, at 10, at 20. Add the feature in six months and every
garment already in the wardrobe has no history and never will — you cannot reconstruct it,
ask the user to remember it, or infer it from a photo of how it looks today.

The cost of building it now is one table and two columns. The cost of building it later is
a permanent hole in the data for every item bought before that day.

## Contracts

```sql
rate_condition(item_id uuid, condition smallint, note text) → items
needs_condition_rating(item) → boolean
select * from retailer_durability where user_id = $1
```

Columns on `items`: `condition` (1–5), `condition_rated_at`, `condition_at_wear`,
`retired_reason`, `retired_at`. Migration `0004_wear_and_tear.sql`.

```sql
log_wear(item_id uuid, worn_on date default null)   → items   -- idempotent per day
undo_wear(item_id uuid, worn_on date default null)  → items
set_wear_count(item_id uuid, count int)             → items
wear_confidence(item) → numeric                              -- observed / total
```

Routes: `POST /api/items/[id]/condition` · `POST /api/items/[id]/wore` (optional `wornOn`) ·
`DELETE /api/items/[id]/wore` · `PATCH /api/items/[id]` accepting `wearCount` ·
`GET /api/insights/retailers`.

## Behaviour

### 1. User-rated, never inferred

Your call, and it's the right one. A vision model can read colour and category from a photo;
it cannot reliably tell pilling from texture, or a worn sole from a dark one. A wrong
condition rating silently corrupts the retailer signal, which is the whole point of the
feature.

Module 06's tag schema must not contain `condition`. Same rule as price (module 17 §3).

Five levels, worded so they mean the same thing to different people:

| | Meaning |
|---|---|
| 5 | Like new |
| 4 | Good — no visible wear |
| 3 | Worn but fine |
| 2 | Visible wear — fading, pilling, stretching |
| 1 | Worn out — needs replacing |

### 2. The log is the feature, not the field

`items.condition` is the current value, for display and filtering. `condition_log` is the
history, and it is where every insight comes from. Rows are never updated and never deleted.

Each log row snapshots `wear_count` at the moment of rating. That denormalisation is
deliberate — without it you cannot say "it was still a 5 at 40 wears" without reconstructing
a wear history you don't have.

`rate_condition()` writes the log row and updates the item in one function, so the two can
never drift apart.

### 3. Prompt at milestones, never every wear

Asking after every wearing turns a useful feature into a chore, and people stop tapping
"Wore Today" — which costs you cost-per-wear and the recency signal too.

`needs_condition_rating()` returns true after 10 wears, then every 15 wears since the last
rating. Surface it as a single dismissible tap on the item card. Always editable from the
item detail page for a user who wants to rate something now.

### 3b. The wear count belongs to the user

Wear count increments by **one on every wearing** — tap "Wore Today", 12 becomes 13. There
is no interval and no rounding. The milestone rule in §3 governs only when we *prompt for a
condition rating*, which is a different number entirely.

Three things the tap alone does not cover, all handled in `0005_wear_logging.sql`:

**Digitising an old wardrobe.** A jacket owned for two years starts at zero wears, which
makes its cost-per-wear wrong by a factor of eighty and its condition history meaningless.
Ask once, when the item is added: *"Roughly how many times have you worn this?"* — skippable,
defaults to zero. `set_wear_count()` records it, and keeps the estimate in
`initial_wear_count` so a measured 40 stays distinguishable from a guessed 40.

**Forgetting to log.** Nobody opens an app every day. `log_wear(item, date)` accepts a past
date, so a user can add a wearing they missed. Editing the number directly works too.

**Mis-taps.** `undo_wear()` removes today's entry and recalculates `last_worn_on` from what
remains. One tap should always be undoable.

Logging is **idempotent per item per day** — tapping twice on the same date does not
double-count, which matters because the button is on the card and easy to hit twice.

`wear_confidence()` reports what fraction of an item's history was actually observed rather
than estimated. Any insight leaning on wear data should say so when it is low: "based mostly
on your estimate" is honest, and a cost-per-wear built on a guessed 80 deserves the caveat.

### 4. Retailer durability — the thing you actually wanted

```
your items from CheapShop  →  3 items, avg 15 wears, decline at ~12 wears
your items from GoodShop   →  3 items, avg 82 wears, decline at ~75 wears
```

`avg_wears_to_decline` is the mean wear count at which an item from that retailer first
dropped to condition ≤ 2. That is the number that tells you where not to shop again.

**Minimum three items before it says anything.** One bad shirt is a bad shirt, not evidence
about a shop.

**Frame it as the user's own record, not a public rating.** "Your items from X have averaged
15 wears" is a fact about their wardrobe. "X sells bad clothes" is a claim about a business,
from a sample of three, and it isn't yours to publish. Same data, and only one of them is
defensible when the product is public.

Combined with `price` from module 17 this gets sharp: a ₹600 shirt that fails at 12 wears
costs ₹50 a wear; a ₹1,400 one that lasts 90 costs ₹15. Cheap turns out expensive, and the
user can see it in their own data.

### 5. Retirement reason

When an item is binned or archived, ask why — one tap, skippable:

`worn out · no longer fits · disliked · sold · donated · lost · other`

Cheap to collect and each answer means something different. `worn_out` is the strongest
durability signal you have. `disliked` feeds the style profile. `donated` is the hook for
the donation network later. `no_longer_fits` is a size-change signal for buy
recommendations.

### 6. Where it surfaces

| Surface | Shows |
|---|---|
| Item card | condition dot when ≤ 2, so failing items are visible while browsing |
| Item detail | current condition, full history, wears since last rating |
| Rating prompt | one tap at milestones |
| Wardrobe filter | "needs replacing" (condition ≤ 2) |
| Insights | retailer durability table, once three items share a retailer |
| Recommendations | condition ≤ 2 items are deprioritised, not excluded — it's the user's call whether to wear them |

### 7. Feeds the roadmap

Three of your long-term features need this data and cannot be retrofitted onto it:

- **Buy recommendations** — knowing which shops last is most of knowing where to buy
- **Upcycling and disposal** — triggered by condition 1, not by guesswork
- **Donation network** — `retired_reason = 'donated'` is the entry point

## Acceptance

- [ ] `rate_condition` writes exactly one log row and updates the item atomically
- [ ] a log row snapshots `wear_count` at rating time
- [ ] log rows are never updated or deleted
- [ ] condition outside 1–5 is rejected by the database
- [ ] the prompt fires at 10 wears, then every 15 since the last rating, and not otherwise
- [ ] `retailer_durability` returns nothing for a retailer with fewer than 3 items
- [ ] with 3 items it reports average wears, price, condition and wears-to-decline
- [ ] module 06's tag schema contains no `condition`
- [ ] retirement reason is asked on bin and archive, and is skippable
- [ ] condition history is included in the account export
- [ ] no condition or retailer data appears in analytics events
- [ ] "Wore Today" increments by exactly one, every wear, with no interval or rounding
- [ ] tapping twice on the same day counts once
- [ ] a wear can be logged for a past date and updates `lastWornOn` correctly
- [ ] a wear in the future is rejected
- [ ] undo removes today's entry and recalculates `lastWornOn` from what remains
- [ ] the wear count can be set directly, and `initialWearCount` records the estimated part
- [ ] a negative wear count is rejected by the database
- [ ] adding an item offers an optional "roughly how many times have you worn this?"
- [ ] cost-per-wear updates immediately on every one of these paths

## Out of scope

- AI condition assessment from photos. Revisit when the models are good enough; the schema
  already supports it — a future `condition_source` column distinguishes user from model.
- Repair suggestions and tailoring. Adjacent, separate.
- Cross-user retailer aggregation. Interesting, and a different product with different
  legal questions. Not from 15 testers.
