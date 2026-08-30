# 00 — Product definition

**Scope:** reference · **Depends on:** — · **Owns:** nothing

Read once. This file exists so an agent implementing any module knows what the product is
for and can make a sensible judgement call when the spec is silent.

## What it is

A web application where a user photographs the clothes they already own, gets them
automatically catalogued by a vision model, and receives outfit recommendations built from
that wardrobe — filtered by weather, occasion, and their learned preferences.

The one-line version: **digitise → analyse → recommend → learn.**

## What it is not

- Not a shopping app. It recommends from what the user owns. Shopping is a much later
  concern and must not leak into the data model now.
- Not a social network. No feeds, no following, no public profiles.
- Not virtual try-on. Explicitly out of scope; it was in the prototype's "future scope" and
  it stays there.

## Users

Individuals roughly 18–40 who own more clothes than they can hold in their head. During the
test phase this is 15 people the founder knows personally.

## The core loop

```
upload photo → auto-tagged in ~3s → appears in wardrobe grid
                                        ↓
      open app → weather + occasion → 5 outfit suggestions
                                        ↓
                     👍 / 👎 / "wore this" → preferences update
                                        ↓
                        next day's suggestions are better
```

Everything in this spec exists to serve that loop. If a feature does not make one of those
four arrows better, it is not in the test phase.

## Product constraints that drive the design

1. **Onboarding is the hard part, not the AI.** Photographing 25 garments is tedious, and
   this — not model quality — is what kills wardrobe apps. Bulk upload is a first-class
   flow, and the product must deliver something useful at 5 items, not 25.

2. **The AI is allowed to be wrong.** Every AI-suggested attribute is user-editable, and
   manual entry works with the AI entirely switched off. If Gemini is down the product still
   functions.

3. **Recommendations must be free to compute.** A deterministic rules engine serves every
   recommendation. The LLM adds a rerank and the human-readable rationale on top, for paying
   users, capped and cached.

4. **Users are uploading photographs of their possessions.** Row-level security from the
   first migration, real account deletion, real data export. Not optional polish.

## Glossary

Use these terms exactly; they appear in types, tables, and routes.

| Term | Meaning |
|---|---|
| **item** | One garment. Owns exactly one stored image plus a thumbnail. |
| **category** | Structural slot: `top`, `bottom`, `fullbody`, `outerwear`, `footwear`, `accessory`. Not a style label. |
| **subtype** | Free-text specific kind: "oxford shirt", "chinos". Never used for logic. |
| **formality** | 1–5. 1 loungewear, 3 smart-casual, 5 black tie. Drives pairing coherence. |
| **warmth** | 1–5. How much the garment insulates. Drives temperature matching. |
| **occasion** | What the user is dressing for. Maps to a target formality (see 08). |
| **temp bucket** | Integer 0–4 quantising temperature. Recommendations are cached per bucket, not per degree. |
| **outfit** | An ordered set of items filling distinct category slots. |
| **style profile** | Per-user learned weights: colour affinities, formality bias, vetoed pairs. |
| **wardrobe version** | Counter bumped on any item add/edit/archive. Cache key component. |
| **plan** | `free` (25-item cap) or `premium` (unlimited, AI features). |
| **correction rate** | Fraction of AI-suggested fields the user edits. The honest quality metric. |

## Success signals for the test phase

Not vanity metrics — these are the three things you cannot learn by asking, and the numbers
that decide whether to widen to production.

| Question | Instrumented as | Ready when |
|---|---|---|
| Does tagging work on other people's clothes? | correction rate (14) | < 25% |
| Does anyone finish onboarding? | time from signup to 10th item | > 10 of 15 reach 10 |
| Does anyone come back? | day-7 return | > 5 of 15 |
| Are rule-based outfits good enough? | thumbs-up rate (10) | > 60% |
