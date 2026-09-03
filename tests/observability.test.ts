/**
 * Observability — module 14.
 *
 * Almost all of this is §7, privacy, because that is the part where a mistake is not
 * recoverable. An analytics row with a signed image URL in it is a leaked wardrobe
 * photograph sitting in a table with a 30-day retention; a Sentry event with an
 * Authorization header in it is a working session token in a third-party dashboard.
 * Neither is something you notice, and neither can be un-sent.
 *
 * The event names themselves are checked by `scripts/check-events.sh` rather than here:
 * "emitted from exactly one place" is a property of the whole codebase, not of a
 * function, and a unit test cannot see the call sites.
 */
import { describe, expect, it } from 'vitest';
import { AI_FIELD_COUNT, correctedFields, scrubProps } from '@/lib/events';
import { REDACTED, scrubEvent, scrubString, scrubValue } from '@/lib/sentry-scrub';

const SIGNED_URL =
  'https://abc.supabase.co/storage/v1/object/sign/wardrobe/items/u1/x.webp?token=eyJhbGciOiJIUzI1NiJ9.abc.def';
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N';

describe('scrubProps — module 14 §7', () => {
  it('keeps the event-shaped properties an event is for', () => {
    expect(scrubProps({ itemId: 'abc', count: 3, permanent: false, source: 'llm' })).toEqual({
      itemId: 'abc',
      count: 3,
      permanent: false,
      source: 'llm',
    });
  });

  it('drops an image path, whichever name it arrives under', () => {
    expect(scrubProps({ storagePath: 'items/u1/x.webp', itemId: 'a' })).toEqual({ itemId: 'a' });
    expect(scrubProps({ thumb_path: 'items/u1/x_t.webp' })).toEqual({});
    expect(scrubProps({ imageUrl: 'anything' })).toEqual({});
  });

  it('drops anything URL-shaped whatever the key is called', () => {
    // A signed URL is not a path, it is the permission to read that photograph.
    expect(scrubProps({ note: SIGNED_URL })).toEqual({});
    expect(scrubProps({ somethingNew: 'https://example.com/x' })).toEqual({});
  });

  it('drops free text the user wrote', () => {
    expect(scrubProps({ message: 'hello', text: 'hi', notes: 'my jacket' })).toEqual({});
  });

  it('drops colour data — a wardrobe must not be reconstructable from events', () => {
    expect(scrubProps({ primaryColor: 'navy', colorHex: '#000080', itemId: 'a' })).toEqual({
      itemId: 'a',
    });
  });

  it('drops nested objects, which is where a forbidden key would hide', () => {
    expect(scrubProps({ item: { storagePath: 'items/u1/x.webp' }, count: 1 })).toEqual({
      count: 1,
    });
  });

  it('truncates long strings rather than storing an essay', () => {
    const long = 'x'.repeat(500);
    const out = scrubProps({ field: long }).field as string;
    expect(out.length).toBeLessThanOrEqual(40);
  });

  it('keeps null and numbers, which carry no content', () => {
    expect(scrubProps({ confidence: 0.82, cached: true, at: null })).toEqual({
      confidence: 0.82,
      cached: true,
      at: null,
    });
  });
});

describe('correctedFields — the correction rate', () => {
  it('reports one change per differing AI field', () => {
    const changes = correctedFields(
      { primaryColor: 'navy', material: 'cotton' },
      { primaryColor: 'charcoal', material: 'cotton' },
    );
    expect(changes).toEqual([{ field: 'primaryColor', from: 'navy', to: 'charcoal' }]);
  });

  it('ignores fields the AI never fills, or the metric measures data entry', () => {
    // price, notes and favourite are user-entered (module 17 §3) — not corrections.
    const changes = correctedFields({} as Record<string, unknown>, {
      price: 4200,
      notes: 'a note',
    } as Record<string, unknown>);
    expect(changes).toEqual([]);
  });

  it('treats an unchanged field as no correction, including null vs undefined', () => {
    expect(correctedFields({ brand: null }, { brand: null })).toEqual([]);
    expect(correctedFields({ brand: undefined }, { brand: null })).toEqual([]);
  });

  it('counts an array change, like seasons', () => {
    const changes = correctedFields({ seasons: ['summer'] }, { seasons: ['summer', 'monsoon'] });
    expect(changes).toHaveLength(1);
    expect(changes[0]!.field).toBe('seasons');
  });

  it('exposes the field count docs/queries.sql divides by', () => {
    // The denominator of the correction rate. If these drift the metric silently lies.
    expect(AI_FIELD_COUNT).toBe(13);
  });
});

describe('sentry scrubbing — module 14 §4', () => {
  it('redacts a signed storage URL anywhere in a string', () => {
    expect(scrubString(`failed to fetch ${SIGNED_URL}`)).toBe(`failed to fetch ${REDACTED}`);
    expect(scrubString(SIGNED_URL)).not.toContain('token=');
  });

  it('redacts a JWT — a session token or the service-role key', () => {
    expect(scrubString(`Bearer ${JWT}`)).toBe(`Bearer ${REDACTED}`);
  });

  it('redacts a Gemini key', () => {
    expect(scrubString('key=AIzaSyD-1234567890abcdefghijklmnop')).toBe(`key=${REDACTED}`);
  });

  it('leaves an ordinary message alone', () => {
    const message = 'column outfits.style does not exist';
    expect(scrubString(message)).toBe(message);
  });

  it('drops credential headers by name, whatever their case', () => {
    const scrubbed = scrubValue({
      request: { headers: { Authorization: 'Bearer x', cookie: 'sb=1', 'user-agent': 'Chrome' } },
    }) as { request: { headers: Record<string, string> } };

    expect(scrubbed.request.headers.Authorization).toBe(REDACTED);
    expect(scrubbed.request.headers.cookie).toBe(REDACTED);
    // Not everything goes — a user agent is the sort of context an error is for.
    expect(scrubbed.request.headers['user-agent']).toBe('Chrome');
  });

  it('reaches into arrays and nested objects', () => {
    const scrubbed = scrubValue({
      breadcrumbs: [{ message: `GET ${SIGNED_URL}` }, { message: 'ok' }],
    }) as { breadcrumbs: { message: string }[] };

    expect(scrubbed.breadcrumbs[0]!.message).toBe(`GET ${REDACTED}`);
    expect(scrubbed.breadcrumbs[1]!.message).toBe('ok');
  });

  it('stops at a depth limit rather than hanging on a deep structure', () => {
    // An error handler that hangs is worse than no error handler.
    let deep: Record<string, unknown> = { value: 'end' };
    for (let i = 0; i < 40; i += 1) deep = { nested: deep };

    expect(() => scrubValue(deep)).not.toThrow();
  });

  it('survives a cyclic object, which a Sentry event can contain', () => {
    const cyclic: Record<string, unknown> = { name: 'x' };
    cyclic.self = cyclic;

    expect(() => scrubEvent(cyclic)).not.toThrow();
  });

  it('keeps the stack trace, which is the whole point of sending anything', () => {
    const event = scrubEvent({
      exception: { values: [{ type: 'TypeError', value: 'x is not a function' }] },
    }) as { exception: { values: { type: string; value: string }[] } };

    expect(event.exception.values[0]!.type).toBe('TypeError');
    expect(event.exception.values[0]!.value).toBe('x is not a function');
  });
});
