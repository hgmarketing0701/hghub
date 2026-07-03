-- ============================================================================
-- HG GROUP — DAILY JOB READINESS & DISPATCH · Supabase schema (slug: dispatch)
-- Prefix: dsp_ · Run AFTER supabase/schema.sql (the foundation).
-- Additive & idempotent — safe to re-run.
--
-- What it creates:
--   1. dsp_jobs      — every confirmed hoarding job + its readiness gates
--   2. dsp_teams     — night-install crews (one row per dispatch night per team no)
--   3. dsp_staff     — drivers cum supervisors + workers
--   4. dsp_lorries   — lorry master list
--   5. dsp_config    — readiness rules (permit lead days, at-risk window, team caps)
--   6. dsp_save_job()— security-definer RPC: atomic J-#### job code + audit
--   7. dsp_alarms    — view read by the shared `daily-alarms` Edge Function
--                      (permit alarms / at-risk / blocked — same list shown in UI)
--   8. RLS on every table (allowlist-gated via is_allowed())
-- ============================================================================

-- ─── 1 · JOBS ────────────────────────────────────────────────────────────────
create table if not exists dsp_jobs (
  id                 uuid primary key default gen_random_uuid(),
  job_code           text not null default '',        -- J-0001 style, assigned by dsp_save_job()
  client             text not null default '',
  client_group       text not null default '',        -- client WhatsApp group chat name
  mall               text not null default '',
  lot_no             text not null default '',
  job_type           text not null default 'install', -- install|dismantle|rectify|modify|other
  scope              text not null default '',        -- e.g. "12m hoarding"
  door_type          text not null default 'None',
  install_date       date,
  measure_status     text not null default 'pending', -- pending|sketch_done|not_required
  sketch_url         text not null default '',
  quote_status       text not null default 'pending', -- pending|sent|confirmed|not_required
  quote_ref          text not null default '',
  needs_visual       text not null default 'no',      -- yes|no
  visual_status      text not null default 'na',      -- na|pending|approved
  visual_url         text not null default '',
  permit_by          text not null default 'us',      -- us|client|already_have|not_required
  permit_status      text not null default 'pending', -- not_required|pending|submitted|approved
  permit_url         text not null default '',
  permit_approved_at date,
  material_ready     text not null default 'no',      -- yes|no
  material_notes     text not null default '',
  job_status         text not null default 'open',    -- open|assigned|done|cancelled
  dispatch_date      date,                            -- the night it is loaded into a team
  team_no            text not null default '',
  seq                text not null default '',
  notes              text not null default '',
  created_at         timestamptz default now(),
  created_by         text default '',
  updated_at         timestamptz default now(),
  updated_by         text default ''
);
create index if not exists idx_dsp_jobs_install  on dsp_jobs (install_date);
create index if not exists idx_dsp_jobs_dispatch on dsp_jobs (dispatch_date, team_no);

-- ─── 2 · TEAMS (crew per night per team number) ─────────────────────────────
create table if not exists dsp_teams (
  id            uuid primary key default gen_random_uuid(),
  dispatch_date date not null,
  team_no       text not null,
  driver        text not null default '',   -- driver cum supervisor
  workers       text not null default '',   -- comma-separated names
  lorry         text not null default '',   -- plate
  notes         text not null default '',
  created_at    timestamptz default now(),
  created_by    text default '',
  updated_at    timestamptz default now(),
  updated_by    text default '',
  unique (dispatch_date, team_no)
);

-- ─── 3 · STAFF ───────────────────────────────────────────────────────────────
create table if not exists dsp_staff (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  role       text not null default 'worker',  -- driver | worker
  phone      text not null default '',
  active     boolean not null default true,
  created_at timestamptz default now(),
  created_by text default '',
  updated_at timestamptz default now(),
  updated_by text default ''
);

-- ─── 4 · LORRIES ─────────────────────────────────────────────────────────────
create table if not exists dsp_lorries (
  id         uuid primary key default gen_random_uuid(),
  plate      text not null,
  label      text not null default '',        -- 3-tonne / 1-tonne
  active     boolean not null default true,
  created_at timestamptz default now(),
  created_by text default '',
  updated_at timestamptz default now(),
  updated_by text default ''
);

-- ─── 5 · CONFIG (same keys + defaults as the GAS Config sheet seed) ─────────
create table if not exists dsp_config (
  key   text primary key,
  value text default '',
  notes text default ''
);
insert into dsp_config (key, value, notes) values
  ('permitLeadDays',    '3',  'Working days a permit needs before install — drives the permit early-warning'),
  ('atRiskDays',        '3',  'If install date is within N days and the job is not ready → AMBER "at risk"'),
  ('maxTeams',          '12', 'Max night-install teams'),
  ('maxJobsPerTeam',    '5',  'Max jobs per team per night'),
  ('maxWorkersPerTeam', '5',  'Max workers per team (excludes the driver cum supervisor)'),
  ('emailRecipients',   'blacklee@hggroup.com.my', 'Comma-separated — who gets the daily readiness email (sent by the daily-alarms Edge Function)')
on conflict (key) do nothing;

-- ─── 6 · SAVE JOB RPC — atomic sequential J-#### code + stamped audit ────────
-- payload keys are the same camelCase names the GAS saveJob() accepted.
create or replace function dsp_save_job(payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid;
  v_cur    dsp_jobs%rowtype;
  v_code   text;
  v_next   int;
  v_label  text;
  v_exists boolean := false;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  if coalesce(payload->>'mall','') = '' and coalesce(payload->>'lotNo','') = ''
     and coalesce(payload->>'client','') = '' then
    raise exception 'At minimum a job needs a client, mall, or lot number.';
  end if;

  v_id := coalesce(nullif(payload->>'id','')::uuid, gen_random_uuid());
  select * into v_cur from dsp_jobs where id = v_id;
  v_exists := found;

  -- keep the existing code on update; otherwise mint the next J-#### (max of any digits, like GAS)
  v_code := coalesce(nullif(v_cur.job_code,''), nullif(payload->>'jobCode',''));
  if v_code is null then
    select coalesce(max(nullif(substring(job_code from '(\d+)'),'')::int), 0) + 1
      into v_next from dsp_jobs;
    v_code := 'J-' || lpad(v_next::text, 4, '0');
  end if;

  v_label := concat_ws(' · ', nullif(payload->>'mall',''), nullif(payload->>'lotNo',''),
                              nullif(payload->>'jobType',''));

  if v_exists then
    update dsp_jobs set
      job_code           = v_code,
      client             = coalesce(payload->>'client',''),
      client_group       = coalesce(payload->>'clientGroup',''),
      mall               = coalesce(payload->>'mall',''),
      lot_no             = coalesce(payload->>'lotNo',''),
      job_type           = coalesce(nullif(payload->>'jobType',''), 'install'),
      scope              = coalesce(payload->>'scope',''),
      door_type          = coalesce(payload->>'doorType',''),
      install_date       = nullif(payload->>'installDate','')::date,
      measure_status     = coalesce(nullif(payload->>'measureStatus',''), 'pending'),
      sketch_url         = coalesce(payload->>'sketchUrl',''),
      quote_status       = coalesce(nullif(payload->>'quoteStatus',''), 'pending'),
      quote_ref          = coalesce(payload->>'quoteRef',''),
      needs_visual       = case when payload->>'needsVisual' = 'yes' then 'yes' else 'no' end,
      visual_status      = coalesce(nullif(payload->>'visualStatus',''),
                                    case when payload->>'needsVisual' = 'yes' then 'pending' else 'na' end),
      visual_url         = coalesce(payload->>'visualUrl',''),
      permit_by          = coalesce(nullif(payload->>'permitBy',''), 'us'),
      permit_status      = coalesce(nullif(payload->>'permitStatus',''), 'pending'),
      permit_url         = coalesce(payload->>'permitUrl',''),
      permit_approved_at = nullif(payload->>'permitApprovedAt','')::date,
      material_ready     = case when payload->>'materialReady' = 'yes' then 'yes' else 'no' end,
      material_notes     = coalesce(payload->>'materialNotes',''),
      job_status         = coalesce(nullif(payload->>'jobStatus',''), 'open'),
      dispatch_date      = coalesce(nullif(payload->>'dispatchDate','')::date, v_cur.dispatch_date),
      team_no            = coalesce(nullif(payload->>'teamNo',''), v_cur.team_no, ''),
      seq                = coalesce(payload->>'seq', v_cur.seq, ''),
      notes              = coalesce(payload->>'notes',''),
      updated_at         = now(),
      updated_by         = current_email()
    where id = v_id;
    perform log_audit('UPDATE Job', v_code || ' · ' || v_label);
  else
    insert into dsp_jobs (
      id, job_code, client, client_group, mall, lot_no, job_type, scope, door_type,
      install_date, measure_status, sketch_url, quote_status, quote_ref,
      needs_visual, visual_status, visual_url, permit_by, permit_status, permit_url,
      permit_approved_at, material_ready, material_notes, job_status,
      dispatch_date, team_no, seq, notes, created_by, updated_by)
    values (
      v_id, v_code,
      coalesce(payload->>'client',''), coalesce(payload->>'clientGroup',''),
      coalesce(payload->>'mall',''), coalesce(payload->>'lotNo',''),
      coalesce(nullif(payload->>'jobType',''), 'install'),
      coalesce(payload->>'scope',''), coalesce(payload->>'doorType',''),
      nullif(payload->>'installDate','')::date,
      coalesce(nullif(payload->>'measureStatus',''), 'pending'),
      coalesce(payload->>'sketchUrl',''),
      coalesce(nullif(payload->>'quoteStatus',''), 'pending'),
      coalesce(payload->>'quoteRef',''),
      case when payload->>'needsVisual' = 'yes' then 'yes' else 'no' end,
      coalesce(nullif(payload->>'visualStatus',''),
               case when payload->>'needsVisual' = 'yes' then 'pending' else 'na' end),
      coalesce(payload->>'visualUrl',''),
      coalesce(nullif(payload->>'permitBy',''), 'us'),
      coalesce(nullif(payload->>'permitStatus',''), 'pending'),
      coalesce(payload->>'permitUrl',''),
      nullif(payload->>'permitApprovedAt','')::date,
      case when payload->>'materialReady' = 'yes' then 'yes' else 'no' end,
      coalesce(payload->>'materialNotes',''),
      coalesce(nullif(payload->>'jobStatus',''), 'open'),
      nullif(payload->>'dispatchDate','')::date,
      coalesce(payload->>'teamNo',''), coalesce(payload->>'seq',''),
      coalesce(payload->>'notes',''),
      current_email(), current_email());
    perform log_audit('CREATE Job', v_code || ' · ' || v_label);
  end if;

  return v_id;
end;
$$;

-- ─── 7 · ALARMS VIEW — read by the shared `daily-alarms` Edge Function ──────
-- Mirrors sendDailyDispatchDigest() in the GAS backend:
--   permit_alarm : permit not OK and install within permitLeadDays (incl. overdue)
--   at_risk      : not ready, install in 0–7 days, within atRiskDays, no permit alarm
--   blocked      : not ready and install far out (or no date)
create or replace view dsp_alarms with (security_invoker = on) as
with cfg as (
  select
    coalesce((select nullif(value,'')::int from dsp_config where key = 'permitLeadDays'), 3) as lead_days,
    coalesce((select nullif(value,'')::int from dsp_config where key = 'atRiskDays'),     3) as risk_days,
    coalesce((select nullif(value,'')      from dsp_config where key = 'emailRecipients'),
             'blacklee@hggroup.com.my') as recipients
),
base as (
  select j.*,
         (j.install_date - (now() at time zone 'Asia/Kuala_Lumpur')::date) as days_left,
         (j.permit_status = 'approved' or j.permit_by in ('already_have','not_required')
          or j.permit_status = 'not_required') as permit_ok
  from dsp_jobs j
  where j.job_status not in ('done','cancelled')
),
gated as (
  select b.*,
         array_remove(array[
           case when b.mall = '' or b.lot_no = ''                            then 'Lot / Mall' end,
           case when b.measure_status not in ('sketch_done','not_required')  then 'Measurement sketch' end,
           case when b.quote_status   not in ('confirmed','not_required')    then 'Quotation' end,
           case when not b.permit_ok                                         then 'Permit' end,
           case when b.needs_visual = 'yes' and b.visual_status <> 'approved' then 'Visual artwork' end,
           case when b.material_ready <> 'yes'                               then 'Material / fab' end
         ], null) as missing
  from base b
)
select 'permit_alarm'::text as alarm_type,
       g.job_code           as ref,
       g.mall || ' · ' || g.lot_no || ' · ' || g.client ||
         ' — permit: ' || g.permit_by || ' / ' || g.permit_status as detail,
       g.install_date       as due_date,
       cfg.recipients       as recipient
from gated g, cfg
where not g.permit_ok and g.days_left is not null and g.days_left <= cfg.lead_days
union all
select 'at_risk', g.job_code,
       g.mall || ' · ' || g.lot_no || ' · ' || g.client ||
         ' — missing: ' || array_to_string(g.missing, ', '),
       g.install_date, cfg.recipients
from gated g, cfg
where cardinality(g.missing) > 0
  and not (not g.permit_ok and g.days_left is not null and g.days_left <= cfg.lead_days)
  and g.days_left is not null and g.days_left between 0 and 7
  and g.days_left <= cfg.risk_days
union all
select 'blocked', g.job_code,
       g.mall || ' · ' || g.lot_no || ' · ' || g.client ||
         ' — missing: ' || array_to_string(g.missing, ', '),
       g.install_date, cfg.recipients
from gated g, cfg
where cardinality(g.missing) > 0
  and (g.days_left is null or g.days_left > cfg.risk_days);

grant select on dsp_alarms to authenticated;

-- ─── 8 · ROW-LEVEL SECURITY — allowlist-gated everything ────────────────────
alter table dsp_jobs    enable row level security;
alter table dsp_teams   enable row level security;
alter table dsp_staff   enable row level security;
alter table dsp_lorries enable row level security;
alter table dsp_config  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['dsp_jobs','dsp_teams','dsp_staff','dsp_lorries','dsp_config'] loop
    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format('create policy %I_rw on %I for all to authenticated using (is_allowed()) with check (is_allowed())', t, t);
  end loop;
end $$;

-- Done. The daily permit-alarm email is handled by the shared `daily-alarms`
-- Edge Function reading dsp_alarms — no trigger install needed in this tool.
