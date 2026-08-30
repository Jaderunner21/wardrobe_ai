# API contracts

Every HTTP route in one place. Types referenced here are from `types.ts`.

## Rules that apply to every route

1. **Auth.** Every route except `/api/health` and `/api/webhooks/*` requires a Supabase
   session. No session → `401 UNAUTHENTICATED`. Read the user from the server client; never
   trust a `userId` in a request body.
2. **Ownership is enforced by RLS**, not by application code. A query for another user's
   item returns zero rows, which the handler turns into `404 NOT_FOUND`. Do not add manual
   `where user_id = ...` checks as the primary defence — RLS is the defence; the check is
   redundant.
3. **Errors** always use the shape in `types.ts → ApiError`. Never a bare string.
4. **Request bodies** are Zod-parsed. Failure → `400 VALIDATION_FAILED` with `fields`.
5. **Idempotency.** `POST /api/items` is keyed on `contentHash`; a repeat returns
   `409 DUPLICATE_ITEM` with the existing item id in `fields.itemId`.

---

## Items — module 05

### `POST /api/items/presign`
Get a short-lived upload URL. Does not create the item row.

```ts
// request
{ contentHash: string; bytes: number; contentType: 'image/webp' }

// 200
{ itemId: string;          // client-generated UUID, reused on POST /api/items
  storagePath: string;     // items/{userId}/{itemId}.webp
  thumbPath: string;
  uploadToken: string;     // Supabase signed upload token, 2h
  thumbUploadToken: string }
```

Errors: `ITEM_QUOTA_EXCEEDED` (pre-check, so the user fails before uploading bytes),
`DUPLICATE_ITEM`, `VALIDATION_FAILED` (bytes > 500 KB, or contentType not webp).

The client uploads with `supabase.storage.from('items').uploadToSignedUrl(path, token, blob)`.

> The quota is checked here *and* enforced by the DB trigger on insert. The pre-check is a
> courtesy so the user doesn't upload first and fail second; the trigger is the guarantee.

### `POST /api/items`
Create the row after a successful upload.

```ts
// request
{ itemId: string; storagePath: string; thumbPath: string; contentHash: string;
  bytes: number; width: number; height: number;
  // optional manual attributes — present when the user typed them instead of tagging
  name?: string; categoryId?: string; slot?: Slot; style?: Style; brand?: string;
  subtype?: string; primaryColor?: string; colorHex?: string;
  pattern?: Pattern; material?: string; formality?: Formality; warmth?: Warmth;
  seasons?: Season[]; userTags?: string[] }

// 201
{ item: Item }
```

`status` is `'uploaded'` when no attributes were supplied (tagging will follow), `'ready'`
when the client supplied them manually.

Errors: `ITEM_QUOTA_EXCEEDED`, `DUPLICATE_ITEM`, `VALIDATION_FAILED`.

### `GET /api/items`
Only for client-side filtering and pagination past page 1. The initial wardrobe render is a
Server Component querying directly — see 01.

```
?categoryId=<uuid>&style=casual&season=summer&q=blue&favourite=true
&archived=false&sort=recent|least-worn|recently-worn|cost-per-wear
&cursor=<createdAt>&limit=50
```

```ts
// 200 — selects ITEM_LIST_COLUMNS only
{ items: Item[]; nextCursor: string | null }
```

### `GET /api/items/[id]` → `{ item: Item }` (full row, including `aiRaw`)

### `PATCH /api/items/[id]`
Any user-editable field. Sets `userEdited = true` and logs a correction event per changed
AI field (module 14).

```ts
// request — all optional
{ name?, notes?, categoryId?, slot?, style?, brand?, subtype?, primaryColor?,
  colorHex?, pattern?, material?, formality?, warmth?, seasons?, userTags?,
  favourite?, archived?, lastWornOn?, status?,
  // purchase history — module 17, user-entered only, never set by tagging
  price?, currency?, purchasedOn?, retailer?, cpwTarget? }

// 200
{ item: Item }
```

### `DELETE /api/items/[id]`
Moves the item to the Bin — see the Bin section below. Deletion is soft by default; only
`?permanent=true` destroys data.

### `POST /api/items/save-all`
The prototype's **Save All to Wardrobe (N)** button (module 04 §5b). Flips a batch of the
caller's drafts to `ready` in one request.

```ts
// request
{ itemIds: string[] }        // must all be status 'draft' and owned by the caller

// 200
{ saved: number; items: Item[] }
```

Errors: `VALIDATION_FAILED` if any id is not a draft the caller owns. All-or-nothing — a
partial save leaves the user unsure what happened.

`POST /api/items/discard-all` with the same body bins them (**Start Over**).

### `POST /api/items/[id]/condition`
Module 18. User-rated only.

```ts
// request
{ condition: 1|2|3|4|5; note?: string }
// 200
{ item: Item; entry: ConditionLogEntry }
```

Calls `rate_condition()`, which writes the immutable log row and updates the item together.

### `GET /api/insights/retailers`
```ts
{ retailers: RetailerDurability[] }   // only retailers with 3+ items
```

### `POST /api/items/[id]/wore`
The "Wore Today" button on the item card. **Increments `wearCount` by one, every wear.**
Idempotent per day — a second tap on the same date is a no-op.

```ts
// request (body optional)
{ wornOn?: string }        // ISO date, for a wearing the user forgot to log. Past only.

// 200
{ item: Item }
```

Errors: `VALIDATION_FAILED` for a future date.

### `DELETE /api/items/[id]/wore`
Undo. Removes the entry for `?wornOn=` (default today) and recalculates `lastWornOn`.

```ts
// 200
{ item: Item }
```

`PATCH /api/items/[id]` also accepts `wearCount` directly, for "I've worn this about 80
times" when digitising an item you already owned. The estimated portion is recorded in
`initialWearCount` — see module 18 §3b.

---

## Bin — modules 05, 16

### `DELETE /api/items/[id]`  → moves to the Bin
Sets `deleted_at = now()`. Does **not** touch storage. Returns `204`.
Binned items leave the wardrobe, stop counting toward the quota, and stop being
recommendable.

### `POST /api/items/[id]/restore`
Clears `deleted_at`. Fails with `ITEM_QUOTA_EXCEEDED` if restoring would put a free user
over the cap — restoring is an insert as far as the quota is concerned.

### `DELETE /api/items/[id]?permanent=true`
Deletes the row and both stored images. Irreversible. If the storage delete fails, the row is still
deleted and the orphan is logged — never leave a row pointing at nothing.

### `GET /api/bin`
```ts
{ items: Item[]; purgesAfterDays: 30 }
```

---

## Categories — module 16

### `GET /api/categories`
System defaults plus the caller's own, with live item counts for the sidebar.

```ts
{ categories: (Category & { itemCount: number })[] }
```

### `POST /api/categories`
```ts
// request
{ name: string; icon?: string; defaultSlot: Slot; subtypes?: string[];
  outfitEligible?: boolean }
// 201
{ category: Category }
```

`defaultSlot` is required — the recommendation engine cannot assemble a category that maps
to no slot. The UI must ask for it, phrased in user terms ("Where does this usually go?
Top / Bottom / Full outfit / Layer / Shoes / Accessory").

### `PATCH /api/categories/[id]` · `DELETE /api/categories/[id]`
System categories (`userId: null`) are read-only — `403 FORBIDDEN`. Deleting a custom
category sets `category_id = null` on its items rather than deleting them.

---

## Tagging — module 06

### `POST /api/items/tag`
```ts
// request
{ itemId: string }

// 200
{ item: Item }            // status 'ready', attributes filled
```

Errors: `AI_BUDGET_EXCEEDED`, `AI_UNAVAILABLE` (after retries; item left `status: 'failed'`
and the client shows a retry button), `NOT_FOUND`.

Sets `status` to `'tagging'` for the duration so a concurrent call is a no-op.

---

## Recommendations — module 08

### `GET /api/recommendations`
```
?style=business&limit=5&refresh=false
```

```ts
// 200
{ recommendations: Recommendation[];
  weather: WeatherContext | null;
  cached: boolean;
  source: 'rules' | 'llm' }
```

`refresh=true` bypasses `recommendation_cache`. Rate-limit it separately — it is the one
endpoint a bored user will hammer.

`source` is `'llm'` only when the caller is premium, has rerank budget, and the LLM layer
succeeded. Failure of the LLM layer degrades silently to `'rules'` — never a 5xx.

---

## Outfits — module 09

### `POST /api/outfits`
```ts
// request
{ itemIds: string[]; slots: Slot[];          // parallel arrays
  style?: Style; season?: Season; tempBucket?: TempBucket;
  source: RecommendationSource; score?: number; rationale?: string;
  saved?: boolean; plannedFor?: string }

// 201
{ outfit: Outfit }
```

Validation: `itemIds.length === slots.length`, slots unique, every item belongs to the
caller and is `status: 'ready'`.

### `PATCH /api/outfits/[id]` → `{ saved?, plannedFor?, rationale? }` → `{ outfit }`
### `DELETE /api/outfits/[id]` → `204`

### `GET /api/outfits?saved=true&from=&to=`
```ts
{ outfits: Outfit[] }     // items hydrated with ITEM_LIST_COLUMNS
```

---

## Feedback — module 10

### `POST /api/feedback`
```ts
// request
{ outfitId?: string; itemId?: string; kind: FeedbackKind }

// 200
{ ok: true }
```

At least one of `outfitId` / `itemId` required. `kind: 'worn'` additionally increments the
items' `wearCount` and sets `lastWornOn` to today in the user's timezone.

The style-profile update happens synchronously — it is an in-memory arithmetic update plus
one row write, not a job.

---

## Chat — module 11

### `POST /api/chat`
Streams. Premium only.

```ts
// request
{ messages: { role: 'user' | 'assistant'; content: string }[] }

// 200 — text/event-stream, Vercel AI SDK data stream protocol
```

Errors before the stream opens: `PREMIUM_REQUIRED`, `AI_BUDGET_EXCEEDED`, `AI_UNAVAILABLE`.
Once the stream has opened, errors are emitted as a stream error part, not an HTTP status.

Only the last 8 messages are sent upstream. The wardrobe is injected as a compact summary,
never as full item rows — see module 11 for the exact format.

---

## Weather — module 07

### `GET /api/weather`
Uses the caller's `profile.city`. Returns `null` when no city is set — the recommendation
engine then skips thermal scoring rather than guessing.

```ts
// 200
{ weather: WeatherContext | null }
```

---

## Account — module 03

### `GET /api/account/export`
Returns a JSON file of everything the user owns: profile, items (with signed image URLs
valid 24h), outfits, feedback, style profile.

```ts
// 200, Content-Disposition: attachment; filename="wardrobe-export.json"
{ exportedAt: string; profile: Profile; items: Item[]; outfits: Outfit[];
  feedback: Feedback[]; styleProfile: StyleProfile; imageUrls: Record<string, string> }
```

### `DELETE /api/account`
Requires `{ confirm: 'DELETE' }` in the body. Deletes the auth user (cascades every table)
and every stored image under the user's prefix. Irreversible; no soft delete.

---

## Health — module 14

### `GET /api/health`
Unauthenticated. Must actually touch Postgres — a health check that only proves Next.js is
running will report green through a paused or exhausted database.

```ts
// 200
{ ok: true; db: 'up'; latencyMs: number }
// 503
{ ok: false; db: 'down'; error: string }
```

---

## Webhooks — module 13 (PROD)

### `POST /api/webhooks/razorpay`
Unauthenticated but **signature-verified**. Reject with 400 before parsing if
`x-razorpay-signature` fails HMAC verification against `RAZORPAY_KEY_SECRET`.

Handles `subscription.activated`, `subscription.charged`, `subscription.halted`,
`subscription.cancelled`. Idempotent on Razorpay's event id — store processed ids and
no-op on repeats; Razorpay retries.

This is the only path that may write `profiles.plan`. The client never sets it.
