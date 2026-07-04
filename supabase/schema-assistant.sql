-- ============================================================================
-- HG AI ASSISTANT — schema (run AFTER the foundation schema.sql)
-- Adds: ai_briefings (daily summaries) + ai_run_select (guarded read-only query)
-- Powers the Daily Briefing card + admin "ask anything" chat on the hub home page.
-- ============================================================================

-- ─── Daily briefings (one row per KL day) ──────────────────────────────────
create table if not exists ai_briefings (
  brief_date  date primary key default (now() at time zone 'Asia/Kuala_Lumpur')::date,
  summary     text not null default '',
  activity_n  int  default 0,          -- how many audit rows it was built from
  created_by  text default '',
  created_at  timestamptz default now()
);

alter table ai_briefings enable row level security;
drop policy if exists ai_briefings_read on ai_briefings;
create policy ai_briefings_read on ai_briefings for select to authenticated using (is_allowed());
-- writes happen only from the Edge Function (service role) — no insert/update policy needed.

-- ─── Guarded read-only query runner (called ONLY by the Edge Function) ──────
-- The Edge Function verifies the caller is an admin BEFORE calling this.
-- This function is the last line of defence: SELECT-only, single statement,
-- capped rows, short timeout. Not callable by anon/authenticated clients.
create or replace function ai_run_select(q text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  clean  text := btrim(q);
  lc     text;
begin
  clean := rtrim(clean, ';');            -- drop a single trailing semicolon
  lc := lower(clean);

  -- must be a read-only statement
  if left(lc, 6) <> 'select' and left(lc, 5) <> 'with ' then
    raise exception 'Only SELECT/WITH queries are allowed.';
  end if;
  -- single statement only
  if position(';' in clean) > 0 then
    raise exception 'Multiple statements are not allowed.';
  end if;
  -- block anything that could write or escalate
  if lc ~ '\m(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|call|do|merge|vacuum|analyze|set|reset|comment|security|pg_sleep)\M'
     or lc ~ '\minto\M' then
    raise exception 'Query contains a forbidden keyword.';
  end if;

  perform set_config('statement_timeout', '8000', true);   -- 8s cap for this tx

  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from ( %s limit 200 ) t', clean)
    into result;
  return result;
end;
$$;

-- lock it down: only the service role (Edge Function) may run it
revoke all on function ai_run_select(text) from public;
do $$ begin
  begin revoke all on function ai_run_select(text) from anon;          exception when others then null; end;
  begin revoke all on function ai_run_select(text) from authenticated; exception when others then null; end;
  begin grant execute on function ai_run_select(text) to service_role; exception when others then null; end;
end $$;

-- Done. Deploy the 'assistant' Edge Function next (see EDGE-FUNCTIONS.md).
