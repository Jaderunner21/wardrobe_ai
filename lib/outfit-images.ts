/**
 * Signed thumbnails for a set of outfits, keyed by item id.
 *
 * Every outfit surface needs the same map, and every one of them must do it in a single
 * batch call on the server — a month of planned outfits is up to 124 images, and one
 * signing call per image would be the N+1 that module 09 §6 exists to prevent.
 */
import 'server-only';
import { publicUrlsFor } from '@/lib/storage';
import { thumbPathsOf, type OutfitWithItems } from '@/lib/outfits';

export async function outfitImageUrls(
  outfits: OutfitWithItems[],
): Promise<Record<string, string>> {
  const byPath = await publicUrlsFor(thumbPathsOf(outfits));

  const byId: Record<string, string> = {};
  for (const outfit of outfits) {
    for (const { itemId, item } of outfit.items) {
      const url = item ? byPath[item.thumbPath] : undefined;
      if (url) byId[itemId] = url;
    }
  }
  return byId;
}
