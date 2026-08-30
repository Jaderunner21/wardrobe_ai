# Wardrobe AI — Implementation Spec

Modular system specification. Each numbered file is a self-contained module: an agent can
implement it from that file plus `types.ts`, `api-contracts.md`, and `schema.sql` alone.

## How to use this with an AI IDE

Give the agent **one module file at a time**, plus the three shared references. Do not paste
the whole folder into context — modules are deliberately decoupled so you don't have to.

Every module file has the same shape:

| Section | Purpose |
|---|---|
| `Depends on` | modules that must exist first |
| `Owns` | tables, routes, and files this module and only this module may touch |
| `Scope` | `TEST` = build now (15 testers) · `NEXT` = first thing after the test run · `PROD` = defer to production |
| Responsibility | one paragraph, what this module is for |
| Contracts | types, routes, error codes — the interface other modules rely on |
| Behaviour | numbered, testable rules |
| Acceptance | checklist a reviewer or agent can verify |
| Out of scope | what NOT to build here, and which module owns it instead |

**"Owns" is the important one.** If two modules both want to write `items`, one of them is
wrong. Route the change through the owner.

## Shared references

| File | What it is |
|---|---|
| `types.ts` | Single source of truth for shared types. Copy into `types/index.ts`. Never redeclare these locally. |
| `api-contracts.md` | Every HTTP route, request/response shape, and error code in one place. |
| `schema.sql` | Complete DDL. Applied and tested against Postgres 16. Becomes migration `0001_init`. |
| `0002_ui_alignment.sql` | Reconciles the schema with the working prototype — categories table, slots, styles, the Bin. Applied and tested on top of `0001`. |
| `0003_item_history.sql` | The `draft` review step, item name/notes, and purchase history + cost-per-wear. Applied and tested on top of `0002`. |
| `0004_wear_and_tear.sql` | Condition tracking and retailer durability. Applied and tested on top of `0003`. |
| `0005_wear_logging.sql` | Wear logging — backdating, undo, direct entry, and the estimated-vs-observed split. Applied and tested on top of `0004`. |

## Module index

| # | Module | Scope | Depends on |
|---|---|---|---|
| 00 | [Product definition](00-product.md) | — | — |
| 01 | [Conventions](01-conventions.md) | TEST | — |
| 02 | [Data model](02-data-model.md) | TEST | 01 |
| 03 | [Auth & accounts](03-auth-accounts.md) | TEST | 02 |
| 04 | [Media pipeline](04-media-pipeline.md) | TEST | 03 |
| 05 | [Wardrobe items](05-wardrobe-items.md) | TEST | 04 |
| 06 | [AI tagging](06-ai-tagging.md) | TEST | 05, 12 |
| 07 | [Weather context](07-weather-context.md) | TEST | 02 |
| 08 | [Recommendation engine](08-recommendation-engine.md) | TEST | 05, 07 |
| 09 | [Outfits & calendar](09-outfits-calendar.md) | TEST | 08 |
| 10 | [Feedback & learning](10-feedback-learning.md) | TEST | 09 |
| 11 | [Stylist chat & rerank](11-stylist-chat.md) | rerank TEST · chat PROD | 05, 12 |
| 12 | [AI budget guard](12-ai-budget-guard.md) | TEST | 02 |
| 13 | [Billing](13-billing.md) | PROD | 03 |
| 14 | [Observability](14-observability.md) | TEST | 02 |
| 15 | [Deployment](15-deployment.md) | TEST | all |
| 16 | [UI & design system](16-ui-design-system.md) | TEST | 05, 08, 09 |
| 17 | [Item history & cost-per-wear](17-item-history-cpw.md) | TEST | 05, 09, 10 |
| 18 | [Wear & tear](18-wear-and-tear.md) | TEST | 05, 17 |
| 19 | [AI recommendation engine](19-ai-recommendation-engine.md) | **NEXT** | 08, 12 |

## Build order

Layers, not dates. Each layer ends somewhere you can stop and look at the thing.

```
L0  Foundation      01 → 02 → 03 → 16(tokens+shell) → 15(deploy pipeline, env)
L1  Wardrobe core   04 → 05 → 16(wardrobe, upload, bin)  gate: your own wardrobe lives in it
L2  Tagging         12 → 06                              gate: correction rate < 25%
L3  Recommendations 07 → 08 → 09 → 10 → 16(dashboard, outfits)
                                                         gate: suggestions aren't embarrassing
L4  AI + polish     11 → 17 → 18 → 16(states, mobile)   gate: ship to the 15 testers
                    ── test run ──
L5  AI ENGINE       19        <-- FIRST thing after the test. Not deferred.
L6  Production      13 → 14(full) → 15(full)
```

Do not start L2 before L1's gate passes. The whole point of manual item entry existing first
is that it is your permanent fallback when the AI is wrong or down.

## Two scale targets

The architecture is identical at both. Only operational depth differs.

| | Test | Production |
|---|---|---|
| Users | 15 | 5,000 |
| Items | ~450 | ~90,000 |
| Peak load | 0.005 rps | 0.55 rps |
| Image storage | 28 MB | 5.4 GB |
| Postgres | 1.7 MB | 416 MB of 500 MB |
| Gemini | free tier (8% of quota) | pay-as-you-go |
| Cost | ₹0/mo | ₹871/mo free · ₹2,631/mo monetised |

Modules marked `PROD` are specified but not built during the test phase. Modules marked
`TEST` are built now — every one of them is either structural (changing it later means
migrating live data) or costs an hour.

## Non-negotiables

Six things where taking the shortcut now is expensive later. Called out again in the
modules that own them:

1. **RLS on every table from the first migration** (02). Retrofitting tenancy is a rewrite.
2. **Images compressed client-side, uploaded direct to storage** (04). You cannot
   re-compress photos you received at 4 MB. Storage runs through `lib/storage.ts` and the DB
   holds paths, not URLs, so moving from Supabase Storage to R2 later is one file.
3. **The recommendation engine is a pure function over its context** (08). That is what lets
   module 19 swap garment selection to a model with no migration and keep the rules path as
   a working fallback. Put a database query inside it and that swap becomes a rewrite.
4. **Vercel Pro before any payment goes live** (13). Hobby's fair-use policy forbids
   commercial use, including donations. Shipping payments on Hobby risks the deployment.
5. **Condition tracking from day one** (18). It is a time series — add it later and every
   garment bought before that day has no history and never can. One table, two columns now;
   a permanent hole in the data if deferred.
6. **`slot` and `category` are separate axes** (16 §7.1). Slots are a fixed internal enum the
   outfit engine assembles on; categories are a user-extensible table the UI displays.
   Collapsing them back into one field breaks either custom categories or Activewear.

## Design authority

The working prototype (18 screenshots, 28 Aug 2026) is the authority for **look and screen
inventory** — palette, layout, component anatomy, the six nav destinations. Module 16 records
it, including exact sampled colour tokens.

This spec is the authority for **data model and behaviour**. Module 16 §7 lists the four
places they disagreed and what was decided, with reasons. Read that section before
implementing anything that touches categories, styles, or deletion.
