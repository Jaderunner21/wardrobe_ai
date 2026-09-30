'use client';

/**
 * Editing a garment already in the wardrobe — module 05 §4, module 16 §3's ✎ action.
 *
 * Until now the only edit surface was the upload flow's Review step, which disappears
 * once you hit Save All: getting a name wrong or adding a price later meant SQL. This
 * reuses the same form component, so the two paths cannot drift.
 *
 * Every change here goes through PATCH /api/items/[id], which sets `userEdited` and
 * emits one `item.corrected` event per changed AI field. That means corrections made
 * weeks later count toward the correction rate, not just the ones made at upload — the
 * metric was previously blind to exactly the edits that matter most.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  ItemDraftForm,
  draftToPatch,
  type DraftFields,
} from '@/components/upload/ItemDraftForm';
import type { ApiError, Category, Item } from '@/types';

export function EditItemForm({
  item,
  categories,
  imageUrl,
}: {
  item: Item;
  categories: Category[];
  imageUrl?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<DraftFields>(() => fieldsFrom(item));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);

    // `status` stays whatever it is: this item is already in the wardrobe, and the
    // draft→ready promotion belongs to the upload flow.
    const patch: Record<string, unknown> = { ...draftToPatch(fields, categories) };
    delete patch.status;

    const response = await fetch(`/api/items/${item.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? 'Could not save those changes.');
      setSaving(false);
      return;
    }

    setSaving(false);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setFields(fieldsFrom(item));
          setOpen(true);
        }}
        className="rounded-[var(--radius)] border border-border px-3 py-2 text-meta font-medium hover:bg-brand-50"
      >
        Edit details
      </button>
    );
  }

  return (
    <div className="mt-6 space-y-3">
      <ItemDraftForm
        index={0}
        previewUrl={imageUrl}
        fields={fields}
        categories={categories}
        tag={item.aiConfidence != null ? 'done' : 'skipped'}
        confidence={item.aiConfidence}
        onChange={setFields}
        onRemove={() => setOpen(false)}
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-[var(--radius)] bg-brand-500 px-4 py-2 text-meta font-medium text-on-brand hover:bg-brand-600 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={saving}
          className="rounded-[var(--radius)] border border-border px-4 py-2 text-meta font-medium hover:bg-brand-50"
        >
          Cancel
        </button>
      </div>

      {error && (
        <p role="alert" className="text-meta text-danger-600">
          {error}
        </p>
      )}
    </div>
  );
}

/** The stored item, as the shared form's field shape. */
function fieldsFrom(item: Item): DraftFields {
  return {
    name: item.name ?? '',
    categoryId: item.categoryId ?? '',
    subtype: item.subtype ?? '',
    primaryColor: item.primaryColor ?? '',
    colorHex: item.colorHex ?? '',
    style: item.style ?? '',
    seasons: item.seasons,
    brand: item.brand ?? '',
    userTags: item.userTags.join(', '),
    notes: item.notes ?? '',
    price: item.price === null ? '' : String(item.price),
    purchasedOn: item.purchasedOn ?? '',
    retailer: item.retailer ?? '',
    // Editable here too — module 18 §3b: forgetting to log for a week is normal, and
    // correcting the number should not need a support request.
    wearCount: String(item.wearCount),
  };
}
