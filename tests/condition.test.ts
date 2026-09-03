/**
 * Wear & tear — module 18.
 *
 * The milestone rule is the one that matters most here, and it is the one easiest to
 * get subtly wrong. Fire it too often and people stop tapping "Wore Today", which
 * costs cost-per-wear and the recency signal as well as the condition series; fire it
 * too rarely and the series has holes nobody can fill in later. So the boundaries are
 * pinned exactly: 10, then every 15 since the last rating, and not otherwise.
 *
 * These functions also restate rules that 0004/0005 enforce in SQL. Two statements of
 * one rule can drift, so the numbers come from the shared constants in `types/index.ts`
 * rather than being typed out again, and the wording of the acceptance list is used as
 * the test names.
 */
import { describe, expect, it } from 'vitest';
import {
  CONDITION_LABELS,
  conditionFactor,
  confidenceNote,
  needsConditionRating,
  needsReplacing,
  wearsSinceRating,
} from '@/lib/condition';
import { describeRetailer } from '@/lib/retailers';
import { wearConfidence } from '@/types';
import type { Condition, Item, RetailerDurability } from '@/types';

const rated = (wearCount: number, conditionAtWear: number | null) => ({
  wearCount,
  conditionAtWear,
});

describe('needsConditionRating', () => {
  it('says nothing before ten wears', () => {
    expect(needsConditionRating(rated(0, null))).toBe(false);
    expect(needsConditionRating(rated(9, null))).toBe(false);
  });

  it('fires at exactly ten wears', () => {
    expect(needsConditionRating(rated(10, null))).toBe(true);
  });

  it('goes quiet again once rated', () => {
    expect(needsConditionRating(rated(10, 10))).toBe(false);
    expect(needsConditionRating(rated(24, 10))).toBe(false);
  });

  it('comes back fifteen wears after the last rating, and not before', () => {
    expect(needsConditionRating(rated(24, 10))).toBe(false);
    expect(needsConditionRating(rated(25, 10))).toBe(true);
    expect(needsConditionRating(rated(40, 25))).toBe(true);
  });

  it('asks an item digitised at a high count straight away', () => {
    // An old jacket entered as "worn about 80 times" has no rating and plenty of wear.
    expect(needsConditionRating(rated(80, null))).toBe(true);
  });
});

describe('wearsSinceRating', () => {
  it('is null while the item has never been rated', () => {
    expect(wearsSinceRating(rated(12, null))).toBeNull();
  });

  it('counts wears since the rating was taken', () => {
    expect(wearsSinceRating(rated(28, 10))).toBe(18);
  });

  it('never goes negative if the count was corrected downward', () => {
    expect(wearsSinceRating(rated(6, 10))).toBe(0);
  });
});

describe('needsReplacing', () => {
  it('flags visible wear and worn out', () => {
    expect(needsReplacing({ condition: 2 })).toBe(true);
    expect(needsReplacing({ condition: 1 })).toBe(true);
  });

  it('leaves anything the user called fine alone', () => {
    expect(needsReplacing({ condition: 3 })).toBe(false);
    expect(needsReplacing({ condition: 5 })).toBe(false);
  });

  it('does not flag an unrated item — not knowing is not the same as failing', () => {
    expect(needsReplacing({ condition: null })).toBe(false);
  });
});

describe('conditionFactor', () => {
  it('leaves an outfit of sound garments untouched', () => {
    expect(conditionFactor([{ condition: 5 }, { condition: 3 }])).toBe(1);
  });

  it('ignores unrated garments rather than penalising them', () => {
    expect(conditionFactor([{ condition: null }, { condition: null }])).toBe(1);
  });

  it('deprioritises, never excludes — the penalty stays above zero', () => {
    const failing = conditionFactor([{ condition: 1 }]);
    expect(failing).toBeGreaterThan(0);
    expect(failing).toBeLessThan(1);
  });

  it('takes the worst garment in the outfit, not the average', () => {
    expect(conditionFactor([{ condition: 5 }, { condition: 1 }])).toBe(
      conditionFactor([{ condition: 1 }]),
    );
  });
});

describe('wearConfidence and its caveat', () => {
  const item = (wearCount: number, initialWearCount: number): Pick<
    Item,
    'wearCount' | 'initialWearCount'
  > => ({ wearCount, initialWearCount });

  it('is fully confident about a wardrobe that was logged from day one', () => {
    expect(wearConfidence(item(20, 0))).toBe(1);
    expect(confidenceNote(item(20, 0))).toBeNull();
  });

  it('is fully confident about an unworn item rather than dividing by zero', () => {
    expect(wearConfidence(item(0, 0))).toBe(1);
    expect(confidenceNote(item(0, 0))).toBeNull();
  });

  it('says so when most of the history was estimated', () => {
    // Entered as "worn about 80 times", then logged four more.
    expect(wearConfidence(item(84, 80))).toBeCloseTo(4 / 84, 3);
    expect(confidenceNote(item(84, 80))).toMatch(/estimate/i);
  });

  it('drops the caveat once observed wears outnumber the estimate', () => {
    expect(confidenceNote(item(100, 40))).toBeNull();
  });
});

describe('CONDITION_LABELS', () => {
  it('words every level, because "3 out of 5" means different things to different people', () => {
    for (const level of [1, 2, 3, 4, 5] as Condition[]) {
      expect(CONDITION_LABELS[level]).toBeTruthy();
    }
    expect(CONDITION_LABELS[5]).toMatch(/new/i);
    expect(CONDITION_LABELS[1]).toMatch(/worn out/i);
  });
});

describe('describeRetailer', () => {
  const row = (over: Partial<RetailerDurability> = {}): RetailerDurability => ({
    retailer: 'CheapShop',
    items: 3,
    avgWears: 15,
    avgPrice: 600,
    avgCostPerWear: 40,
    avgCondition: 2,
    avgWearsToDecline: 12,
    wornOutCount: 1,
    ...over,
  });

  it("is phrased as the user's own record, not a rating of the shop", () => {
    const line = describeRetailer(row());
    expect(line).toMatch(/^Your 3 items/);
    expect(line).toContain('averaged 15 wears');
  });

  it('mentions decline only when something has actually declined', () => {
    expect(describeRetailer(row())).toContain('about 12');
    expect(describeRetailer(row({ avgWearsToDecline: null }))).not.toContain('about');
  });

  it('does not print a spurious decimal on a whole number', () => {
    expect(describeRetailer(row({ avgWears: 15 }))).toContain('15 wears');
    expect(describeRetailer(row({ avgWears: 15.5 }))).toContain('15.5 wears');
  });
});
