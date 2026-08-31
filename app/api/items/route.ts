/**
 * GET /api/items   — filter changes and pages past the first (module 05 §3)
 * POST /api/items  — create the row after a successful upload (module 04 §7)
 *
 * The initial wardrobe render is a Server Component querying Supabase directly; this
 * route exists for interaction, not for feeding the first paint (module 01).
 */
import { handle, ok, parseBody } from '@/lib/api';
import { appError } from '@/lib/errors';
import { requireUser, createClient } from '@/lib/supabase/server';
import { listItems, ITEM_DETAIL_SELECT } from '@/lib/items';
import { publicUrlsFor } from '@/lib/storage';
import { toItem, type ItemRow } from '@/lib/mappers';
import { track } from '@/lib/events';
import { createItemSchema, listQuerySchema } from './schemas';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request: Request) => {
  await requireUser();
  const supabase = await createClient();

  const parsed = listQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join('.') || '_'] = issue.message;
    throw appError('VALIDATION_FAILED', undefined, fields);
  }

  const page = await listItems(supabase, parsed.data);

  // `imageUrls` is additive to the shape in api-contracts.md. Signing happens on the
  // server (module 04 §6 — one batch call, never one per image in a client
  // component), so a client appending page two has no other way to get them.
  const imageUrls = await publicUrlsFor(page.items.map((i) => i.thumbPath));

  return ok({
    ...page,
    imageUrls: Object.fromEntries(
      page.items.flatMap((i) => {
        const url = imageUrls[i.thumbPath];
        return url ? [[i.id, url] as const] : [];
      }),
    ),
  });
});

export const POST = handle(async (request: Request) => {
  const user = await requireUser();
  const body = await parseBody(request, createItemSchema);
  const supabase = await createClient();

  // The path is derived from the user id, never taken on trust: a body claiming
  // `items/<someone-else>/x.webp` would otherwise write a row pointing into another
  // user's prefix, which they could then never read and we could never clean up.
  const expected = `items/${user.id}/${body.itemId}`;
  if (body.storagePath !== `${expected}.webp` || body.thumbPath !== `${expected}_t.webp`) {
    throw appError('VALIDATION_FAILED', 'Storage path does not belong to this item.', {
      storagePath: 'Must match items/{userId}/{itemId}.webp',
    });
  }

  /**
   * Status on create — module 05 §2 and module 04 §5b.
   *
   * Attributes supplied means the user typed them on the upload screen, so the item
   * is a `draft` awaiting Save All. No attributes means tagging will follow, so it is
   * `uploaded`. Nothing reaches `ready` without the user confirming it, which is what
   * makes the Review & Edit step honest.
   *
   * (api-contracts.md still says a manual create lands on `ready` — that predates the
   * draft state added in 0003_item_history.sql. The lifecycle in module 05 §2 wins.)
   */
  const described =
    body.name != null ||
    body.categoryId != null ||
    body.slot != null ||
    body.style != null ||
    body.primaryColor != null;

  const { data, error } = await supabase
    .from('items')
    .insert({
      id: body.itemId,
      user_id: user.id,
      status: described ? 'draft' : 'uploaded',
      storage_path: body.storagePath,
      thumb_path: body.thumbPath,
      content_hash: body.contentHash,
      bytes: body.bytes,
      width: body.width,
      height: body.height,
      name: body.name ?? null,
      notes: body.notes ?? null,
      category_id: body.categoryId ?? null,
      slot: body.slot ?? null,
      style: body.style ?? null,
      brand: body.brand ?? null,
      subtype: body.subtype ?? null,
      primary_color: body.primaryColor ?? null,
      color_hex: body.colorHex ?? null,
      secondary_colors: body.secondaryColors ?? [],
      pattern: body.pattern ?? null,
      material: body.material ?? null,
      formality: body.formality ?? null,
      warmth: body.warmth ?? null,
      seasons: body.seasons ?? [],
      user_tags: body.userTags ?? [],
      user_edited: described,
      price: body.price ?? null,
      currency: body.currency ?? null,
      purchased_on: body.purchasedOn ?? null,
      retailer: body.retailer ?? null,
      cpw_target: body.cpwTarget ?? null,
    })
    .select(ITEM_DETAIL_SELECT)
    .single();

  // The quota trigger and the dedupe index raise here; lib/errors maps both to the
  // codes the client switches on.
  if (error) throw error;

  await track('item.created', { itemId: body.itemId, manual: described });

  return ok({ item: toItem(data as unknown as ItemRow) }, { status: 201 });
});
