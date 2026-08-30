# 16 — UI & design system

**Scope:** TEST · **Depends on:** 05, 08, 09 · **Owns:** `app/globals.css`, `tailwind.config.ts`,
`components/*`, all screen layouts

Derived from the working prototype (18 screenshots, 28 Aug 2026). The prototype is the
design authority for **look and screen inventory**. This spec is the authority for **data
model and behaviour**. Where they disagree, §7 records the decision.

## 1. Design tokens

Sampled from the prototype's actual pixels, not eyeballed. The brand green is consistent
across the logo tile, primary buttons, and the active sidebar row at `#85a064`.

```css
:root {
  /* brand — sage green */
  --brand-50:  #f4f8f2;   /* insight tiles, subtle panels */
  --brand-100: #e8f0e0;   /* category pills, active nav pill, chips */
  --brand-200: #d3e0c6;
  --brand-300: #b8c6a9;   /* borders on brand surfaces */
  --brand-400: #9bb37e;
  --brand-500: #85a064;   /* PRIMARY — buttons, logo, active states */
  --brand-600: #759353;   /* hover, match badge */
  --brand-700: #5f7a42;
  --brand-800: #4a6033;

  /* neutrals */
  --bg:        #fafafa;   /* page */
  --surface:   #ffffff;   /* cards, nav bar */
  --border:    #e7e7e5;
  --text:      #171717;
  --text-dim:  #57534e;
  --text-mute: #8a8a85;

  /* semantic */
  --danger-50:  #fee2e2;  /* danger panel background */
  --danger-300: #e38a8a;  /* danger button */
  --danger-600: #dc2626;  /* danger text, trash icon */
  --favourite:  #ef4444;  /* filled heart */

  --radius-sm: 8px;
  --radius:    12px;      /* cards, inputs, buttons */
  --radius-lg: 16px;      /* panels */

  --shadow-card: 0 1px 3px rgb(0 0 0 / .06), 0 1px 2px rgb(0 0 0 / .04);
}
```

**Dark mode is a token swap, not a redesign.** The prototype's Appearance tab already has the
toggle. Define the dark palette in the same file under `:root[data-theme="dark"]` and never
hardcode a colour outside these variables — that toggle is a promise the settings screen has
already made to the user.

**Type.** The prototype uses a geometric sans with tight tracking on headings. Specify:

```css
--font-sans: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

Load from `next/font/google` with `display: swap` and a subset — not a `<link>`, which
blocks render.

Scale: page title 40/1.1 semibold · section 20/1.3 semibold · card title 16/1.4 medium ·
body 15/1.6 · meta 13/1.5 · chip 12/1.

## 2. Shell

Fixed top bar, white, full-width, ~72px. Logo tile (brand-500, rounded, white t-shirt glyph)
+ wordmark on the left. Nav on the right: **Dashboard · Upload · Wardrobe · Outfits · Bin ·
Settings**, each an icon + label. Active item is a `brand-100` pill with `brand-700` text.

Content is centred, max-width 1400px, 24px gutters.

**Mobile (< 768px):** the six-item top nav does not fit. Collapse to a bottom tab bar with
five: Dashboard, Wardrobe, Upload (centre, elevated), Outfits, Settings. Bin moves into
Settings. The prototype is desktop-only and this is the single largest piece of design work
the screenshots do not cover — people photograph clothes with a phone, so mobile is the
primary upload surface, not an afterthought.

## 3. Component inventory

| Component | Where | Notes |
|---|---|---|
| `NavBar` | shell | active pill, mobile collapse |
| `ItemCard` | wardrobe grid | image, hover actions, meta rows, "Wore Today" |
| `ItemCardCompact` | dashboard, outfit lists | image + title + category pill |
| `CategoryPill` | everywhere | `brand-100` bg, `brand-800` text, 12px |
| `TagChip` | item card overlay | translucent brand, `+N more` overflow |
| `ColorDot` | item meta | filled circle + colour name |
| `FacetList` | wardrobe sidebar | icon, label, count badge, active row |
| `StatRow` | Quick Stats, Style Insights | label + coloured count badge |
| `OutfitCard` | outfits page | items grid, feedback buttons, "Why This Works" |
| `MatchBadge` | outfit header | `brand-600` pill, white text, "95% Match" |
| `SegmentedTabs` | settings | 4 tabs, white active on grey track |
| `ToggleRow` | settings | label + description + switch |
| `SelectRow` | settings | label + description + native select |
| `EmptyState` | bin, wardrobe, outfits | circular icon, title, one line |
| `DangerPanel` | settings | `danger-50` bg, typed confirmation |
| `Dropzone` | upload | dashed brand border, camera glyph |

**Item card anatomy**, exactly as the prototype has it:

```
┌────────────────────────────┐
│ [image 1:1]        ✎  ♥  🗑 │  ← hover actions, top-right
│                            │     ♥ filled red when favourite
│  ⌗ comfortable +2          │  ← tag chips, bottom-left overlay
├────────────────────────────┤
│ Men's Cotton Boxer Brief…  │  ← truncate at one line
│ [Underwear]        HACERMA │  ← category pill · brand, right-aligned
│ Lounge          ○ Mixed…   │  ← style · colour dot + name
│ 📅 All Season              │  ← seasons
│ ┌────────────────────────┐ │
│ │      Wore Today        │ │  ← full-width secondary button
│ └────────────────────────┘ │
└────────────────────────────┘
```

"Wore Today" on the card is better than routing wear-tracking through outfits — it is one
tap on the thing the user is already looking at. Keep it. It writes a `feedback` row with
`kind: 'worn'` for that single item (module 10).

## 4. Screens

### Dashboard
Two columns, ~2:1. Left: recent items grid, then **Today's Weather Outfit** — a
`brand-50` panel with a weather-condition select, refresh button, outfit title,
match badge, "Recommended Items" list, and "Style Notes" prose. Right rail: **Style
Insights** (Most Worn Category, Wardrobe Diversity) as `brand-50` stat tiles.

The weather select is a manual override. Default it to the real forecast from module 07
and let the user change it — a person who knows it will be colder than forecast should be
able to say so.

### Upload — "Smart Upload with AI"
Big dashed dropzone, camera glyph in a `brand-100` rounded square, "Drop Your Photos Here",
`Choose Photos` primary button, and a format line.

The prototype's line says *"Supports JPG, PNG, HEIC • Multiple files allowed"*. Keep the
copy; module 04 converts everything to WebP client-side before upload.

Then three states, exactly as the prototype has them:

1. **Selected Items (N)** — thumbnails, `Clear All`, and a primary action that becomes
   `⟳ Analyzing with AI… (N items)` while working. **Add what the prototype lacks: per-file
   progress rows** — thumbnail, filename, `compressing → uploading → tagging → ready`, and a
   per-row retry. A bulk upload of 20 photos with no visible progress is where users abandon.
2. **Review & Edit Items** — one `AI Analysis #N` card per photo with a `95% confident`
   badge and a `×` to drop it. Header actions: `Start Over` and
   `Save All to Wardrobe (N)`.
3. Each card collapses to image + name + category/style/colour chips + `Edit Details`, and
   expands to the full form: Item Name · Category · Type · Color · Style · Season · Brand ·
   Tags · Notes · **Purchase details (collapsed, optional — module 17 §4)**.

Nothing reaches the wardrobe until `Save All`. This is where your correction-rate metric
comes from, so log an edit event per changed field here (module 14).

Two bugs visible in these screens: **Brand comes back as the literal string `"unknown"`** —
an empty field must be `null`, not a word that sorts and filters like a brand. And **Type is
empty** while Category is Accessories — either the model didn't return a subtype or the
options didn't load from the category's `subtypes[]`.

### Wardrobe — "My Wardrobe"
Header with `N of M items` and `+ Add Items`. Filter bar: search, Favorites toggle, sort
select, grid/list toggle. Left rail: **Categories** facet list with counts, **Styles** facet
list with counts, **Quick Stats**. Main area: item card grid.

Counts on every facet row. They are what makes the sidebar feel like a wardrobe rather than
a menu, and they cost one grouped query.

### Outfits
`Generate Outfit Recommendation` primary button, then **Your Style Recommendations** — a
two-column card grid with a Refresh action. Each card: title, context chips (style, weather,
season), item thumbnails with category labels, thumbs up/down, and a **Why This Works**
panel in `brand-50`.

"Why This Works" is module 11's rerank rationale, already designed. That is the premium
surface, visible and named.

### Bin — "Trash Bin"
`N items in trash`, empty state, and for populated rows: thumbnail, name, deleted date,
`Restore` and `Delete Forever`. Add the line the prototype is missing: **"Items are
permanently deleted after 30 days."** A bin with no stated expiry is a storage leak the user
cannot see.

### Settings
Four segmented tabs — **Profile · Appearance · Categories · Account & Data**.

- **Profile** — avatar initial, name, email (read-only), member since, editable full name, logout
- **Appearance** — dark mode toggle; date format; default sort
- **Categories** — category list with subtype chips, `Default` badges, `+ Add Custom Category`
- **Account & Data** — account id, then a Danger Zone with typed `DELETE ALL MY DATA` confirmation

The typed confirmation is the right pattern for a destructive action. Keep it exactly.

## 5. States every screen needs

The prototype shows only the happy path. These are not optional polish — they are most of
the front-end work:

| State | Requirement |
|---|---|
| Loading | skeleton cards matching final layout. Never a centred spinner on a grid. |
| Empty | wardrobe, outfits, bin, search-no-results. Each with the action that resolves it. |
| Item `tagging` | card renders with a shimmer on the attribute rows and a badge. Fully editable meanwhile. |
| Item `failed` | badge + inline `Retry`. Item stays usable (module 05 §2). |
| Quota reached | designed upgrade screen, not a toast (module 05 §7). |
| AI budget spent | message naming the reset time (module 12 §5). |
| Offline / fetch failed | inline retry, never a blank panel. |
| Broken image | **the prototype fails here** — see §6. |

## 6. Bugs the screenshots expose

Worth fixing in the rebuild rather than carrying forward:

1. **Broken images.** "Beige Trench Coat" renders as alt text in four separate screenshots —
   dashboard, wardrobe grid, and both outfit cards. One item's image URL is dead and every
   surface shows the failure. Module 04's signed-upload plus day-rounded signed read URLs removes
   the class of bug; also add an `onError` fallback tile so one dead URL degrades to a
   placeholder instead of raw alt text.
2. **Size Unit setting has nothing behind it.** Cut it until something has a size.
   *(Currency was on this list until module 17 added `price` — keep Currency, it is now
   real. Default it to INR, not USD.)*
3. **`Account Type: Administrator` shown to the user.** Prototype scaffolding. There is one
   kind of user (module 03). Remove.
4. **Recommendations repeat items.** Black Skinny Jeans appears in both outfit cards on the
   same screen. Module 08's diversity rule — no two outfits share more than one item —
   fixes this.
5. **Weather is a manual dropdown only.** Wire module 07 behind it and keep the dropdown as
   an override.
6. **`Member Since 8/28/2025`** while the app reports 2026. Check the date handling.

## 7. Reconciliation with the spec

Four genuine conflicts. Decisions below; the migration is `0002_ui_alignment.sql`.

### 7.1 Categories: fixed enum vs. user-extensible — **resolved by splitting the concept**

The prototype has nine categories *and* an `Add Custom Category` button. The spec had a
six-value Postgres enum, because the beam search needs fixed slots to assemble against.
Both are right about different things.

**Split them:**

- **`slot`** — enum, internal, never shown: `top · bottom · fullbody · outerwear ·
  footwear · accessory`. What module 08 assembles on. Set by AI tagging, user-overridable.
- **`category_id`** — FK to a `categories` table, seeded with the prototype's nine, and
  user-extensible. What the sidebar, filters, and pills display.

They are not the same axis, which is why one enum could not serve both. `Activewear` proves
it: a workout top is `slot: top`, yoga pants are `slot: bottom`, and both are category
`Activewear`. Any mapping from category to slot would have to break one of them.

Categories carry `outfit_eligible`, default true, **false for Underwear and Sleepwear** —
so they are browsable and countable but never assembled into a suggested outfit.

### 7.2 Occasions array → single style — **adopt the prototype's**

The prototype shows one style per item and a facet list with counts. The spec had an
`occasions[]` array. A single value is what the UI needs and what users actually think.

Adopt the prototype's seven, replacing the spec's nine:

```
lounge 1 · workout 1 · casual 2 · date-night 3 · party 3 · business 4 · formal 5
```

The number is the target formality — `STYLE_FORMALITY` in `types.ts`, used by module 08 §1.

### 7.3 Bin vs. archive — **keep both, they are different things**

| | Meaning | Counts to quota | Recommendable | Fate |
|---|---|---|---|---|
| `archived` | owned, out of rotation | **yes** | no | stays forever |
| `deleted_at` | in the bin | **no** | no | purged with its images after 30 days |

The prototype only has the bin. Archive is still needed — module 13's downgrade path
archives items over the free cap rather than deleting them, and "I don't wear this any more
but I still own it" is a real state. Add archive as a secondary action on the item card's
overflow menu; the bin stays the primary delete flow.

Purging a binned item deletes its stored images. A bin that never empties is a storage leak
charged to you.

### 7.4 Chat has no screen — **cut it from the test phase**

There is no stylist chat anywhere in 18 screenshots. Module 11 assumed it.

**Recommendation: ship the rerank half, defer the chat half.** "Why This Works" is already
designed, already visible, and is the same model capability. Chat is the expensive half —
₹102 of the ₹135/month a paid test phase would cost, versus ₹31 for rerank — and it is the
one surface with no design.

Module 11's rerank spec stands unchanged. Its chat spec moves to `PROD`. Say so if you
disagree; it is a product call, not a technical one.

### 7.5 Smaller additions from the prototype

| Field | Type | Note |
|---|---|---|
| `brand` | `text` | Levi's, Uniqlo, Zara — shown right-aligned on the card |
| `deleted_at` | `timestamptz` | the bin |
| `style` | `style_t` | replaces `occasions[]` |
| `category_id` | `uuid` | replaces the category enum for display |
| `slot` | `slot_t` | the enum, now internal only |

`user_tags` already existed and maps to the prototype's tag chips. Good.

**Match percentage.** The prototype shows "95% Match". Module 08's raw scores sit in
0.70–0.85 for good outfits, because the neutral-colour branch returns a flat 0.85 and most
wardrobes are mostly neutral. Do not retune the weights to hit 95 — map for display:

```ts
const matchPercent = Math.round(50 + score * 50);   // 0.85 → 93%
```

The ranking is what matters; the number is a label.

## 8. Acceptance

- [ ] every colour in the app resolves to a token — no literal hex outside `globals.css`
- [ ] the dark-mode toggle works on every screen with no hardcoded colour surviving
- [ ] the six nav destinations render and the active pill tracks the route
- [ ] the wardrobe sidebar shows live counts for every category and style
- [ ] an item card shows image, tags, title, category, brand, style, colour, seasons, and "Wore Today"
- [ ] a dead image URL renders a placeholder tile, never raw alt text
- [ ] loading, empty, tagging, failed, and quota states exist on every screen that can reach them
- [ ] a custom category can be created, assigned a slot, and filtered on
- [ ] Underwear and Sleepwear items never appear in a generated outfit
- [ ] binned items disappear from the wardrobe, appear in the Bin, restore correctly, and are
      purged with their stored images after 30 days
- [ ] the bin states its 30-day expiry
- [ ] mobile: bottom tab bar, upload works from a phone camera, grid is one or two columns
- [ ] no two outfits on the Outfits page share more than one item
