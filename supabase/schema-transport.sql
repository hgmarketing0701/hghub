-- ============================================================================
-- HG GROUP — TRANSPORT / MOVER / ROROBIN · Supabase schema (prefix trn_)
-- Additive + idempotent. Run AFTER the foundation schema (supabase/schema.sql).
-- Converts the Apps Script "Black Lee — Transport, Mover & Rorobin" tool:
--   clients, engagements, service jobs (Lorry / Mover / Rorobin), bins,
--   rate card, workers, lorry fleet, shared runs (trips), invoices, payments,
--   stage-tagged photos (Supabase Storage), settings, alarms view.
-- Uses (never redefines) foundation helpers: is_allowed(), is_admin(),
-- current_email(), log_audit().
-- ============================================================================

-- ─── 1 · TABLES ──────────────────────────────────────────────────────────────

create table if not exists trn_clients (
  id         uuid primary key default gen_random_uuid(),
  company    text not null,
  reg_no     text default '',
  pic        text default '',
  contact    text default '',
  email      text default '',
  address    text default '',
  notes      text default '',
  created_by text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists trn_engagements (
  id             uuid primary key default gen_random_uuid(),
  ref            text not null unique,
  client_id      uuid references trn_clients(id),
  client_company text default '',
  reason         text default 'Ad-hoc',        -- Reinstatement / Ad-hoc / Mover / Rorobin / Transport / Other
  site_name      text default '',
  site_address   text default '',
  status         text default 'Open',          -- Open / Cancelled (live status is computed)
  handled_by     text default '',
  remarks        text default '',
  created_by     text default '',
  created_at     timestamptz default now(),
  updated_by     text default '',
  updated_at     timestamptz default now()
);

create table if not exists trn_bins (
  id         uuid primary key default gen_random_uuid(),
  bin_no     text not null,
  swcorp_reg text default '',
  size       text default '',
  status     text default 'Available',         -- Available / Maintenance
  notes      text default '',
  updated_at timestamptz default now()
);
create unique index if not exists idx_trn_bins_no on trn_bins (lower(bin_no));

create table if not exists trn_rates (
  id         uuid primary key default gen_random_uuid(),
  service    text not null,                    -- Lorry / Mover / Rorobin
  code       text not null,
  label      text not null,
  unit       text default 'per unit',
  rate       numeric default 0,
  active     boolean default true,
  updated_at timestamptz default now()
);
create unique index if not exists idx_trn_rates_code on trn_rates (lower(code));

create table if not exists trn_workers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  phone          text default '',
  role           text default 'Mover',         -- Mover / Driver / Both
  pay_type       text default 'Per-shift',     -- Per-shift / Monthly
  day_rate       numeric default 0,
  night_rate     numeric default 0,
  monthly_salary numeric default 0,
  active         boolean default true,
  notes          text default '',
  updated_at     timestamptz default now()
);
create unique index if not exists idx_trn_workers_name on trn_workers (lower(name));

create table if not exists trn_lorries (
  id         uuid primary key default gen_random_uuid(),
  plate_no   text not null,
  code       text default '',
  type       text default '',
  capacity   text default '',
  category   text default 'in-house',          -- in-house / outsource
  active     boolean default true,
  notes      text default '',
  updated_at timestamptz default now()
);
create unique index if not exists idx_trn_lorries_plate on trn_lorries (lower(plate_no));

create table if not exists trn_trips (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique,            -- RUN-0001
  trip_date   text default '',                 -- YYYY-MM-DD
  shift       text default 'Day',              -- Day / Night
  lorry_plate text default '',
  driver      text default '',
  driver_id   uuid,
  driver_cost numeric default 0,
  lorry_cost  numeric default 0,
  crew        jsonb default '[]'::jsonb,       -- [{workerId,name,shift,rate,payType}]
  status      text default 'Planned',          -- Planned / Dispatched / Completed / Cancelled
  notes       text default '',
  created_by  text default '',
  created_at  timestamptz default now(),
  updated_by  text default '',
  updated_at  timestamptz default now()
);

create table if not exists trn_invoices (
  id             uuid primary key default gen_random_uuid(),
  inv_no         text not null,
  engagement_id  uuid references trn_engagements(id),
  engagement_ref text default '',
  client_id      uuid,
  client_company text default '',
  inv_date       text default '',              -- YYYY-MM-DD
  due_date       text default '',
  description    text default '',
  amount         numeric default 0,
  sst_enabled    boolean default false,
  sst_amount     numeric default 0,
  total          numeric default 0,
  status         text default '',              -- '' / Void  (pay status is computed)
  file_path      text default '',              -- storage path in transport-photos
  notes          text default '',
  created_by     text default '',
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create unique index if not exists idx_trn_invoices_no on trn_invoices (lower(inv_no));

create table if not exists trn_jobs (
  id                   uuid primary key default gen_random_uuid(),
  engagement_id        uuid not null references trn_engagements(id),
  engagement_ref       text default '',
  client_id            uuid,
  client_company       text default '',
  service              text not null,          -- Lorry / Mover / Rorobin
  status               text default 'Scheduled',
  start_datetime       text default '',        -- YYYY-MM-DD HH:MM
  end_datetime         text default '',
  from_location        text default '',
  to_location          text default '',
  lorry_type           text default '',
  lorry_plate          text default '',
  driver               text default '',
  trips                numeric default 0,
  collection_mover_by  text default '',
  delivery_mover_by    text default '',
  movers               numeric default 0,
  shifts               numeric default 0,
  items_description    text default '',
  bin_id               uuid references trn_bins(id),
  bin_no               text default '',
  placement_type       text default '',        -- Mall / Office Tower / Shop Lot / Roadside
  place_datetime       text default '',
  collect_datetime     text default '',
  permit_no            text default '',
  swcorp_ref           text default '',
  max_days             numeric default 0,
  rate_code            text default '',
  rate_label           text default '',
  unit_rate            numeric default 0,
  quantity             numeric default 0,
  amount               numeric default 0,
  invoice_id           uuid,
  handled_by           text default '',
  remarks              text default '',
  trip_id              uuid,
  stop_seq             int,
  internal_use         boolean default false,
  landfill             text default '',
  weight_tons          numeric default 0,
  tip_fee              numeric default 0,
  tipping_date         text default '',
  tipping_receipt_path text default '',        -- storage path
  stops                jsonb default '[]'::jsonb,
  created_by           text default '',
  created_at           timestamptz default now(),
  updated_by           text default '',
  updated_at           timestamptz default now()
);
create index if not exists idx_trn_jobs_eng  on trn_jobs (engagement_id);
create index if not exists idx_trn_jobs_trip on trn_jobs (trip_id);
create index if not exists idx_trn_jobs_inv  on trn_jobs (invoice_id);

create table if not exists trn_payments (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references trn_invoices(id) on delete cascade,
  pay_date    text default '',
  amount      numeric default 0,
  method      text default '',
  reference   text default '',
  received_by text default '',
  notes       text default '',
  created_at  timestamptz default now()
);
create index if not exists idx_trn_payments_inv on trn_payments (invoice_id);

create table if not exists trn_photos (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references trn_jobs(id) on delete cascade,
  engagement_id uuid,
  service       text default '',
  stage         text default '',
  storage_path  text default '',               -- path inside bucket transport-photos
  caption       text default '',
  taken_by      text default '',
  taken_at      timestamptz default now()
);
create index if not exists idx_trn_photos_job on trn_photos (job_id);

create table if not exists trn_settings (
  key   text primary key,
  value text default ''
);

-- ─── 2 · SEED (mirrors Apps Script setupSystem) ─────────────────────────────

insert into trn_settings (key, value) values
  ('COMPANY_NAME',          'HG Group'),
  ('COMPANY_REG',           ''),
  ('COMPANY_ADDRESS',       ''),
  ('COMPANY_PHONE',         ''),
  ('SST_NO',                ''),
  ('REMINDER_TO',           ''),
  ('INVOICE_DUE_SOON_DAYS', '5'),
  ('ENG_PREFIX',            'ENG-'),
  ('TRIP_PREFIX',           'RUN-'),
  ('DEFAULT_DAY_RATE',      '90'),
  ('DEFAULT_NIGHT_RATE',    '120'),
  ('ROROBIN_MAX_DAYS',      '3')
on conflict (key) do nothing;

insert into trn_rates (service, code, label, unit, rate, active)
select * from (values
  ('Lorry',   'LRY-1T',    'Lorry 1-Tonne',                'per trip',        250::numeric, true),
  ('Lorry',   'LRY-3T',    'Lorry 3-Tonne',                'per trip',        350, true),
  ('Lorry',   'LRY-5T',    'Lorry 5-Tonne',                'per trip',        500, true),
  ('Lorry',   'LRY-LB',    'Luton Box Lorry',              'per trip',        450, true),
  ('Mover',   'MOV-DAY',   'Mover — Day shift',            'per mover/shift', 120, true),
  ('Mover',   'MOV-NIGHT', 'Mover — Night shift',          'per mover/shift', 150, true),
  ('Rorobin', 'BIN-6Y',    'Rorobin 6-yard',               'per placement',   600, true),
  ('Rorobin', 'BIN-10Y',   'Rorobin 10-yard',              'per placement',   800, true),
  ('Rorobin', 'BIN-OVER',  'Overstay surcharge (per day)', 'per extra day',   100, true)
) as v(service, code, label, unit, rate, active)
where not exists (select 1 from trn_rates limit 1);

insert into trn_bins (bin_no, swcorp_reg, size, status, notes)
select * from (values
  ('BIN-01', '', '6-yard',  'Available', 'sample — set SWCorp reg'),
  ('BIN-02', '', '6-yard',  'Available', 'sample — set SWCorp reg'),
  ('BIN-03', '', '10-yard', 'Available', 'sample — set SWCorp reg'),
  ('BIN-04', '', '10-yard', 'Available', 'sample — set SWCorp reg')
) as v(bin_no, swcorp_reg, size, status, notes)
where not exists (select 1 from trn_bins limit 1);

insert into trn_lorries (plate_no, code, type, capacity, category, active, notes)
select * from (values
  ('VBA 1234', 'HG-01',   '1-Ton Lorry',       '1 ton',         'in-house',  true, 'Primary scaffold delivery'),
  ('VBB 5678', 'HG-02',   '3-Ton Lorry',       '3 ton',         'in-house',  true, 'Hoarding + rorobin'),
  ('WJK 9012', 'BALAN-A', 'Rorobin Hook-Lift', 'Bin transport', 'outsource', true, 'Balan''s fleet')
) as v(plate_no, code, type, capacity, category, active, notes)
where not exists (select 1 from trn_lorries limit 1);

-- ─── 3 · RPC · SAVE ENGAGEMENT (atomic sequential ENG-0001 ref) ─────────────
-- payload: { id?, clientId, reason, siteName, siteAddress, handledBy, remarks, status? }
create or replace function trn_save_engagement(payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_client trn_clients%rowtype;
  v_ex     trn_engagements%rowtype;
  v_prefix text; v_next int; v_ref text; v_id uuid;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  if coalesce(payload->>'clientId','') = '' then raise exception 'Client is required.'; end if;
  select * into v_client from trn_clients where id = (payload->>'clientId')::uuid;
  if not found then raise exception 'Client not found.'; end if;

  if coalesce(payload->>'id','') <> '' then
    select * into v_ex from trn_engagements where id = (payload->>'id')::uuid;
    if not found then raise exception 'Engagement not found.'; end if;
    update trn_engagements set
      client_id = v_client.id, client_company = v_client.company,
      reason = coalesce(nullif(payload->>'reason',''), 'Ad-hoc'),
      site_name = coalesce(payload->>'siteName', site_name),
      site_address = coalesce(payload->>'siteAddress', site_address),
      status = coalesce(nullif(payload->>'status',''), status),
      handled_by = coalesce(payload->>'handledBy', handled_by),
      remarks = coalesce(payload->>'remarks', remarks),
      updated_by = current_email(), updated_at = now()
    where id = v_ex.id;
    -- keep job denormalised client fields in sync
    update trn_jobs set client_company = v_client.company, client_id = v_client.id
      where engagement_id = v_ex.id;
    perform log_audit('UPDATE Engagement', v_ex.ref || ' · ' || v_client.company);
    return v_ex.id;
  end if;

  select coalesce((select nullif(value,'') from trn_settings where key = 'ENG_PREFIX'), 'ENG-') into v_prefix;
  select coalesce(max((substring(ref from length(v_prefix)+1))::int), 0) + 1 into v_next
    from trn_engagements
    where ref like v_prefix || '%' and substring(ref from length(v_prefix)+1) ~ '^[0-9]+$';
  v_ref := v_prefix || lpad(v_next::text, 4, '0');

  insert into trn_engagements (ref, client_id, client_company, reason, site_name, site_address,
                               status, handled_by, remarks, created_by, updated_by)
  values (v_ref, v_client.id, v_client.company,
          coalesce(nullif(payload->>'reason',''), 'Ad-hoc'),
          coalesce(payload->>'siteName',''), coalesce(payload->>'siteAddress',''),
          coalesce(nullif(payload->>'status',''), 'Open'),
          coalesce(nullif(payload->>'handledBy',''), current_email()),
          coalesce(payload->>'remarks',''), current_email(), current_email())
  returning id into v_id;
  perform log_audit('CREATE Engagement', v_ref || ' · ' || v_client.company || ' / ' || coalesce(nullif(payload->>'reason',''),'Ad-hoc'));
  return v_id;
end;
$$;

-- ─── 4 · RPC · SAVE JOB (server-side recompute: rate × qty, bin clash) ──────
-- payload mirrors the Apps Script saveJob(p) argument.
create or replace function trn_save_job(payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_eng        trn_engagements%rowtype;
  v_rate       trn_rates%rowtype;
  v_bin        trn_bins%rowtype;
  v_ex         trn_jobs%rowtype;
  v_rate_found boolean := false;
  v_service    text; v_internal boolean; v_manual text; v_has_manual boolean;
  v_qty        numeric; v_amount numeric; v_maxdays numeric;
  v_binid      uuid; v_binno text := '';
  v_stops      jsonb; v_first jsonb; v_last jsonb;
  v_start text; v_end text; v_from text; v_to text;
  v_ratelabel  text; v_id uuid;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  if coalesce(payload->>'engagementId','') = '' then raise exception 'Engagement is required.'; end if;
  v_service := payload->>'service';
  if v_service not in ('Lorry','Mover','Rorobin') then raise exception 'Pick a valid service.'; end if;
  select * into v_eng from trn_engagements where id = (payload->>'engagementId')::uuid;
  if not found then raise exception 'Engagement not found.'; end if;

  v_internal := coalesce((payload->>'internalUse')::boolean, false);
  v_manual := payload->>'manualAmount';
  v_has_manual := (not v_internal) and v_manual is not null and v_manual <> '';

  if coalesce(payload->>'rateCode','') <> '' then
    select * into v_rate from trn_rates where lower(code) = lower(payload->>'rateCode') limit 1;
    v_rate_found := found;
  end if;
  if (not v_internal) and (not v_has_manual) then
    if not v_rate_found then raise exception 'Pick a rate or key a charge amount.'; end if;
    if not v_rate.active then raise exception 'Rate % is inactive — pick an active rate.', v_rate.code; end if;
    if v_rate.service <> v_service then raise exception 'Rate % is for %, not %.', v_rate.code, v_rate.service, v_service; end if;
  end if;

  -- quantity per service
  if v_service = 'Lorry' then
    v_qty := greatest(1, coalesce(nullif(payload->>'trips','')::numeric, 1));
  elsif v_service = 'Mover' then
    v_qty := greatest(1, coalesce(nullif(payload->>'movers','')::numeric, 1)
                       * coalesce(nullif(payload->>'shifts','')::numeric, 1));
  else
    v_qty := greatest(1, coalesce(nullif(payload->>'quantity','')::numeric, 1));
  end if;
  v_amount := case when v_internal then 0
                   when v_has_manual then round(v_manual::numeric, 2)
                   else round(coalesce(v_rate.rate, 0) * v_qty, 2) end;

  -- rorobin bin handling + clash check
  if v_service = 'Rorobin' then
    v_binid := nullif(payload->>'binId','')::uuid;
    if v_binid is null then raise exception 'Select a rorobin bin.'; end if;
    select * into v_bin from trn_bins where id = v_binid;
    if not found then raise exception 'Bin not found.'; end if;
    v_binno := v_bin.bin_no;
    if coalesce(payload->>'collectDateTime','') = ''
       and coalesce(nullif(payload->>'status',''),'Scheduled') not in ('Completed','Cancelled') then
      perform 1 from trn_jobs j
        where j.service = 'Rorobin' and j.bin_id = v_binid
          and j.id is distinct from nullif(payload->>'id','')::uuid
          and j.status not in ('Completed','Cancelled')
          and coalesce(j.collect_datetime,'') = '';
      if found then raise exception 'Bin % is already deployed. Collect it first.', v_binno; end if;
    end if;
  end if;

  v_maxdays := coalesce(nullif(payload->>'maxDays','')::numeric,
                        (select nullif(value,'')::numeric from trn_settings where key = 'ROROBIN_MAX_DAYS'), 3);

  -- multi-stop legs (lorry): derive summary from/to/time when blank
  v_stops := coalesce(payload->'stops', '[]'::jsonb);
  v_start := coalesce(payload->>'startDateTime','');
  v_end   := coalesce(payload->>'endDateTime','');
  v_from  := coalesce(payload->>'fromLocation','');
  v_to    := coalesce(payload->>'toLocation','');
  if v_service = 'Lorry' and jsonb_array_length(v_stops) > 0 then
    v_first := v_stops->0;
    v_last  := v_stops->(jsonb_array_length(v_stops)-1);
    if v_start = '' then v_start := coalesce(v_first->>'pickupDateTime',''); end if;
    if v_end   = '' then v_end   := coalesce(v_last->>'deliveryDateTime',''); end if;
    if v_from  = '' then v_from  := coalesce(v_first->>'pickupLocation',''); end if;
    if v_to    = '' then v_to    := coalesce(v_last->>'deliveryLocation',''); end if;
  end if;

  v_ratelabel := case when v_internal then 'Internal use (no charge)'
                      when v_rate_found then v_rate.label
                      when v_has_manual then 'Keyed charge' else '' end;

  if coalesce(payload->>'id','') <> '' then
    select * into v_ex from trn_jobs where id = (payload->>'id')::uuid;
    if not found then raise exception 'Job not found.'; end if;
    if v_ex.invoice_id is not null then
      raise exception 'Job is already on invoice — void/unlink the invoice before editing the charge.';
    end if;
    update trn_jobs set
      engagement_id = v_eng.id, engagement_ref = v_eng.ref,
      client_id = v_eng.client_id, client_company = v_eng.client_company,
      service = v_service, status = coalesce(nullif(payload->>'status',''), 'Scheduled'),
      stops = v_stops, start_datetime = v_start, end_datetime = v_end,
      from_location = v_from, to_location = v_to,
      lorry_type = coalesce(payload->>'lorryType',''), lorry_plate = coalesce(payload->>'lorryPlate',''),
      driver = coalesce(payload->>'driver',''), trips = coalesce(nullif(payload->>'trips','')::numeric, 0),
      collection_mover_by = coalesce(payload->>'collectionMoverBy',''),
      delivery_mover_by = coalesce(payload->>'deliveryMoverBy',''),
      movers = coalesce(nullif(payload->>'movers','')::numeric, 0),
      shifts = coalesce(nullif(payload->>'shifts','')::numeric, 0),
      items_description = coalesce(payload->>'itemsDescription',''),
      bin_id = v_binid, bin_no = v_binno,
      placement_type = coalesce(payload->>'placementType',''),
      place_datetime = coalesce(payload->>'placeDateTime',''),
      collect_datetime = coalesce(payload->>'collectDateTime',''),
      permit_no = coalesce(payload->>'permitNo',''), swcorp_ref = coalesce(payload->>'swcorpRef',''),
      max_days = v_maxdays,
      rate_code = case when v_rate_found then v_rate.code else '' end,
      rate_label = v_ratelabel,
      unit_rate = coalesce(v_rate.rate, 0), quantity = v_qty, amount = v_amount,
      internal_use = v_internal,
      handled_by = coalesce(nullif(payload->>'handledBy',''), v_eng.handled_by, current_email()),
      remarks = coalesce(payload->>'remarks',''),
      updated_by = current_email(), updated_at = now()
    where id = v_ex.id;
    perform log_audit('UPDATE Job', v_eng.ref || '/' || v_service || ' · ' ||
      case when v_internal then 'Internal (no charge)' else 'RM' || v_amount end);
    return v_ex.id;
  end if;

  insert into trn_jobs (engagement_id, engagement_ref, client_id, client_company, service, status,
    stops, start_datetime, end_datetime, from_location, to_location, lorry_type, lorry_plate, driver,
    trips, collection_mover_by, delivery_mover_by, movers, shifts, items_description,
    bin_id, bin_no, placement_type, place_datetime, collect_datetime, permit_no, swcorp_ref, max_days,
    rate_code, rate_label, unit_rate, quantity, amount, internal_use, handled_by, remarks,
    created_by, updated_by)
  values (v_eng.id, v_eng.ref, v_eng.client_id, v_eng.client_company, v_service,
    coalesce(nullif(payload->>'status',''), 'Scheduled'),
    v_stops, v_start, v_end, v_from, v_to,
    coalesce(payload->>'lorryType',''), coalesce(payload->>'lorryPlate',''), coalesce(payload->>'driver',''),
    coalesce(nullif(payload->>'trips','')::numeric, 0),
    coalesce(payload->>'collectionMoverBy',''), coalesce(payload->>'deliveryMoverBy',''),
    coalesce(nullif(payload->>'movers','')::numeric, 0), coalesce(nullif(payload->>'shifts','')::numeric, 0),
    coalesce(payload->>'itemsDescription',''),
    v_binid, v_binno, coalesce(payload->>'placementType',''),
    coalesce(payload->>'placeDateTime',''), coalesce(payload->>'collectDateTime',''),
    coalesce(payload->>'permitNo',''), coalesce(payload->>'swcorpRef',''), v_maxdays,
    case when v_rate_found then v_rate.code else '' end, v_ratelabel,
    coalesce(v_rate.rate, 0), v_qty, v_amount, v_internal,
    coalesce(nullif(payload->>'handledBy',''), v_eng.handled_by, current_email()),
    coalesce(payload->>'remarks',''), current_email(), current_email())
  returning id into v_id;
  perform log_audit('CREATE Job', v_eng.ref || '/' || v_service || ' · ' ||
    case when v_internal then 'Internal (no charge)'
         else 'RM' || v_amount || ' (' || coalesce(v_rate.code,'-') || ' ×' || v_qty || ')' end);
  return v_id;
end;
$$;

-- ─── 5 · RPC · SAVE TRIP / RUN (atomic sequential RUN-0001 ref) ─────────────
-- payload: { id?, tripDate, shift, status, lorryPlate, driver, driverId, driverCost, lorryCost, notes, crew:[] }
create or replace function trn_save_trip(payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_ex trn_trips%rowtype;
  v_prefix text; v_next int; v_ref text; v_id uuid;
  v_crew jsonb := coalesce(payload->'crew', '[]'::jsonb);
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;

  if coalesce(payload->>'id','') <> '' then
    select * into v_ex from trn_trips where id = (payload->>'id')::uuid;
    if not found then raise exception 'Trip not found.'; end if;
    update trn_trips set
      trip_date = coalesce(nullif(payload->>'tripDate',''), (now() at time zone 'Asia/Kuala_Lumpur')::date::text),
      shift = case when payload->>'shift' = 'Night' then 'Night' else 'Day' end,
      lorry_plate = coalesce(payload->>'lorryPlate',''), driver = coalesce(payload->>'driver',''),
      driver_id = nullif(payload->>'driverId','')::uuid,
      driver_cost = round(coalesce(nullif(payload->>'driverCost','')::numeric, 0), 2),
      lorry_cost = round(coalesce(nullif(payload->>'lorryCost','')::numeric, 0), 2),
      crew = v_crew, status = coalesce(nullif(payload->>'status',''), 'Planned'),
      notes = coalesce(payload->>'notes',''),
      updated_by = current_email(), updated_at = now()
    where id = v_ex.id;
    perform log_audit('UPDATE Trip', v_ex.ref || ' · ' || coalesce(payload->>'lorryPlate','') ||
      ' · ' || jsonb_array_length(v_crew) || ' crew');
    return v_ex.id;
  end if;

  select coalesce((select nullif(value,'') from trn_settings where key = 'TRIP_PREFIX'), 'RUN-') into v_prefix;
  select coalesce(max((substring(ref from length(v_prefix)+1))::int), 0) + 1 into v_next
    from trn_trips
    where ref like v_prefix || '%' and substring(ref from length(v_prefix)+1) ~ '^[0-9]+$';
  v_ref := v_prefix || lpad(v_next::text, 4, '0');

  insert into trn_trips (ref, trip_date, shift, lorry_plate, driver, driver_id, driver_cost, lorry_cost,
                         crew, status, notes, created_by, updated_by)
  values (v_ref,
    coalesce(nullif(payload->>'tripDate',''), (now() at time zone 'Asia/Kuala_Lumpur')::date::text),
    case when payload->>'shift' = 'Night' then 'Night' else 'Day' end,
    coalesce(payload->>'lorryPlate',''), coalesce(payload->>'driver',''),
    nullif(payload->>'driverId','')::uuid,
    round(coalesce(nullif(payload->>'driverCost','')::numeric, 0), 2),
    round(coalesce(nullif(payload->>'lorryCost','')::numeric, 0), 2),
    v_crew, coalesce(nullif(payload->>'status',''), 'Planned'), coalesce(payload->>'notes',''),
    current_email(), current_email())
  returning id into v_id;
  perform log_audit('CREATE Trip', v_ref || ' · ' || coalesce(payload->>'lorryPlate','') ||
    ' · ' || jsonb_array_length(v_crew) || ' crew');
  return v_id;
end;
$$;

-- ─── 6 · RPC · ASSIGN JOBS TO TRIP (stops appended after max stop seq) ──────
create or replace function trn_assign_jobs_to_trip(p_trip_id uuid, p_job_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_trip trn_trips%rowtype;
  v_seq int; v_jid uuid; v_job trn_jobs%rowtype;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  select * into v_trip from trn_trips where id = p_trip_id;
  if not found then raise exception 'Trip not found.'; end if;
  select coalesce(max(stop_seq), 0) into v_seq from trn_jobs where trip_id = p_trip_id;
  foreach v_jid in array coalesce(p_job_ids, '{}') loop
    select * into v_job from trn_jobs where id = v_jid;
    if not found then continue; end if;
    if v_job.trip_id is not null and v_job.trip_id <> p_trip_id then
      raise exception 'A job is already on another run (%). Remove it first.', v_job.engagement_ref;
    end if;
    v_seq := v_seq + 1;
    update trn_jobs set trip_id = p_trip_id, stop_seq = v_seq where id = v_jid;
  end loop;
  perform log_audit('TRIP_ASSIGN', v_trip.ref || ' · ' || coalesce(array_length(p_job_ids,1),0) || ' stop(s)');
end;
$$;

-- ─── 7 · RPC · ADD RUN STOP (run-first billable stop; auto Transport engmnt) ─
-- payload: { tripId, clientId, lorry, lorryCharge, mover, moverCharge, workers:[],
--            pickupLocation, pickupDateTime, deliveryLocation, deliveryDateTime,
--            notes, internalUse, status? }
create or replace function trn_add_run_stop(payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_trip trn_trips%rowtype;
  v_client trn_clients%rowtype;
  v_eng trn_engagements%rowtype;
  v_prefix text; v_next int; v_ref text;
  v_lorry_charge numeric; v_mover_charge numeric;
  v_internal boolean; v_want_lorry boolean; v_want_mover boolean;
  v_seq int; v_workers jsonb; v_nworkers int;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  select * into v_trip from trn_trips where id = nullif(payload->>'tripId','')::uuid;
  if not found then raise exception 'Run not found.'; end if;
  if coalesce(payload->>'clientId','') = '' then raise exception 'Select a client for this stop.'; end if;
  select * into v_client from trn_clients where id = (payload->>'clientId')::uuid;
  if not found then raise exception 'Client not found.'; end if;

  v_lorry_charge := round(coalesce(nullif(payload->>'lorryCharge','')::numeric, 0), 2);
  v_mover_charge := round(coalesce(nullif(payload->>'moverCharge','')::numeric, 0), 2);
  v_internal := coalesce((payload->>'internalUse')::boolean, false);
  v_want_lorry := coalesce((payload->>'lorry')::boolean, false) or v_lorry_charge > 0;
  v_want_mover := coalesce((payload->>'mover')::boolean, false) or v_mover_charge > 0;
  if not v_want_lorry and not v_want_mover then
    raise exception 'Tick Lorry and/or Mover for this stop (with a charge, or mark internal).';
  end if;

  -- find or create the client's auto "Transport" engagement
  select * into v_eng from trn_engagements
    where client_id = v_client.id and reason = 'Transport' and status <> 'Cancelled'
    order by created_at limit 1;
  if not found then
    select coalesce((select nullif(value,'') from trn_settings where key = 'ENG_PREFIX'), 'ENG-') into v_prefix;
    select coalesce(max((substring(ref from length(v_prefix)+1))::int), 0) + 1 into v_next
      from trn_engagements
      where ref like v_prefix || '%' and substring(ref from length(v_prefix)+1) ~ '^[0-9]+$';
    v_ref := v_prefix || lpad(v_next::text, 4, '0');
    insert into trn_engagements (ref, client_id, client_company, reason, status, handled_by, remarks,
                                 created_by, updated_by)
    values (v_ref, v_client.id, v_client.company, 'Transport', 'Open', current_email(),
            'Auto-created for transport runs', current_email(), current_email())
    returning * into v_eng;
    perform log_audit('CREATE Engagement', v_ref || ' · ' || v_client.company || ' / Transport (auto)');
  end if;

  select coalesce(max(stop_seq), 0) into v_seq from trn_jobs where trip_id = v_trip.id;
  v_workers := coalesce(payload->'workers', '[]'::jsonb);
  v_nworkers := jsonb_array_length(v_workers);

  if v_want_lorry then
    v_seq := v_seq + 1;
    insert into trn_jobs (engagement_id, engagement_ref, client_id, client_company, service, status,
      start_datetime, end_datetime, from_location, to_location, items_description,
      lorry_plate, driver, trips, movers, shifts, quantity, unit_rate, amount, rate_label,
      internal_use, handled_by, trip_id, stop_seq, stops, created_by, updated_by)
    values (v_eng.id, v_eng.ref, v_client.id, v_client.company, 'Lorry',
      coalesce(nullif(payload->>'status',''), 'Scheduled'),
      coalesce(payload->>'pickupDateTime',''), coalesce(payload->>'deliveryDateTime',''),
      coalesce(payload->>'pickupLocation',''), coalesce(payload->>'deliveryLocation',''),
      coalesce(payload->>'notes',''),
      v_trip.lorry_plate, v_trip.driver, 1, 0, 0, 1,
      case when v_internal then 0 else v_lorry_charge end,
      case when v_internal then 0 else v_lorry_charge end,
      case when v_internal then 'Internal use (no charge)' else 'Keyed charge' end,
      v_internal, coalesce(nullif(payload->>'handledBy',''), nullif(v_trip.driver,''), current_email()),
      v_trip.id, v_seq, '[]'::jsonb, current_email(), current_email());
  end if;

  if v_want_mover then
    v_seq := v_seq + 1;
    insert into trn_jobs (engagement_id, engagement_ref, client_id, client_company, service, status,
      start_datetime, end_datetime, from_location, to_location, items_description,
      lorry_plate, driver, trips, movers, shifts, quantity, unit_rate, amount, rate_label,
      internal_use, handled_by, trip_id, stop_seq, stops, remarks, created_by, updated_by)
    values (v_eng.id, v_eng.ref, v_client.id, v_client.company, 'Mover',
      coalesce(nullif(payload->>'status',''), 'Scheduled'),
      coalesce(payload->>'pickupDateTime',''), coalesce(payload->>'deliveryDateTime',''),
      coalesce(payload->>'pickupLocation',''), coalesce(payload->>'deliveryLocation',''),
      coalesce(payload->>'notes',''),
      v_trip.lorry_plate, v_trip.driver, 0,
      greatest(1, coalesce(nullif(v_nworkers,0), coalesce(nullif(payload->>'moverCount','')::int, 1))), 1, 1,
      case when v_internal then 0 else v_mover_charge end,
      case when v_internal then 0 else v_mover_charge end,
      case when v_internal then 'Internal use (no charge)' else 'Keyed charge' end,
      v_internal, coalesce(nullif(payload->>'handledBy',''), nullif(v_trip.driver,''), current_email()),
      v_trip.id, v_seq, '[]'::jsonb,
      case when v_nworkers > 0 then 'Crew: ' ||
        (select string_agg(w #>> '{}', ', ') from jsonb_array_elements(v_workers) w) else '' end,
      current_email(), current_email());
  end if;

  perform log_audit('RUN_STOP', v_trip.ref || ' · ' || v_client.company ||
    case when v_want_lorry then ' · Lorry ' || case when v_internal then 'internal' else 'RM' || v_lorry_charge end else '' end ||
    case when v_want_mover then ' · Mover ' || case when v_internal then 'internal' else 'RM' || v_mover_charge end else '' end);
end;
$$;

-- ─── 8 · RPC · SAVE INVOICE (sums selected jobs, SST 6%, stamps jobs) ───────
-- payload: { id?, invNo, engagementId, jobIds:[], invDate, dueDate, sstEnabled,
--            notes, description?, filePath?, status? }
create or replace function trn_save_invoice(payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_eng trn_engagements%rowtype;
  v_ex  trn_invoices%rowtype;
  v_job trn_jobs%rowtype;
  v_ids uuid[]; v_jid uuid;
  v_amount numeric := 0; v_sst_on boolean; v_sst numeric; v_total numeric;
  v_desc text; v_services text := ''; v_id uuid; v_count int := 0;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  if coalesce(payload->>'invNo','') = '' then raise exception 'Invoice number is required.'; end if;
  if coalesce(payload->>'engagementId','') = '' then raise exception 'Engagement is required.'; end if;
  if coalesce(payload->>'invDate','') = '' then raise exception 'Invoice date is required.'; end if;
  if jsonb_array_length(coalesce(payload->'jobIds','[]'::jsonb)) = 0 then
    raise exception 'Select at least one job to bill.';
  end if;
  select * into v_eng from trn_engagements where id = (payload->>'engagementId')::uuid;
  if not found then raise exception 'Engagement not found.'; end if;

  -- unique invoice number
  perform 1 from trn_invoices
    where lower(inv_no) = lower(trim(payload->>'invNo'))
      and id is distinct from nullif(payload->>'id','')::uuid;
  if found then raise exception 'Invoice number % already exists.', payload->>'invNo'; end if;

  select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(payload->'jobIds') x;
  foreach v_jid in array v_ids loop
    select * into v_job from trn_jobs where id = v_jid;
    if not found then raise exception 'Some selected jobs were not found.'; end if;
    if v_job.engagement_id <> v_eng.id then
      raise exception 'Job % is not in this engagement.', v_job.service;
    end if;
    if v_job.invoice_id is not null and v_job.invoice_id is distinct from nullif(payload->>'id','')::uuid then
      raise exception 'Job %/% is already on another invoice.', v_job.engagement_ref, v_job.service;
    end if;
    v_amount := v_amount + coalesce(v_job.amount, 0);
    v_count := v_count + 1;
    v_services := v_services || case when v_services = '' then '' else ' + ' end || v_job.service;
  end loop;
  v_amount := round(v_amount, 2);
  v_sst_on := coalesce((payload->>'sstEnabled')::boolean, false);
  v_sst := case when v_sst_on then round(v_amount * 0.06, 2) else 0 end;
  v_total := round(v_amount + v_sst, 2);
  v_desc := coalesce(nullif(payload->>'description',''), 'Engagement ' || v_eng.ref || ' — ' || v_services);

  if coalesce(payload->>'id','') <> '' then
    select * into v_ex from trn_invoices where id = (payload->>'id')::uuid;
    if not found then raise exception 'Invoice not found.'; end if;
    v_id := v_ex.id;
    update trn_invoices set
      inv_no = trim(payload->>'invNo'), engagement_id = v_eng.id, engagement_ref = v_eng.ref,
      client_id = v_eng.client_id, client_company = v_eng.client_company,
      inv_date = payload->>'invDate', due_date = coalesce(payload->>'dueDate',''),
      description = v_desc, amount = v_amount, sst_enabled = v_sst_on, sst_amount = v_sst, total = v_total,
      status = case when payload->>'status' = 'Void' then 'Void' else '' end,
      file_path = coalesce(nullif(payload->>'filePath',''), file_path),
      notes = coalesce(payload->>'notes',''), updated_at = now()
    where id = v_id;
    update trn_jobs set invoice_id = null where invoice_id = v_id;   -- re-stamp
    perform log_audit('UPDATE Invoice', (payload->>'invNo') || ' · ' || v_eng.client_company || ' / RM' || v_total);
  else
    insert into trn_invoices (inv_no, engagement_id, engagement_ref, client_id, client_company,
      inv_date, due_date, description, amount, sst_enabled, sst_amount, total, status, file_path, notes,
      created_by)
    values (trim(payload->>'invNo'), v_eng.id, v_eng.ref, v_eng.client_id, v_eng.client_company,
      payload->>'invDate', coalesce(payload->>'dueDate',''), v_desc,
      v_amount, v_sst_on, v_sst, v_total,
      case when payload->>'status' = 'Void' then 'Void' else '' end,
      coalesce(payload->>'filePath',''), coalesce(payload->>'notes',''), current_email())
    returning id into v_id;
    perform log_audit('CREATE Invoice', (payload->>'invNo') || ' · ' || v_eng.client_company || ' / RM' || v_total);
  end if;

  update trn_jobs set invoice_id = v_id where id = any(v_ids);
  return v_id;
end;
$$;

-- ─── 9 · ALARMS VIEW (read by daily-alarms Edge Function + shown in the UI) ─
-- Same alerts the Apps Script daily email sent: rorobin overstays + overdue invoices.
drop view if exists trn_alarms;
create view trn_alarms with (security_invoker = true) as
select 'BIN_OVERSTAY'::text as alarm_type,
       coalesce(j.engagement_ref,'') || '/Bin ' || coalesce(j.bin_no,'?') as ref,
       'OVERSTAY — Bin ' || coalesce(j.bin_no,'?') || ' · ' || coalesce(j.client_company,'') ||
         ', placed ' || j.place_datetime || ', collect by ' || to_char(j.deadline, 'YYYY-MM-DD HH24:MI') as detail,
       j.deadline::date as due_date,
       coalesce((select nullif(value,'') from trn_settings where key = 'REMINDER_TO'), '') as recipient
from (
  select b.*,
    case when b.placement_type in ('Mall','Office Tower')
      then date_trunc('day', to_timestamp(b.place_datetime, 'YYYY-MM-DD HH24:MI')) + interval '1 day 6 hours'
      else to_timestamp(b.place_datetime, 'YYYY-MM-DD HH24:MI')
           + make_interval(days => greatest(1, coalesce(nullif(b.max_days, 0),
               (select nullif(value,'')::numeric from trn_settings where key = 'ROROBIN_MAX_DAYS'), 3))::int)
    end as deadline
  from trn_jobs b
  where b.service = 'Rorobin'
    and coalesce(b.place_datetime,'') <> ''
    and coalesce(b.collect_datetime,'') = ''
    and b.status not in ('Completed','Cancelled')
) j
where (now() at time zone 'Asia/Kuala_Lumpur') > j.deadline
union all
select 'INVOICE_OVERDUE',
       i.inv_no,
       'OVERDUE invoice ' || i.inv_no || ' · ' || coalesce(i.client_company,'') ||
         ' — balance RM ' || round(i.total - coalesce(p.paid, 0), 2),
       i.due_date::date,
       coalesce((select nullif(value,'') from trn_settings where key = 'REMINDER_TO'), '')
from trn_invoices i
left join (select invoice_id, sum(amount) as paid from trn_payments group by invoice_id) p
       on p.invoice_id = i.id
where coalesce(i.status,'') <> 'Void'
  and coalesce(i.due_date,'') <> ''
  and i.due_date::date < (now() at time zone 'Asia/Kuala_Lumpur')::date
  and (i.total - coalesce(p.paid, 0)) > 0.005;

-- ─── 10 · STORAGE (job photos, invoice files, tipping receipts) ─────────────
insert into storage.buckets (id, name, public) values ('transport-photos','transport-photos', false)
on conflict (id) do nothing;
drop policy if exists "transport-photos_rw" on storage.objects;
create policy "transport-photos_rw" on storage.objects for all to authenticated
  using (bucket_id = 'transport-photos' and is_allowed())
  with check (bucket_id = 'transport-photos' and is_allowed());

-- ─── 11 · ROW-LEVEL SECURITY (allowlist-gated everything) ───────────────────
do $$
declare t text;
begin
  foreach t in array array['trn_clients','trn_engagements','trn_jobs','trn_bins','trn_rates',
                           'trn_workers','trn_lorries','trn_trips','trn_invoices','trn_payments',
                           'trn_photos','trn_settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format('create policy %I_rw on %I for all to authenticated using (is_allowed()) with check (is_allowed())', t, t);
  end loop;
end $$;

-- Done. Open transport-supabase.html, connect once, sign in with Google.
