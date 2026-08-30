# 04 — Media pipeline

**Scope:** TEST · **Depends on:** 03 · **Owns:** `lib/image.ts`, `lib/storage.ts`,
`app/api/items/presign/route.ts`, the upload UI

## Responsibility

Get a photo from a phone camera into object storage as a small WebP, without the bytes ever
passing through a serverless function, and without ever storing two copies of the same
garment.

**This is the module where the storage budget is won or lost.** Naive handling — accept the
original JPEG, POST it to an API route, write it server-side — costs roughly 34 GB at
production scale, burns function time proportional to file size, and moves every byte across
your bandwidth allowance twice.

## Storage provider

**Supabase Storage** for the test phase. One fewer account, one fewer set of credentials, and
image access is enforced by the same RLS system as everything else.

| | Free allowance | 15 testers | Ceiling |
|---|---|---|---|
| Storage | 1 GB | 28 MB (2.8%) | **~900 accounts** at 18 items each |
| Egress | 5 GB/mo | ~162 MB (3%) | ~1,400 accounts |

Storage is what runs out first, at roughly 900 accounts. Past that, move to Cloudflare R2 —
10 GB free and no egress charge ever.

**The swap is deliberately cheap.** The database stores *paths*, never URLs, and every
storage call goes through `lib/storage.ts`. Changing provider is that one file plus a bucket
migration — no schema change, no column rename. That is why the columns are called
`storage_path` and `thumb_path` rather than anything provider-specific.

## Contracts

```ts
// lib/image.ts — CLIENT ONLY, uses canvas
export interface ProcessedImage {
  main: Blob;          // WebP, longest edge 800px, q0.70
  thumb: Blob;         // WebP, longest edge 240px, q0.70
  width: number;       // of main
  height: number;
  contentHash: string; // sha-256 hex of main's bytes
}
export function processImage(file: File): Promise<ProcessedImage>;
```

```ts
// lib/storage.ts — the ONLY file that knows which provider is in use
export function signedUploadUrl(path: string): Promise<{ path: string; token: string }>;
export function signedUrl(path: string, expiresIn?: number): Promise<string>;
export function publicUrlFor(path: string, day?: string): Promise<string>;  // day-rounded, cacheable
export function deleteObjects(paths: string[]): Promise<void>;
export function listUserObjects(userId: string): Promise<string[]>;
```

Nothing outside this file may import the Supabase storage client directly. That rule is the
entire cost of the future R2 migration.

Path layout — prefixed by user so deletion is a prefix operation and RLS is a path check:

```
items/{userId}/{itemId}.webp
items/{userId}/{itemId}_t.webp
```

`POST /api/items/presign` → see `api-contracts.md`.

## Bucket setup

One bucket named `items`, **private**. Not public — these are photographs of people's
belongings, and a public bucket means anyone holding a URL can see one forever.

Storage RLS policies, applied in a migration:

```sql
insert into storage.buckets (id, name, public) values ('items', 'items', false);

-- a user may only touch objects under their own user-id prefix
create policy "own items read" on storage.objects for select
  using (bucket_id = 'items' and (storage.foldername(name))[2] = auth.uid()::text);

create policy "own items write" on storage.objects for insert
  with check (bucket_id = 'items' and (storage.foldername(name))[2] = auth.uid()::text);

create policy "own items delete" on storage.objects for delete
  using (bucket_id = 'items' and (storage.foldername(name))[2] = auth.uid()::text);
```

`foldername(name)[2]` is the user id, because the path is `items/{userId}/{file}`. Verify the
index on a real path before trusting it — an off-by-one here silently grants everyone access
to everything.

## Behaviour

### 1. Compress before anything leaves the browser

```
File → createImageBitmap → OffscreenCanvas(scaled) → canvas.convertToBlob({type:'image/webp', quality:0.70})
```

Longest edge 800 px for main, 240 px for thumb, preserving aspect ratio. Never upscale — an
image already under the limit is re-encoded but not enlarged.

A 4 MB phone photo becomes roughly 55 KB main + 8 KB thumb. Clothing recognition does not
need 12 megapixels; 800 px is comfortably above what the vision model resolves.

Strip EXIF as a side effect of the canvas round-trip — which also removes GPS coordinates
from photos taken at home. Do apply EXIF orientation before drawing, or portrait photos from
iOS arrive sideways.

### 2. Hash for dedupe

SHA-256 of the main blob's bytes via `crypto.subtle.digest`, hex-encoded. Sent to
`/presign`, which pre-checks it, and stored in `items.content_hash` where a partial unique
index makes it authoritative.

Hash the *processed* bytes, not the original. Deterministic encoding means the same garment
photographed once and uploaded twice collides; two genuinely different photos of the same
shirt do not, which is correct — they are different items until the user says otherwise.

### 3. Signed upload, direct from the browser

The API route validates quota, hash, and size, then returns a signed upload token per file.
The browser uploads straight to Supabase Storage:

```ts
await supabase.storage.from('items')
  .uploadToSignedUrl(path, token, blob, { contentType: 'image/webp' });
```

The function never sees image bytes. Its duration is constant regardless of file size, and
upload bandwidth never touches Vercel.

Tokens are valid for two hours, which is generous for a bulk upload on a slow connection and
short enough that a leaked token is worthless by the time anyone finds it.

### 4. Reject early

`/presign` returns `ITEM_QUOTA_EXCEEDED` *before* the upload, so a free user at 25 items
fails in a second rather than after uploading. Same for `DUPLICATE_ITEM` — the client can
then offer "you already have this" and link to the existing item.

Also reject `bytes > 500_000`. A correctly processed 800 px WebP is never near that; a
larger one means the client-side pipeline was bypassed.

### 5. Bulk upload

Users arrive with 20 photos at once. Process and upload with a concurrency limit of 3 —
higher saturates mobile uplink and makes every item slower. Per-item progress and per-item
failure; one failure must not abort the batch.

Order: process all files client-side first (fast, local, gives an accurate progress total),
then upload. A user who sees "3 of 20" move steadily will wait; one watching an indefinite
spinner will not.

### 5b. Nothing enters the wardrobe until the user says so

The prototype's flow, which the spec now follows:

```
Choose Photos → "Analyzing with AI… (N items)"
              → "Review & Edit Items"  — one card per photo, AI confidence shown
              → edit anything          — or × to drop that one
              → "Save All to Wardrobe (N)"
```

Rows are created on upload with `status: 'draft'` and are invisible everywhere except this
screen. **Save All** flips them to `ready` in one request; **Start Over** bins them.

This is better than saving straight to the wardrobe and it is worth keeping:

- the user sees the AI's guess *before* it becomes their data, so a bad tag is caught in the
  moment rather than discovered three weeks later
- every edit made here is a correction event (module 14) — this screen is where your
  correction-rate metric actually comes from
- confidence per item lets the user skim the ones the model was sure about and focus on the
  rest

Why a `draft` row rather than pure client state: the bytes are already uploaded, so the
quota, the dedupe index, and orphan-prevention all need a row. Drafts count toward the quota
for the same reason. Abandoned drafts are binned after 24 hours (`DRAFT_TTL_HOURS`).

### 6. Serving — signed URLs with a day-rounded expiry

The bucket is private, so every image needs a signed URL. Naively, that means a new URL on
every render, which defeats browser and CDN caching and burns your 5 GB egress allowance.

**Round the expiry to a day boundary.** The same path produces the same URL for the whole
day, so the browser caches it and repeat views cost nothing:

```ts
export async function publicUrlFor(path: string) {
  // expires at the next UTC midnight + 1 day, so the URL is stable all day
  const expiresIn = secondsUntilTomorrowMidnight() + 86_400;
  const { data } = await supabase.storage.from('items').createSignedUrl(path, expiresIn);
  return data!.signedUrl;
}
```

Generate these in the Server Component that renders the grid, never per-image in a client
component — one batch call (`createSignedUrls`) for the whole page.

The database stores paths only. No absolute URL is ever written to a row, which is what makes
the provider swap a one-file change.

Do not use `next/image` for item images. Vercel's optimiser bills per transformation
(5,000/month on Hobby) to re-do work already done client-side. Plain `<img>` with explicit
`width`/`height` and `loading="lazy"`.

### 7. Orphan handling

An upload that succeeds while the subsequent `POST /api/items` fails leaves an object with
no row. At test scale this is rare and cheap; log it and move on. At production, a weekly
job reconciles the bucket prefix against `items.storage_path` (module 15).

Never the reverse — a row must never point at an object that does not exist. Which is why
the row is created *after* the upload, not before.

## Acceptance

- [ ] a 4 MB iPhone JPEG produces a main blob under 80 KB with correct orientation
- [ ] EXIF, including GPS, is absent from the uploaded bytes
- [ ] the same file uploaded twice yields an identical `contentHash`
- [ ] presign rejects with `ITEM_QUOTA_EXCEEDED` at 25 items on a `free` profile, before
      any upload occurs
- [ ] no image bytes appear in any API route's request or response body
- [ ] the bucket is private — a raw storage URL without a signature returns 400
- [ ] **user A cannot read, write or delete an object under user B's prefix** — test this
      explicitly with two accounts, it is the whole point of the storage policies
- [ ] the same image renders the same signed URL twice within one day (cacheable)
- [ ] bulk upload of 20 files completes with per-item progress; killing one mid-flight
      leaves the other 19 successful
- [ ] `deleteObjects` removes both main and thumb
- [ ] nothing outside `lib/storage.ts` imports the storage client

## Out of scope

- Background removal, cropping, colour correction. The model handles varied backgrounds.
- Multiple images per item. One item, one photo. Changing this later means a `media` table;
  it is deliberately not in scope now.
- Video.
- Cloudflare R2. It is where this goes at ~900 accounts, and `lib/storage.ts` exists so that
  day is a config change rather than a project.
