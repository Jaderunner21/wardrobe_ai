# Test → production checklist

Module 15 asks for this list to live in the repo, not only in the spec. Nothing
structural changes between the two scale targets — this is the whole list.

| # | Change | From | To | How |
|---|---|---|---|---|
| 1 | Gemini | free tier | pay-as-you-go | env change + billing alert on the Google Cloud project |
| 2 | Testers | seeded `premium` | real plan enforcement | one `UPDATE profiles SET plan = 'free'`, **and set `plan_features.item_cap`** — it is `null` on both plans today, which is what keeps every feature on every plan (module 13) |
| 3 | ~~`PHASE=test`~~ | — | — | removed; caps now come from `plan_features` only |
| 4 | `pg_cron` jobs | commented in `0001_init.sql`, `0002`, `0003` | live | uncomment in a new migration |
| 5 | `ai_jobs` retry lane | off | on | module 06 §4 |
| 6 | Cloudflare WAF | none | 20 req/min/IP on `/api/ai/*` | the one free rule |
| 7 | Staging | shares Supabase project A | its own project B | free tier allows exactly 2 |
| 8 | Weather | Open-Meteo | a commercial-permitted provider | module 07 §3 — licence, not technical |
| 8b | Images | Supabase Storage | Cloudflare R2 at ~900 accounts | module 04 — `lib/storage.ts` is the only file that changes |
| 9 | Vercel | Hobby | **Pro, before Razorpay goes live** | module 13 |
| 10 | Legal | — | privacy policy + terms | |

Item 9 is the only one that costs money and the only one not reversible by editing a
file. Items 8 and 9 are both licence problems: the free tiers of Vercel Hobby and
Open-Meteo each prohibit commercial use, and Hobby's fair-use policy counts donations
as commercial.

## Cron jobs to uncomment (item 4)

| Job | Schedule | Lives in | Purpose |
|---|---|---|---|
| `gc-reccache` | `*/15 * * * *` | `0001_init.sql` | expire recommendation cache |
| `gc-events` | `30 3 * * *` | `0001_init.sql` | 30-day retention — keeps the DB under 500 MB |
| `gc-weather` | `0 4 * * *` | `0001_init.sql` | prune stale forecasts |
| `drain-ai-jobs` | `*/5 * * * *` | `0001_init.sql` | retry failed tagging via `pg_net` → worker route |
| `purge-bin` | `0 5 * * *` | `0002_ui_alignment.sql` | delete binned items **and their stored images** after 30 days |
| `bin-stale-drafts` | `15 * * * *` | `0003_item_history.sql` | bin abandoned Review & Edit drafts after 24h |
| `downgrade-expired` | `15 2 * * *` | `0014_billing.sql` | downgrade anyone whose paid period has ended (module 13 §2) |
| `gc-outfits` | `0 4 * * *` | `0016_gc_jobs.sql` | prune unsaved, unplanned outfits older than 30d with no feedback |

`reconcile-storage` (`0016_gc_jobs.sql`) is deliberately **not** scheduled. It reports
stored objects with no `items` row and never deletes them: `storage.objects` rows *are*
the photographs, and a wrong where-clause there has no undo. Run it by hand and read the
list:

```sql
select * from orphaned_objects();
```

The worker route authenticates with `CRON_SECRET`.

## Guardrails to have on before either phase

- Google Cloud billing alert at ₹1,500 on the Gemini project
- Cloudflare and Supabase spend alerts at **any** charge at all — on a free-tier
  product, any unexpected charge means something is wrong
- Uptime monitor on `/api/health`, every 5 minutes, paging on failure
- Weekly staging keep-alive ping (free Supabase projects pause after 7 days idle)

## What has been verified, and how

Module 15's acceptance is mostly claims about a running system, so these were checked
against the live Supabase project rather than asserted:

| Claim | Result |
|---|---|
| the storage bucket is private | `public: false`; an unsigned URL is rejected with or without the anon key |
| a forged signature is rejected | 400 |
| user A cannot fetch user B's image with a valid session | a throwaway second account got 400 on the object, **404 on a request to sign it** — RLS does not even confirm the file exists — and empty lists for the folder and for `items` |
| no secret in the client bundle | passes against a real build with real secrets; planting the service-role key into `.next/static` makes it fail |
| every stored object has an `items` row | `select * from orphaned_objects()` returns 0 |

The RLS check is the one that needs a caveat. A hosted Supabase project force-enables
RLS on new `public` tables — a bare `create table` on the live database comes back with
`relrowsecurity` already true — so the failure it guards against is hard to reach there.
CI runs stock Postgres, which has no such default, and that is where a migration missing
its `enable row level security` actually gets caught. The query itself was verified by
explicitly disabling RLS on a scratch table: it reports it.

## Before you consider backups done

`.github/workflows/backup.yml` dumps weekly to a GitHub artifact. Turn it on at the
end of L1. Then **restore one dump into a scratch database and query it.** An untested
backup is a belief, not a backup.
