/**
 * The correction stream — module 05 §4.
 *
 * `correctedFields` decides what counts as the model being wrong. Over-count and the
 * correction rate measures data entry; under-count and a bad tagger looks fine. Both
 * failures are invisible in review and both make the test phase's most useful number
 * a lie, which is why this is a unit test rather than a comment.
 */
import { describe, expect, it } from 'vitest';
import { correctedFields } from '@/lib/events';

describe('correctedFields', () => {
  it('reports a changed AI field with its old and new value', () => {
    const changes = correctedFields({ style: 'casual' }, { style: 'business' });
    expect(changes).toEqual([{ field: 'style', from: 'casual', to: 'business' }]);
  });

  it('ignores fields absent from the patch', () => {
    expect(correctedFields({ style: 'casual', brand: 'Uniqlo' }, { brand: 'Uniqlo' })).toEqual([]);
  });

  it('ignores a field the user re-submitted unchanged', () => {
    expect(correctedFields({ primaryColor: 'navy' }, { primaryColor: 'navy' })).toEqual([]);
  });

  it('treats null and undefined as the same absence, not as a correction', () => {
    expect(correctedFields({ brand: null }, { brand: undefined })).toEqual([]);
  });

  it('counts filling in a field the model left empty', () => {
    expect(correctedFields({ brand: null }, { brand: "Levi's" })).toEqual([
      { field: 'brand', from: null, to: "Levi's" },
    ]);
  });

  it('counts clearing a field the model guessed — the "unknown" brand case', () => {
    expect(correctedFields({ brand: 'unknown' }, { brand: null })).toEqual([
      { field: 'brand', from: 'unknown', to: null },
    ]);
  });

  it('compares arrays by value, so a reordered season list is not a correction', () => {
    expect(correctedFields({ seasons: ['summer', 'all'] }, { seasons: ['summer', 'all'] })).toEqual(
      [],
    );
    expect(correctedFields({ seasons: ['summer'] }, { seasons: ['winter'] })).toHaveLength(1);
  });

  it('does not count user-only fields — they are data entry, not model error', () => {
    // price, notes, favourite and the rest are never filled by tagging (module 17 §3).
    const changes = correctedFields(
      { name: 'Old' } as Record<string, unknown>,
      { price: 2499, notes: 'gift', favourite: true, name: 'Old' } as Record<string, unknown>,
    );
    expect(changes).toEqual([]);
  });

  it('reports every changed field, since the rate is per field not per item', () => {
    const changes = correctedFields(
      { style: 'casual', slot: 'top', material: 'cotton' },
      { style: 'formal', slot: 'outerwear', material: 'cotton' },
    );
    // material was resubmitted unchanged, so it is not in the list.
    expect(changes.map((c) => c.field)).toEqual(['slot', 'style']);
  });
});
