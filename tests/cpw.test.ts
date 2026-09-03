/**
 * Cost per wear — module 17.
 *
 * Pure arithmetic over a purchase record, and the numbers are shown to a person about
 * their own money, so the edges matter more than usual: an unworn item must read as its
 * full price rather than crash on a division by zero, and a target already beaten must
 * not ask for more wears.
 */
import { describe, expect, it } from 'vitest';
import { costPerWear, daysSince, formatMoney, isStale, targetProgress } from '@/lib/cpw';
import type { Item, Profile } from '@/types';

const TODAY = new Date('2026-09-03T10:00:00Z');

const profile = (cpwTarget = 100): Pick<Profile, 'cpwTarget'> => ({ cpwTarget });

const garment = (over: Partial<Item> = {}): Pick<
  Item,
  'price' | 'wearCount' | 'cpwTarget' | 'purchasedOn'
> => ({
  price: null,
  wearCount: 0,
  cpwTarget: null,
  purchasedOn: null,
  ...over,
});

describe('costPerWear', () => {
  it('divides price by wears', () => {
    const cost = costPerWear(garment({ price: 4200, wearCount: 30 }), profile(), TODAY);
    expect(cost.cpw).toBe(140);
  });

  it('treats an unworn item as costing its full price, not dividing by zero', () => {
    const cost = costPerWear(garment({ price: 4200, wearCount: 0 }), profile(), TODAY);
    expect(cost.cpw).toBe(4200);
    expect(Number.isFinite(cost.cpw ?? NaN)).toBe(true);
  });

  it('has no cost per wear at all without a price — and no empty state to fill', () => {
    const cost = costPerWear(garment({ wearCount: 12 }), profile(), TODAY);
    expect(cost.cpw).toBeNull();
    expect(cost.wearsToTarget).toBeNull();
    expect(cost.wears).toBe(12);
  });

  it('counts the wears still needed to reach the target', () => {
    // 4200 / 100 = 42 wears to hit a ₹100 target; 30 done, 12 to go.
    const cost = costPerWear(garment({ price: 4200, wearCount: 30 }), profile(100), TODAY);
    expect(cost.wearsToTarget).toBe(12);
    expect(cost.reachedTarget).toBe(false);
  });

  it('never asks for more wears once the target is beaten', () => {
    const cost = costPerWear(garment({ price: 4200, wearCount: 60 }), profile(100), TODAY);
    expect(cost.reachedTarget).toBe(true);
    expect(cost.wearsToTarget).toBe(0);
  });

  it('treats exactly hitting the target as reached', () => {
    const cost = costPerWear(garment({ price: 1000, wearCount: 10 }), profile(100), TODAY);
    expect(cost.cpw).toBe(100);
    expect(cost.reachedTarget).toBe(true);
  });

  it('lets an item override the profile target', () => {
    const cost = costPerWear(
      garment({ price: 4200, wearCount: 30, cpwTarget: 200 }),
      profile(100),
      TODAY,
    );
    expect(cost.target).toBe(200);
    expect(cost.reachedTarget).toBe(true); // 140 <= 200
  });

  it('works out days owned and wears per month', () => {
    const cost = costPerWear(
      garment({ price: 4200, wearCount: 12, purchasedOn: '2026-06-05' }),
      profile(),
      TODAY,
    );
    expect(cost.daysOwned).toBe(90);
    expect(cost.wearsPerMonth).toBeCloseTo(12 / (90 / 30.44), 3);
  });

  it('leaves days owned null when the purchase date is unknown', () => {
    const cost = costPerWear(garment({ price: 4200, wearCount: 3 }), profile(), TODAY);
    expect(cost.daysOwned).toBeNull();
    expect(cost.wearsPerMonth).toBeNull();
  });

  it('survives a price stored to two decimals', () => {
    // numeric(12,2) round-trips exactly; the display formats, the maths does not round.
    const cost = costPerWear(garment({ price: 1234.56, wearCount: 3 }), profile(), TODAY);
    expect(cost.cpw).toBeCloseTo(411.52, 2);
  });
});

describe('targetProgress', () => {
  it('is zero with no price and zero at no wears', () => {
    expect(targetProgress(costPerWear(garment(), profile(), TODAY))).toBe(0);
    expect(
      targetProgress(costPerWear(garment({ price: 4200, wearCount: 0 }), profile(), TODAY)),
    ).toBe(0);
  });

  it('is full at the target and stays full past it', () => {
    expect(
      targetProgress(costPerWear(garment({ price: 1000, wearCount: 10 }), profile(100), TODAY)),
    ).toBe(1);
    expect(
      targetProgress(costPerWear(garment({ price: 1000, wearCount: 400 }), profile(100), TODAY)),
    ).toBe(1);
  });

  it('is partway in between', () => {
    const p = targetProgress(
      costPerWear(garment({ price: 4200, wearCount: 21 }), profile(100), TODAY),
    );
    expect(p).toBeGreaterThan(0.4);
    expect(p).toBeLessThan(0.6);
  });
});

describe('isStale', () => {
  it('flags something untouched for six months', () => {
    expect(isStale({ lastWornOn: '2026-01-01', createdAt: '2025-01-01', wearCount: 3 }, TODAY)).toBe(
      true,
    );
  });

  it('does not flag something worn recently', () => {
    expect(isStale({ lastWornOn: '2026-08-30', createdAt: '2025-01-01', wearCount: 3 }, TODAY)).toBe(
      false,
    );
  });

  it('measures from when it was added if it has never been worn', () => {
    expect(isStale({ lastWornOn: null, createdAt: '2026-08-20', wearCount: 0 }, TODAY)).toBe(false);
    expect(isStale({ lastWornOn: null, createdAt: '2025-08-20', wearCount: 0 }, TODAY)).toBe(true);
  });
});

describe('formatMoney', () => {
  it('formats from the profile currency', () => {
    expect(formatMoney(4200, 'INR')).toContain('4,200');
    expect(formatMoney(4200, 'USD', 'en-US')).toContain('$');
  });

  it('shows paise only when there are any', () => {
    expect(formatMoney(140, 'INR')).not.toContain('.00');
    expect(formatMoney(140.5, 'INR')).toContain('.5');
  });

  it('renders an absent price as a dash rather than zero', () => {
    // Zero and unknown are different facts, and this one is unknown.
    expect(formatMoney(null, 'INR')).toBe('—');
  });

  it('falls back rather than throwing on a bad currency code', () => {
    expect(formatMoney(100, 'NOTACODE')).toContain('100');
  });
});

describe('daysSince', () => {
  it('counts whole days and never goes negative', () => {
    expect(daysSince('2026-09-01', TODAY)).toBe(2);
    expect(daysSince('2026-09-03', TODAY)).toBe(0);
    expect(daysSince('2026-12-25', TODAY)).toBe(0); // a future date is not negative days
  });

  it('is null for a missing or unparseable date', () => {
    expect(daysSince(null, TODAY)).toBeNull();
    expect(daysSince('not-a-date', TODAY)).toBeNull();
  });
});
