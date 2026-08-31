# Email delivery — Resend SMTP behind Supabase Auth

Auth stays Supabase. Only the thing that puts the magic link in an inbox changes.

## Why

Supabase's built-in email sender is rate-limited to **2 emails per hour, project-wide**,
and is explicitly not for production. Fifteen testers signing in on the same evening
would exhaust that within minutes, and the failure is silent from the user's side —
they just never get the link. Every sign-in in this product is an email, because there
are no passwords (module 03 §1), so the sender is not a detail.

Resend's free tier is 3,000 emails/month and 100/day. At 15 testers that is not close.

## What to set up

**1. Resend account and a verified domain.**

Resend will only send to arbitrary addresses from a domain you have verified. The
sandbox sender (`onboarding@resend.dev`) can only email the address that owns the
Resend account — fine for testing your own sign-in, useless for 15 testers.

In Resend → Domains → Add Domain, then add the records it gives you at your DNS
provider (Cloudflare, per module 15):

| Type | Purpose |
|---|---|
| TXT (SPF) | authorises Resend to send as your domain |
| TXT/CNAME (DKIM) | signs the mail so it is not spam-filed |
| TXT (DMARC) | tells receivers what to do when the first two fail |

Module 15's DNS table already lists these three under `@`. This is that row.

**2. An API key.** Resend → API Keys → Create, scope "Sending access". That key is
the SMTP password.

**3. Point Supabase at it.** Dashboard → Project Settings → Authentication → SMTP
Settings → Enable Custom SMTP:

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `587` |
| Username | `resend` (literally; not your email) |
| Password | the Resend API key |
| Sender email | `no-reply@<your-domain>` — must be on the verified domain |
| Sender name | `Wardrobe AI` |

**4. Raise the auth rate limit.** Dashboard → Authentication → Rate Limits → "Emails
per hour". It stays at the built-in 2/hour until custom SMTP is on; with Resend
configured, set it to something a test evening survives — 30 is plenty for 15 people
and still a brake on abuse.

## Verifying it

1. Sign in at `/login` with an address that is **not** the Resend account owner's.
2. The mail arrives from `no-reply@<your-domain>`, not `noreply@mail.app.supabase.io`.
3. Resend → Logs shows the send.
4. Check the message lands in the inbox, not spam. If it is spammed, DKIM or DMARC is
   not verified yet — Resend's Domains page will say which.

## What does not change

- No application code. Supabase Auth still issues and verifies the token; `/callback`
  still exchanges it (module 03 §3). Nothing in `lib/` or `app/` knows about Resend.
- No new runtime environment variable. The API key lives in Supabase's dashboard, not
  in `.env.local` — the app never sends mail itself, so it never needs the key. The
  entries in `supabase/config.toml` exist only for the local CLI stack.
- The magic-link template still comes from Supabase (Authentication → Email
  Templates). Worth editing the default before the testers see it — it says
  "Supabase" out of the box.

## If a tester says the link never arrived

In order of likelihood: it is in spam (DKIM); the rate limit is still at 2/hour; the
sender address is not on the verified domain; the address is not one Resend will send
to because the domain is still unverified.
