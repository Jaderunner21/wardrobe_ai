# 17 — Item history & cost-per-wear

**Scope:** TEST · **Depends on:** 05, 09, 10 · **Owns:** the purchase/history columns,
`lib/cpw.ts`, the item detail History panel

## Responsibility

Turn the wardrobe into a record the user can reason about: what a garment cost, when and
where it was bought, how often it has actually been worn, and what each wearing has cost so
far.

This is the feature that gives wear-tracking a point. "Wore Today" on its own is a chore
with no payoff; "Wore Today → your ₹4,200 boots are now down to ₹140 a wear" is a reason to
tap it. **Cost-per-wear is the retention mechanic**, and the outfit calendar is the other
one — both exist because a wardrobe app that helps you once gets used for two weeks.

## Contracts

New columns on `items` — migration `0003_item_history.sql`:

| Column | Type | Source | Note |
|---|---|---|---|
| `name` | `text` | AI, editable | "Brown Leather Briefcase". The prototype has this; the spec didn't. |
| `notes` | `text` | user only | free-text personal notes |
| `price` | `numeric(12,2)` | **user only** | never inferred — see §3 |
| `currency` | `char(3)` | profile default | ISO 4217, `INR` |
| `purchased_on` | `date` | user only | |
| `retailer` | `text` | user only | "Zara", "Myntra", a shop name |
| `cpw_target` | `numeric(10,2)` | user, optional | per-item override of the profile default |

On `profiles`: `currency char(3) default 'INR'`, `cpw_target numeric(10,2) default 100`.

```ts
// lib/cpw.ts — pure
export interface CostPerWear {
  cpw: number | null;          // null when price is unset
  wears: number;
  target: number;              // item override, else profile default
  wearsToTarget: number | null;// how many more wears to reach it
  reachedTarget: boolean;
  daysOwned: number | null;
  wearsPerMonth: number | null;
}
export function costPerWear(item: Item, profile: Profile, today: Date): CostPerWear;
```

Pure, like the recommender and the learning update — same reason, it is arithmetic and it
should be testable without a database.

## Behaviour

### 1. The calculation

```ts
cpw           = price / max(wearCount, 1)
wearsToTarget = price / target - wearCount        // ceil, floor at 0
daysOwned     = today - purchasedOn
wearsPerMonth = wearCount / (daysOwned / 30.44)
```

`max(wearCount, 1)` matters: an unworn item's cost-per-wear is its full price, not a
division by zero. That is also the honest number.

### 2. Framing — a target, not a verdict

You described this as "was it worth it or not". Build the number, not the judgement.

The user sets a **cost-per-wear target** (default ₹100, editable per item and globally).
Each item shows progress toward it:

```
₹4,200 · worn 30 times · ₹140 per wear
████████████████░░░░  12 more wears to reach your ₹100 target
```

An app that tells someone their purchases were a mistake is unpleasant to use, and people do
not need a wardrobe app for that. A target the user chose is motivating and turns the number
into a reason to log wears — which is exactly the loop you want. Same information, and it
compounds instead of stinging.

Where a flag is genuinely useful, keep it factual and actionable rather than evaluative:
**"Not worn in 6 months"** on an item is a fact the user can act on. **"This wasn't worth
it"** is a verdict they didn't ask for. Ship the first.

### 3. The AI never guesses price

`price`, `purchased_on`, and `retailer` are **user-entered only**. Module 06's schema must
not include them, and the prompt must not ask.

A vision model cannot see what something cost. A plausible-looking guess written into a
field the user treats as a purchase record corrupts it silently, and unlike a wrong
`material` it is not obvious on inspection. Leave the fields empty and let them be filled in.

Related bug in the prototype, visible in the screenshots: **Brand comes back as the literal
string `"unknown"`.** An empty field must be `null`, not a word. `"unknown"` sorts, filters,
groups, and displays as if it were a brand.

### 4. Entry is optional and low-friction

Most users will not fill these in for every garment, and the product must be fine with that.

- Collapsed by default in the edit form, under a "Purchase details (optional)" disclosure
- An item with no `price` shows wear count and nothing else — no empty-state guilt
- Bulk-fill: after entering a price once for a retailer, offer it as a suggestion
- Currency defaults from the profile, per-item override for things bought abroad

### 5. Where it surfaces

| Surface | Shows |
|---|---|
| Item detail — **History** panel | price, purchase date, retailer, wear count, CPW, progress to target, days owned, wears/month, last worn |
| Item card | CPW only when `price` is set, as a small meta row |
| Wardrobe sort | `cost-per-wear` and `least-worn` become sort options |
| Style Insights | "Best value: Brown Leather Boots, ₹38/wear" · "Unworn in 6 months: 4 items" |

The Style Insights panel in your prototype currently shows Most Worn Category and Wardrobe
Diversity, which are weak numbers. Cost-per-wear gives that panel something worth looking at.

### 6. This makes Currency real

I earlier said to cut the Currency setting because nothing had a price. That was right then
and wrong now — **keep Currency, cut Size Unit** until something has a size.

Store `price` as `numeric(12,2)`, never a float. Format at display time from
`profile.currency` using `Intl.NumberFormat`; never store a formatted string.

### 7. Prices are the user's financial records

Two consequences, both cheap:

- **Never put `price`, `retailer`, or `purchased_on` in an analytics event** (module 14). The
  events table is for behaviour, not for what your users spend.
- The export and deletion paths in module 03 now carry financial history. They were already
  required; this raises how much they matter.

RLS already covers access. No new policy needed — the columns sit on `items`.

## Acceptance

- [ ] `costPerWear` is pure and unit-tested, including `wearCount = 0`
- [ ] an item with no price shows wear count and no CPW, with no empty state
- [ ] "Wore Today" updates the CPW immediately in the UI
- [ ] the target progress bar is correct at 0 wears, at target, and past target
- [ ] price is stored as numeric and survives a round-trip of `1234.56`
- [ ] currency formats from the profile setting and can be overridden per item
- [ ] module 06's tag schema contains no `price`, `purchasedOn`, or `retailer`
- [ ] an unknown brand is `null`, never the string `"unknown"`
- [ ] purchase fields are collapsed by default in the edit form
- [ ] no analytics event payload contains a price
- [ ] account export includes the purchase history

## Out of scope — and why

You said there are many more features. These are the adjacent ones and none belong here yet:

- **Receipt scanning / OCR** to auto-fill price. Real feature, separate module, needs its own
  model call and error handling.
- **Resale value, depreciation.** Requires market data you do not have.
- **Wardrobe total value, spend-per-month dashboards.** Easy to add once the columns exist —
  wait until the test phase shows anyone fills the fields in at all.
- **Cost-per-wear on outfits** rather than items. Sounds neat, means little.

The columns are the durable part; every one of those builds on them without a migration.
