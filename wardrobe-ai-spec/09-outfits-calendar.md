# 09 — Outfits & calendar

**Scope:** TEST · **Depends on:** 08 · **Owns:** `outfits`, `outfit_items`,
`app/api/outfits/*`, `app/(app)/outfits`, `app/(app)/planner`

## Responsibility

Persist a recommendation the user liked, let them build one by hand, and let them plan
outfits against dates.

## Contracts

`POST /api/outfits`, `PATCH|DELETE /api/outfits/[id]`, `GET /api/outfits`. See
`api-contracts.md`.

## Behaviour

### 1. Two ways an outfit is created

- **From a recommendation.** The user saves one of the five. `source: 'rules'` or `'llm'`,
  and `score` and `rationale` carry over from the recommendation.
- **By hand.** The user picks items from a slot-based builder. `source: 'manual'`,
  `score: null`.

Both go through the same `POST`. Do not build two paths.

### 2. Validation

- `itemIds.length === slots.length`
- slots are unique — no outfit has two `bottom`s
- every item is owned by the caller (RLS gives you this) and is `status: 'ready'`
- 2–5 items

An outfit referencing an archived item is allowed to be created and kept. People do wear
things they later stop owning, and breaking their saved outfits to enforce tidiness is worse
than the inconsistency.

### 3. Saved vs. generated

Every recommendation the user acts on gets a row, so that feedback (module 10) has something
stable to point at. `saved: true` means the user explicitly kept it; `saved: false` rows are
transient records of what was shown.

**Growth control:** at production scale that is a lot of rows. Prune `saved = false` rows
older than 30 days with no feedback attached, in the same cron family as `events`. Test
phase: nothing to prune.

### 4. The calendar

`plannedFor` is a date. The planner view shows a week or month, with the planned outfit's
item thumbnails in each cell.

This is one of the two retention features in the product — the other is the daily
recommendation. Both exist because a wardrobe app that only helps you once is used for two
weeks and abandoned. Instrument whether anyone actually uses it (module 14); if nobody does
after the test phase, that is a finding worth having.

Planning does not forecast. You are storing an intent for a date, not a weather-adjusted
prediction for it. When the date arrives, the outfit is shown as planned.

### 5. Marking worn

Marking an outfit worn is a feedback event (`kind: 'worn'`, module 10), not an outfit
mutation. It increments `wearCount` and sets `lastWornOn` on every item in the outfit, which
feeds the recency term in the recommendation engine.

Auto-mark: an outfit with `plannedFor = today` that the user opens gets a one-tap "wore
this". Do not auto-mark silently — a planned outfit is an intention and people change their
minds in the morning.

### 6. Reads

`GET /api/outfits` hydrates items with `ITEM_LIST_COLUMNS`, so one query with a join, not
N+1. The calendar view especially — a month of planned outfits is up to 31 outfits × 4 items
and must not be 124 queries.

## Acceptance

- [ ] saving a recommendation persists the outfit with its items in the right slots
- [ ] the manual builder produces an equivalent row through the same endpoint
- [ ] duplicate slots are rejected with `VALIDATION_FAILED`
- [ ] an outfit containing an archived item still loads
- [ ] planning an outfit for a date shows it in the calendar cell
- [ ] marking worn increments `wearCount` and sets `lastWornOn` on all items
- [ ] an item worn today scores lower in the next recommendation run (integration with 08)
- [ ] loading a month of planned outfits issues a bounded number of queries

## Out of scope

- Sharing outfits, public links, social features.
- Packing lists and travel capsules. Reasonable future feature, not now.
- Auto-generating a week of outfits at once — that multiplies AI cost by seven and the
  recommendation engine is cheap enough to run daily.
