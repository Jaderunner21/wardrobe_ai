# Deploying to Vercel

The app is a standard Next.js 15 project; Vercel detects it with no config file.

## 1. Import the repo

Vercel → **Add New… → Project** → pick the GitHub repo. Framework preset: **Next.js**.
Install command and build command stay at their defaults (`pnpm install`, `pnpm build`).

## 2. Environment variables

Project → **Settings → Environment Variables**, for **Production** (and Preview if you use it):

| Name | Value | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page, `anon` `public` key | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | same page, `service_role` key — server only | yes |
| `GEMINI_API_KEY` | aistudio.google.com | yes, for AI tagging and outfits |
| `DEMO_PASSWORD` | the same value as in your `.env.local` | yes, for "Explore the demo" |
| `SENTRY_DSN` | Sentry project DSN | optional |
| `NEXT_PUBLIC_ENABLE_GOOGLE` | `true` only after enabling Google in Supabase | optional |

Do **not** set `PHASE` (it no longer exists) or the Razorpay keys (payments are off).
A missing required variable fails the build on purpose (`lib/env.ts`).

## 3. Tell Supabase about the new domain

Supabase → **Authentication → URL Configuration**:

- **Site URL**: `https://<your-project>.vercel.app`
- **Redirect URLs**: add `https://<your-project>.vercel.app/**`

Email + password sign-in works without this, but Google sign-in and any future email
links redirect only to listed URLs.

## 4. Deploy, then check

- `https://<your-project>.vercel.app/api/health` returns `{"ok":true,"db":"up",…}`
- `/` shows the landing page; **Explore the demo** opens a stocked wardrobe
- **Create account** makes a new account and lands on the upload screen

## Resetting the demo wardrobes

After judges have been clicking around, rebuild all 15 from scratch:

```bash
node scripts/demo/seed.mjs
```
