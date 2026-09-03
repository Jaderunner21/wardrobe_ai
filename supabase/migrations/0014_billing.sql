-- 0014_billing.sql
-- Razorpay subscriptions — module 13.
--
-- Two things live here: the idempotency ledger the webhook checks before it acts, and
-- the downgrade that runs when someone stops paying.
--
-- NOTE ON THE TEST PHASE. `plan_features.item_cap` is currently null on both plans, so
-- the free cap is not enforced and `downgrade_to_free` finds nothing to archive. That is
-- deliberate and reversible — set a cap and this starts working. The code is here now
-- because a downgrade path written on the day the first person cancels is a downgrade
-- path written under pressure, on live data, about someone's photographs.

begin;

-- ═══════════════════════════════════════════ idempotency

-- Razorpay retries. A retried `subscription.charged` must not extend the plan twice, so
-- the event id is recorded and a second delivery of the same id is a no-op.
create table processed_webhooks (
  event_id    text primary key,
  event_type  text,
  received_at timestamptz not null default now()
);

/*
 * RLS with NO policy, which is not an oversight. This table is written only by the
 * webhook through the service-role client, which bypasses RLS; every other client —
 * including a signed-in user holding the public anon key — matches no policy and sees
 * nothing. That is exactly right: the ledger is ours, and knowing which payment events
 * have been processed is not the user's business.
 */
alter table processed_webhooks enable row level security;

-- The ledger only has to outlive Razorpay's retry window. Pruning is a job, not a
-- cascade, and it is commented out with the rest until production (module 02 §4).
create index processed_webhooks_received_idx on processed_webhooks (received_at);

-- ═══════════════════════════════════════════ downgrade

/*
 * Module 13 §3 — the interesting case. A premium user with 60 items who cancels is over
 * the 25-item free cap.
 *
 * ARCHIVE THE EXCESS, NEVER DELETE IT. Deleting someone's photographs because they
 * stopped paying is the kind of thing people post screenshots of, and it is unnecessary:
 * an archived item costs 63 KB. Resubscribing unarchives everything instantly.
 *
 * Which 25 stay: most recently worn first, then most recently added. Someone who
 * downgrades should keep the clothes they actually wear, and an item nobody has worn is
 * the one they will miss least.
 *
 * THE COUNTER RUBS AGAINST THIS, and module 13 §3 says so out loud. Module 05 §5 keeps
 * archived items inside `item_count`, so that archiving is not a free-storage exploit.
 * The consequence is that `item_count` does NOT fall when this runs, and this function
 * must therefore count live, non-archived rows itself rather than trusting the counter.
 */
create or replace function downgrade_to_free(p_user_id uuid)
returns int
language plpgsql security definer as $$
declare
  cap int;
  -- NOT `archived`: plpgsql resolves a bare identifier as a variable before a column,
  -- so a variable of that name makes `set archived = true` and `not archived` ambiguous
  -- and the function fails at runtime with 42702.
  archived_count int;
begin
  select item_cap into cap from plan_features where plan = 'free';

  -- No cap configured means nothing is over it. During the test phase this is the
  -- normal path and the function correctly does nothing.
  if cap is null then
    return 0;
  end if;

  with ranked as (
    select id,
           row_number() over (
             order by last_worn_on desc nulls last, created_at desc
           ) as rank
      from items
     where user_id = p_user_id
       and deleted_at is null
       and not archived
  )
  update items
     set archived = true
   where id in (select id from ranked where rank > cap);

  get diagnostics archived_count = row_count;
  return archived_count;
end $$;

/*
 * The plan itself. Only the webhook calls this, through the service-role client — module
 * 13 §1: "Nothing else in the codebase writes profiles.plan. Not the client, not a
 * success redirect, not an optimistic update. A payment success page is a claim by the
 * browser; the webhook is the fact."
 *
 * It is a function rather than a bare update so the downgrade and the plan change happen
 * together: a plan that says free while sixty items sit active is the state that lets
 * someone keep a paid wardrobe for nothing.
 */
create or replace function apply_plan(
  p_user_id   uuid,
  p_plan      plan_t,
  p_renews_at timestamptz default null,
  p_sub_id    text default null
) returns int
language plpgsql security definer as $$
declare
  archived int := 0;
begin
  update profiles
     set plan            = p_plan,
         plan_renews_at  = coalesce(p_renews_at, plan_renews_at),
         razorpay_sub_id = coalesce(p_sub_id, razorpay_sub_id)
   where id = p_user_id;

  if p_plan = 'free' then
    archived := downgrade_to_free(p_user_id);
  end if;

  return archived;
end $$;

-- ═══════════════════════════════════════════ the period actually ending

/*
 * `subscription.cancelled` keeps someone premium until the period they paid for runs
 * out — module 13 §2. Something has to notice when it does, and it cannot be the
 * webhook: Razorpay sends the cancellation once, on the day they cancel, and says
 * nothing on the day the period ends.
 *
 * A daily sweep rather than a per-user timer. Anyone whose renewal date has passed and
 * who is still marked premium is downgraded — which is idempotent, so a missed day
 * catches up on the next run rather than leaving someone premium forever.
 */
create or replace function downgrade_expired() returns int
language plpgsql security definer as $$
declare
  count_down int := 0;
  row_user   uuid;
begin
  for row_user in
    select id from profiles
     where plan = 'premium'
       and plan_renews_at is not null
       and plan_renews_at < now()
  loop
    perform apply_plan(row_user, 'free'::plan_t, null, null);
    count_down := count_down + 1;
  end loop;

  return count_down;
end $$;

-- TEST PHASE: commented out with the rest of the scheduled jobs (module 02 §4). Nobody
-- is paying, so there is nothing to expire. Uncomment at production alongside the jobs
-- in 0001_init.sql — see module 15 and docs/test-to-production.md.
--
-- select cron.schedule('downgrade-expired', '15 2 * * *', $$select downgrade_expired()$$);

commit;
