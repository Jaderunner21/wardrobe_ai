/**
 * Per-user feature flags — module 19 §7. Pure.
 *
 * The AI selector exists on a strong argument and no evidence: a language model has read
 * more about clothes than a colour-wheel heuristic knows, and that ought to show up in
 * the thumbs-up rate. Ought to. §7 says to run the comparison rather than assume it, and
 * to keep the rules engine if the model does not win.
 *
 * So assignment is deterministic rather than random. Random would re-roll on every
 * request and put the same person in both arms within a session, which does not just
 * add noise — it makes the two numbers uninterpretable. Hashing the user id gives a
 * stable bucket that needs no write, so the comparison is running from the moment this
 * ships, and an explicit flag on the profile overrides it for anyone we want to move.
 */
import type { Flags } from '@/types';

/** Everything the app can be flagged on. One entry today; the shape is the point. */
export const FLAG_NAMES = ['aiRecommendations'] as const;
export type FlagName = (typeof FLAG_NAMES)[number];

/**
 * FNV-1a. Not for security — for a stable, evenly spread number from a uuid with no
 * dependency and no surprises across Node versions.
 */
export function hashToUnit(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 0x1_0000_0000;
}

/** Share of unassigned users who get the AI selector. Half, so the arms are comparable. */
export const AI_ROLLOUT = 0.5;

export function aiEngineEnabled(userId: string, flags: Flags | undefined): boolean {
  const explicit = flags?.aiRecommendations;
  if (typeof explicit === 'boolean') return explicit;
  return hashToUnit(userId) < AI_ROLLOUT;
}

/** Why a user is in the arm they are in — for the admin console, which has to explain it. */
export function assignmentOf(
  userId: string,
  flags: Flags | undefined,
): { enabled: boolean; source: 'set' | 'default' } {
  const explicit = flags?.aiRecommendations;
  return typeof explicit === 'boolean'
    ? { enabled: explicit, source: 'set' }
    : { enabled: hashToUnit(userId) < AI_ROLLOUT, source: 'default' };
}

/** jsonb holds whatever was last written to it, including by a version that is not this one. */
export function toFlags(raw: unknown): Flags {
  if (!raw || typeof raw !== 'object') return {};
  const record = raw as Record<string, unknown>;

  const flags: Flags = {};
  for (const name of FLAG_NAMES) {
    if (typeof record[name] === 'boolean') flags[name] = record[name] as boolean;
  }
  return flags;
}
