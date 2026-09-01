-- 0007_ai_budget.sql
-- The per-user daily AI cap (module 12).
--
-- `ai_usage` exists from 0001 but has only a SELECT policy, deliberately: a client
-- that can write its own usage row can raise its own ceiling. Both writers below are
-- security definer and take the user from auth.uid(), never from an argument.
--
-- WHY A RESERVATION, NOT A COUNT-THEN-CALL
--
-- Module 12's acceptance requires that twenty concurrent requests from a user at
-- cap-1 produce exactly one success. A read to check the count followed by a separate
-- increment cannot do that at any isolation level PostgREST gives us — all twenty read
-- the same number. So the check IS the increment: one statement that only bumps the
-- counter while it is under the limit, and reports whether it did.
--
-- The cost of that choice is the one module 12 §1 already names: a crash between the
-- reservation and the model call spends one call. That is the correct direction to
-- fail. Checking after the call would spend the call you were trying to prevent.

begin;

create or replace function reserve_ai_call(p_kind text, p_limit int, p_day date)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid     uuid := auth.uid();
  granted boolean;
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if p_kind not in ('tag', 'chat', 'rerank') then
    raise exception 'VALIDATION_FAILED: unknown AI call kind';
  end if;

  -- A limit of zero is a premium-only feature on a free plan. The caller turns that
  -- into PREMIUM_REQUIRED rather than AI_BUDGET_EXCEEDED (module 12 §5) — one is an
  -- upgrade prompt, the other is "come back tomorrow".
  if p_limit <= 0 then
    return false;
  end if;

  insert into ai_usage (user_id, day, tag_calls, chat_calls, llm_calls)
  values (
    uid, p_day,
    case when p_kind = 'tag'    then 1 else 0 end,
    case when p_kind = 'chat'   then 1 else 0 end,
    case when p_kind = 'rerank' then 1 else 0 end
  )
  on conflict (user_id, day) do update
     set tag_calls  = ai_usage.tag_calls  + (case when p_kind = 'tag'    then 1 else 0 end),
         chat_calls = ai_usage.chat_calls + (case when p_kind = 'chat'   then 1 else 0 end),
         llm_calls  = ai_usage.llm_calls  + (case when p_kind = 'rerank' then 1 else 0 end)
   -- Evaluated while holding the row lock, which is what makes this atomic.
   where case p_kind
           when 'tag'  then ai_usage.tag_calls
           when 'chat' then ai_usage.chat_calls
           else             ai_usage.llm_calls
         end < p_limit
  returning true into granted;

  return coalesce(granted, false);
end $$;

-- Tokens are accumulated after the call returns, when the real numbers are known.
-- Separate from the reservation because the call count must be spent before the
-- request goes out and the token count cannot be.
create or replace function record_ai_tokens(p_day date, p_in bigint, p_out bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  update ai_usage
     set in_tokens  = in_tokens + greatest(p_in, 0),
         out_tokens = out_tokens + greatest(p_out, 0)
   where user_id = uid and day = p_day;
end $$;

revoke all on function reserve_ai_call(text, int, date) from public;
revoke all on function record_ai_tokens(date, bigint, bigint) from public;
grant execute on function reserve_ai_call(text, int, date) to authenticated;
grant execute on function record_ai_tokens(date, bigint, bigint) to authenticated;

commit;
