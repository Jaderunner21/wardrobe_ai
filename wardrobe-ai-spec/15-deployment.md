# 15 — Deployment

**Scope:** TEST (partial) → PROD (full) · **Depends on:** all · **Owns:** DNS, environments,
CI, backups, cron

## Responsibility

Get it on the domain, keep secrets out of the browser, and make sure nobody can lose their
wardrobe.

## DNS

Cloudflare is the DNS provider throughout. Replace `wardrobe.tld` with the real domain.

| Host | Type | Target | Proxy | Purpose |
|---|---|---|---|---|
| `wardrobe.tld` | A | `76.76.21.21` | DNS only | apex → Vercel production |
| `www` | CNAME | `cname.vercel-dns.com` | DNS only | redirect to apex |
| `staging` | CNAME | `cname.vercel-dns.com` | DNS only | staging branch (PROD) |
| `@` | TXT / MX | SPF, DKIM, DMARC | — | transactional email deliverability |

Images are served from Supabase's own domain via signed URLs (module 04 §6), so there is no
image subdomain to configure. Cloudflare is optional at this stage — your registrar's DNS
will do. If you do use Cloudflare, leave the Vercel records grey-clouded; Vercel runs its own
edge network and double-proxying causes cache and certificate confusion.

## Environments

| | Test phase | Production |
|---|---|---|
| Production | `main` → apex, Supabase project A | same |
| Staging | preview deploys against project A | `develop` → `staging`, **separate** Supabase project B |
| Preview | per-PR, Vercel Authentication on | same |

Splitting staging into its own Supabase project is deferred during the test phase — the only
data is test data. Split it before real users, not before testers. Note the free tier allows
2 active projects, which is exactly production + staging.

## Secrets

| Variable | Scope | If leaked |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | server | bypasses all RLS — total data access |
| `GEMINI_API_KEY` | server | unbounded billing against your card |
| `RAZORPAY_KEY_SECRET` | server | forged webhooks → free premium |
| `CRON_SECRET` | server | anyone triggers your background jobs |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | nothing, **provided RLS is correct everywhere** |

Only `NEXT_PUBLIC_`-prefixed variables reach the client bundle. The failure mode to guard
against is importing a server module into a client component and dragging a secret along —
Next.js catches most of these, not all.

CI step: grep the built bundle for each secret's value and fail if found.

```bash
pnpm build
for v in SUPABASE_SERVICE_ROLE_KEY GEMINI_API_KEY; do
  grep -rq "${!v}" .next/static && { echo "LEAK: $v in client bundle"; exit 1; }
done
```

## CI

Runs on every PR. Fails the build, does not warn.

1. `tsc --noEmit`
2. `eslint`
3. unit tests — recommender, colour, learning, error mapping, Gemini parsing
4. **RLS check** — the query from module 02 §1
5. **no `select('*')`** — grep
6. **every Gemini call site calls `assertBudget`** — grep
7. **secret leak check** — above
8. migrations apply cleanly to a fresh Postgres

Items 4–7 are three greps and a query. They cost nothing and each guards a failure that is
invisible in code review.

## Backups

**The one unrecoverable failure.** Your testers hand-enter attributes for hundreds of items;
that is hours of human work with no undo, and Supabase's free-tier backup policy is thin.

Weekly GitHub Action:

```yaml
- run: pg_dump "$SUPABASE_DB_URL" --no-owner --format=custom -f dump.pgc
- uses: actions/upload-artifact@v4
  with: { name: db-backup-${{ github.run_id }}, path: dump.pgc, retention-days: 90 }
```

GitHub Actions artifacts are free and retained 90 days — enough for a test phase, and it
avoids a second storage account. At production, push these to R2 or somewhere off-platform;
a backup living inside the same provider as the database is not really a backup. **Restore one into a scratch database and verify it before you consider this
done** — an untested backup is a belief, not a backup.

Start this at the end of L1, not at launch. The moment there is a wardrobe worth losing.

## Cron (PROD)

Vercel's Hobby plan throttles cron frequency, so scheduled work lives in Supabase
`pg_cron` — inside the database you already pay nothing for, at any interval.

Uncomment in `schema.sql` at production:

| Job | Schedule | Purpose |
|---|---|---|
| `gc-reccache` | `*/15 * * * *` | expire recommendation cache |
| `gc-events` | `30 3 * * *` | 30-day retention — keeps you under 500 MB |
| `gc-weather` | `0 4 * * *` | prune stale forecasts |
| `drain-ai-jobs` | `*/5 * * * *` | retry failed tagging via `pg_net` → worker route |
| `gc-outfits` | `0 4 * * *` | prune unsaved outfits > 30d with no feedback |
| `reconcile-storage` | weekly | find stored objects with no `items` row |

The worker route authenticates with `CRON_SECRET`.

## Guardrails

| Guard | Setting | Phase |
|---|---|---|
| Google Cloud billing alert | ₹1,500 on the Gemini project | both |
| Cloudflare / Supabase spend alerts | any charge at all | both |
| Cloudflare WAF rate limit | 20 req/min/IP on `/api/ai/*` — the one free rule | PROD |
| Per-user AI caps | module 12 | both |
| Uptime monitor | `/api/health`, 5 min | both |
| Staging keep-alive | weekly ping — free projects pause after 7 days idle | PROD |

On a free-tier product, *any* unexpected charge is a signal something is wrong. Alert at
zero, not at a threshold.

## Test → production checklist

Nothing structural changes. This is the whole list:

```
1. Gemini free tier      → pay-as-you-go            env change + billing alert
2. testers premium       → real plan enforcement    one UPDATE
3. PHASE=test            → unset                    restores production AI caps
4. uncomment pg_cron jobs in a migration
5. enable ai_jobs retry lane (module 06 §4)
6. Cloudflare WAF rate limit on /api/ai/*
7. split staging into its own Supabase project
8. Open-Meteo            → commercial-permitted provider (module 07 §3)
8b. Supabase Storage     → Cloudflare R2 at ~900 accounts (module 04)
9. Vercel Hobby          → Pro    BEFORE Razorpay goes live  ← module 13
10. privacy policy + terms
```

Item 9 is the only one that costs money and the only one that is not reversible by editing a
file. Items 8 and 9 are both licence problems, not technical ones — the free tiers of Vercel
Hobby and Open-Meteo both prohibit commercial use.

## Acceptance

- [ ] apex and www resolve and serve over HTTPS
- [ ] the storage bucket is private; an unsigned URL is rejected
- [ ] user A cannot fetch user B's image even with a valid session
- [ ] all eight CI steps pass and each fails the build when deliberately broken
- [ ] no secret appears in `.next/static`
- [ ] a backup has been taken **and restored** into a scratch database
- [ ] `/api/health` is monitored and pages you when down
- [ ] billing alerts are configured on Google Cloud, Cloudflare, and Supabase
- [ ] the checklist above lives in the repo, not only in this file
