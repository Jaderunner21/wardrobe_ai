# 03 — Auth & accounts

**Scope:** TEST · **Depends on:** 02 · **Owns:** `profiles`, `app/(auth)/*`, `middleware.ts`,
`lib/supabase/*`, `app/api/account/*`

## Responsibility

Sign-in, session handling, the profile row, and the two things that make a photo-storing
product credible: real data export and real account deletion.

## Contracts

Routes: `GET /api/account/export`, `DELETE /api/account`. See `api-contracts.md`.

Three Supabase clients, and using the wrong one is the most common serious mistake in this
stack:

| File | Used from | Key |
|---|---|---|
| `lib/supabase/client.ts` | client components | anon |
| `lib/supabase/server.ts` | RSC, route handlers, server actions | anon + user session |
| `lib/supabase/admin.ts` | server only, deliberately | **service role** |

`admin.ts` starts with `import 'server-only'`. It bypasses RLS entirely. It is used in
exactly three places in the whole codebase: account deletion, the Razorpay webhook (13), and
the cron worker (PROD). If you reach for it anywhere else, the answer is that RLS is
misconfigured.

## Behaviour

### 1. Sign-in methods

Email OTP (magic link) and Google OAuth. No passwords — nothing to leak, nothing to reset,
and one less form.

### 2. Profile creation

A `profiles` row is created on first sign-in by a Postgres trigger on `auth.users`, not by
application code. Application-side creation races the first authenticated request and
produces intermittent "profile not found" errors that are miserable to reproduce.

```sql
create or replace function handle_new_user() returns trigger
language plpgsql security definer as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data->>'full_name');
  insert into public.style_profiles (user_id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();
```

Note it seeds `style_profiles` too, so module 10 never has to handle a missing row.

### 3. Session in middleware

`middleware.ts` refreshes the Supabase session cookie on every request and redirects
unauthenticated users away from the `(app)` route group. Follow Supabase's documented
`@supabase/ssr` middleware pattern exactly — hand-rolled cookie handling in this stack
produces sessions that work locally and expire unpredictably in production.

### 4. City and timezone

Collected during onboarding, not required. `city` feeds the weather lookup (07); with no
city the recommendation engine skips thermal scoring rather than guessing a location.
`timezone` defaults to `Asia/Kolkata` and determines what "today" means for `lastWornOn`
and the AI daily budget reset.

### 5. Data export

A single JSON file: profile, items, outfits, feedback, style profile, plus a map of item id
to a 24-hour signed image URL. Generated on demand, streamed, never stored.

### 6. Account deletion

Order matters:

1. list every stored image under `items/{userId}/` and delete them
2. delete the `auth.users` row via the admin client — every app table cascades

Storage first. If it fails you still have the row and can retry; if the row is gone first,
the objects are unreachable orphans consuming quota forever.

No soft delete. Requires `{ confirm: 'DELETE' }` in the body.

> **Test phase note:** these 15 testers are people you know, which makes it tempting to skip
> export and deletion. Build them. They are the cheapest possible answer to "what happens to
> my photos", and you will be asked.

### 7. Test-phase seeding

Seed the 15 testers with `plan = 'premium'` so nobody meets the 25-item wall during the
test — you want feedback on the product, not on the paywall. Keep the quota trigger
installed and covered by a test so the code path stays exercised.

```sql
update profiles set plan = 'premium'
 where id in (select id from auth.users where email = any($1));
```

## Acceptance

- [ ] email OTP and Google sign-in both work on the deployed domain
- [ ] a new sign-in produces exactly one `profiles` row and one `style_profiles` row
- [ ] hitting an `(app)` route while signed out redirects to `/login`, and returns to the
      originally requested path after sign-in
- [ ] `admin.ts` is imported in at most three files, all server-only
- [ ] export returns valid JSON with working image URLs
- [ ] deletion removes the auth user, all app rows, and all stored images — verified by
      listing the bucket prefix afterwards
- [ ] the 15 testers are `premium`

## Out of scope

- Roles and permissions. There is one kind of user.
- Team or shared wardrobes.
- Plan changes — owned by module 13. Nothing here writes `profiles.plan` except the
  test-phase seed above.
