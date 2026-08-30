# 05 — Wardrobe items

**Scope:** TEST · **Depends on:** 04 · **Owns:** `items` table, `app/api/items/*`,
`app/(app)/wardrobe/*`

## Responsibility

CRUD for garments, and the wardrobe browsing experience. This module works completely with
the AI switched off — manual entry is a first-class path, not a fallback bolted on later.

## Contracts

`POST /api/items`, `GET /api/items`, `GET|PATCH|DELETE /api/items/[id]`. See
`api-contracts.md`.

## Behaviour

### 1. Manual entry is built first

Before module 06 exists, a user must be able to upload a photo and type in the attributes.
Build the edit form first, then let tagging pre-fill it.

This ordering is deliberate and worth defending. It gives you: a product that works when
Gemini is down or wrong, an escape hatch for garments the model mis-reads, and — because the
form already exists — a correction UI for free, which is what produces the correction-rate
metric that tells you whether tagging is working at all.

### 2. Status lifecycle

```
uploaded ──POST /api/items/tag──▶ tagging ──▶ draft ──Save All──▶ ready
    │                                │           ▲
    │                                └─ failed ──┘  (user fills it in by hand)
    └──(manual attributes supplied)─────────────▶ draft
```

`draft` is the prototype's **Review & Edit** step (module 04 §5b) — the item is uploaded and
tagged but has not been accepted into the wardrobe. Drafts appear only on the upload screen,
count toward the quota, and are binned after 24 hours if abandoned.

Only `ready` items are visible to the recommendation engine. `uploaded`, `tagging`, and
`failed` items live on the upload screen with a badge and are fully editable — a user should
never be blocked from saving an item because your AI vendor is having a bad day. A failed
item can be filled in by hand and saved like any other.

### 2b. Item name

The prototype gives every item a readable `name` ("Brown Leather Briefcase"), AI-generated
and editable. Keep it — `subtype` is structured and used for logic, `name` is what a person
recognises in a grid of 60 thumbnails. Both are needed and they are not the same field.

### 3. The wardrobe grid

A React Server Component. It queries Supabase directly with `ITEM_LIST_COLUMNS`, never
through `/api/items`.

- responsive masonry-ish grid, thumbnails from day-rounded signed URLs (module 04 §6)
- filter by category, season, formality band, favourite, archived
- text search across `name`, `subtype`, `primary_color`, `brand`, `user_tags`
- sort: newest, least-worn, recently-worn, **cost-per-wear** (module 17)
- empty state that starts an upload rather than saying "no items"

Only the first page renders on the server. Subsequent pages and any filter change fetch from
`GET /api/items` — cursor-based on `created_at`, never `offset`.

### 4. Edit sets `userEdited`

Any `PATCH` that changes an AI-populated field sets `user_edited = true` and emits one
`item.corrected` event per changed field, with the old and new values (module 14).

That event stream is the correction rate. It is the single most useful number in the test
phase and it costs one line in the patch handler.

### 5. Archive, don't delete

Archiving hides an item from the grid and the recommendation engine but keeps the row and
the image. Use it for clothes the user no longer owns — the wear history stays meaningful
and outfits referencing it don't break.

Deletion is real deletion, including the stored images. Offer archive first in the UI.

Archived items still count toward `item_count` and the quota. Otherwise archiving becomes a
free-storage exploit and the quota stops relating to what you actually store.

### 6. Wardrobe version

`profiles.wardrobe_version` (added in `0002_ui_alignment.sql`) is bumped by trigger on every
item insert, update, archive, and delete, alongside `item_count`. Module 08 uses it as a cache key component, which makes the recommendation
cache invalidate precisely on wardrobe change rather than on a timer.

### 7. Quota UX

`ITEM_QUOTA_EXCEEDED` renders an upgrade prompt, not a generic error toast. This is the
product's main conversion moment: the user is mid-task, invested, and has just been told
they've outgrown the free tier. It deserves a designed screen.

Test phase: testers are premium (03), so this path is not exercised in the wild. Cover it
with a test.

## Acceptance

- [ ] an item can be created, viewed, edited, archived, and deleted with the AI disabled
- [ ] the grid renders server-side; view-source shows item markup, not an empty shell
- [ ] no query in this module selects `ai_raw` outside the detail view
- [ ] editing an AI field sets `userEdited` and emits `item.corrected`
- [ ] archived items are absent from the recommendation engine's candidate set but present
      in the grid under the archived filter
- [ ] `wardrobe_version` increments on insert, update, archive, and delete
- [ ] deleting an item removes both stored images and decrements `item_count`
- [ ] filters and search compose (category + season + text at once)
- [ ] a draft item never appears in the wardrobe grid or a recommendation
- [ ] Save All flips every draft in the batch to `ready` in one request

## Out of scope

- Attribute inference — module 06.
- Outfit assembly — modules 08, 09.
- Multiple photos per item, sub-locations ("suitcase", "dry cleaner"), lending. All are
  reasonable future features and none are in the test phase.
