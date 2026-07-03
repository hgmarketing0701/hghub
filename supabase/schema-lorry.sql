-- ============================================================================
-- HG GROUP — LORRY FLEET MANAGEMENT · Supabase schema (slug: lorry, prefix: lry_)
-- Converted from apps-script-lorry (Google Sheet + Drive → Postgres + Storage).
-- Run AFTER the foundation schema.sql. Additive + idempotent — safe to re-run.
--
-- Creates:
--   lry_vehicles          — fleet register (lorry/van/car/… + vehicle card doc)
--   lry_fuel_logs         — fuel entries (pump + receipt photos)
--   lry_toll_park_logs    — toll & parking entries
--   lry_maint_logs        — maintenance/repair (line items, per-line tax, photos)
--   lry_compliance_logs   — road tax / insurance / puspakom (renewal chain)
--   lry_incident_logs     — accidents / theft / vandalism / special cases
--   lry_drivers           — driver register (licence + GDL expiry, docs)
--   lry_summon_logs       — traffic summonses (discount deadline logic)
--   lry_save_maint()      — RPC: server-side recompute of maintenance totals
--   lry_bulk_mark_paid()  — RPC: knock off many bills with one payment slip
--   lry_alarms            — view consumed by the daily-alarms Edge Function
--   storage bucket 'lorry-files' (private) + RLS policy
-- ============================================================================

-- ─── 1 · VEHICLES ────────────────────────────────────────────────────────────
create table if not exists lry_vehicles (
  id                 uuid primary key default gen_random_uuid(),
  plate              text not null,
  vehicle_code       text default '',
  model              text default '',
  year               int,
  active             boolean default true,
  notes              text default '',
  vehicle_card_path  text default '',          -- storage path of geran photo/PDF
  vehicle_type       text default 'lorry',     -- lorry/van/car/pickup/motorcycle/bus/machinery/other
  created_by         text default '',
  created_at         timestamptz default now(),
  updated_by         text default '',
  updated_at         timestamptz default now()
);
create index if not exists idx_lry_vehicles_plate on lry_vehicles (plate);

-- ─── 2 · FUEL LOGS ───────────────────────────────────────────────────────────
create table if not exists lry_fuel_logs (
  id                  uuid primary key default gen_random_uuid(),
  date                date not null,
  plate               text not null,
  odometer            numeric,
  litres              numeric,
  amount_rm           numeric not null default 0,
  station             text default '',
  paid_by             text default '',          -- company-card/cash/driver-reimburse/fleet-card
  driver              text default '',
  notes               text default '',
  pump_photo_path     text default '',
  receipt_photo_path  text default '',
  created_by          text default '',
  created_at          timestamptz default now(),
  updated_by          text default '',
  updated_at          timestamptz default now()
);
create index if not exists idx_lry_fuel_plate_date on lry_fuel_logs (plate, date);

-- ─── 3 · TOLL & PARKING LOGS ─────────────────────────────────────────────────
create table if not exists lry_toll_park_logs (
  id                  uuid primary key default gen_random_uuid(),
  date                date not null,
  plate               text not null,
  type                text not null default 'toll',   -- toll | parking
  amount_rm           numeric not null default 0,
  location            text default '',
  paid_by             text default '',
  driver              text default '',
  job_ref             text default '',
  duration            text default '',
  notes               text default '',
  receipt_photo_path  text default '',
  created_by          text default '',
  created_at          timestamptz default now(),
  updated_by          text default '',
  updated_at          timestamptz default now()
);
create index if not exists idx_lry_toll_plate_date on lry_toll_park_logs (plate, date);

-- ─── 4 · MAINTENANCE LOGS ────────────────────────────────────────────────────
create table if not exists lry_maint_logs (
  id                    uuid primary key default gen_random_uuid(),
  date                  date not null,
  plate                 text not null,
  odometer              numeric,
  type                  text default 'service',   -- service/repair/tyre/battery/other
  items_replaced        text default '',          -- flat searchable text (derived)
  workshop              text default '',
  cost_rm               numeric default 0,        -- grand total (server recomputed)
  next_service_km       numeric,
  next_service_date     date,
  notes                 text default '',
  receipt_photo_paths   jsonb default '[]'::jsonb,
  line_items            jsonb default '[]'::jsonb, -- [{desc,qty,rate,tax}]
  sub_total             numeric,
  taxable               boolean,
  tax_rate              numeric,                  -- legacy invoice-level rate (fraction)
  tax_amount            numeric,
  discount_amount       numeric,
  before_photo_paths    jsonb default '[]'::jsonb,
  after_photo_paths     jsonb default '[]'::jsonb,
  payment_slip_paths    jsonb default '[]'::jsonb,
  payment_ref           text default '',
  paid_date             date,
  invoice_number        text default '',
  paid_rm               numeric,
  created_by            text default '',
  created_at            timestamptz default now(),
  updated_by            text default '',
  updated_at            timestamptz default now()
);
create index if not exists idx_lry_maint_plate_date on lry_maint_logs (plate, date);

-- ─── 5 · COMPLIANCE LOGS (Road Tax / Insurance / Puspakom) ───────────────────
create table if not exists lry_compliance_logs (
  id                    uuid primary key default gen_random_uuid(),
  plate                 text not null,
  type                  text not null,             -- roadtax | insurance | puspakom
  status                text default 'active',     -- active/renewed/cancelled/lost/archived
  issued_date           date,
  expiry_date           date,
  amount_rm             numeric default 0,
  coverage_rm           numeric,
  insurer               text default '',
  policy_number         text default '',
  agency_name           text default '',
  agency_charges_rm     numeric,
  notes                 text default '',
  main_doc_paths        jsonb default '[]'::jsonb,
  receipt_paths         jsonb default '[]'::jsonb,
  agent_invoice_paths   jsonb default '[]'::jsonb,
  payment_slip_paths    jsonb default '[]'::jsonb,
  renewed_by_id         text default '',           -- id of the entry that replaced this one
  prev_id               text default '',           -- id of the entry this renews
  payment_ref           text default '',
  paid_date             date,
  created_by            text default '',
  created_at            timestamptz default now(),
  updated_by            text default '',
  updated_at            timestamptz default now()
);
create index if not exists idx_lry_comp_plate_type on lry_compliance_logs (plate, type);
create index if not exists idx_lry_comp_expiry on lry_compliance_logs (expiry_date);

-- ─── 6 · INCIDENT LOGS ───────────────────────────────────────────────────────
create table if not exists lry_incident_logs (
  id                          uuid primary key default gen_random_uuid(),
  date                        date not null,
  time                        text default '',
  plate                       text not null,
  driver_name                 text default '',
  location                    text default '',
  location_gps                text default '',
  type                        text not null default 'other',
  collision_type              text default 'none',
  collision_other             text default '',
  third_party_plates          text default '',
  third_party_name            text default '',
  third_party_contact         text default '',
  third_party_insurer         text default '',
  fault_party                 text default 'n-a',
  details                     text default '',
  damaged_asset               text default '',
  witnesses                   text default '',
  towed                       text default 'none',
  tow_company                 text default '',
  tow_cost_rm                 numeric,
  injury_any                  boolean default false,
  injury_action               text default 'none',
  injured_person_name         text default '',
  hospital_name               text default '',
  injury_details              text default '',
  police_report_status        text default 'not-filed',
  police_report_number        text default '',
  police_station              text default '',
  follow_up_needed            boolean default false,
  follow_up_notes             text default '',
  incident_photo_paths        jsonb default '[]'::jsonb,
  police_report_paths         jsonb default '[]'::jsonb,
  quotation_paths             jsonb default '[]'::jsonb,
  compensation_paid_rm        numeric,
  compensation_paid_to        text default '',
  compensation_paid_paths     jsonb default '[]'::jsonb,
  compensation_received_rm    numeric,
  compensation_received_from  text default '',
  compensation_received_paths jsonb default '[]'::jsonb,
  insurance_claim_filed       boolean default false,
  insurance_company           text default '',
  claim_number                text default '',
  claim_amount_rm             numeric,
  claim_status                text default 'none',
  repair_action               text default 'not-required',
  linked_maint_id             text default '',
  status                      text default 'open',
  notes                       text default '',
  created_by                  text default '',
  created_at                  timestamptz default now(),
  updated_by                  text default '',
  updated_at                  timestamptz default now()
);
create index if not exists idx_lry_inc_plate_date on lry_incident_logs (plate, date);

-- ─── 7 · DRIVERS ─────────────────────────────────────────────────────────────
create table if not exists lry_drivers (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null,
  ic_number                 text default '',
  staff_id                  text default '',
  phone                     text default '',
  email                     text default '',
  active                    boolean default true,
  license_class             text default '',
  license_number            text default '',
  license_issue_date        date,
  license_expiry_date       date,
  gdl_expiry_date           date,
  address                   text default '',
  emergency_contact_name    text default '',
  emergency_contact_phone   text default '',
  hire_date                 date,
  assigned_plate            text default '',
  status                    text default 'active',   -- active/on-leave/resigned/terminated
  notes                     text default '',
  photo_path                text default '',
  license_doc_paths         jsonb default '[]'::jsonb,
  ic_doc_paths              jsonb default '[]'::jsonb,
  category                  text default 'in-house', -- in-house/outsourced/relief/contract
  created_by                text default '',
  created_at                timestamptz default now(),
  updated_by                text default '',
  updated_at                timestamptz default now()
);

-- ─── 8 · SUMMONS ─────────────────────────────────────────────────────────────
create table if not exists lry_summon_logs (
  id                    uuid primary key default gen_random_uuid(),
  summon_number         text not null,
  issued_date           date not null,
  issued_by             text default '',          -- PDRM/JPJ/AES/MBPJ/DBKL/…
  plate                 text default '',
  driver_name           text default '',
  driver_id             text default '',
  location              text default '',
  offence_type          text default '',
  offence_details       text default '',
  fine_rm               numeric,
  discount_rm           numeric,
  discount_deadline     date,
  payment_deadline      date,
  status                text default 'outstanding', -- outstanding/paid/partially-paid/disputed/court/cancelled/blacklisted
  paid_rm               numeric,
  paid_date             date,
  payment_ref           text default '',
  payment_proof_paths   jsonb default '[]'::jsonb,
  court_date            date,
  responsible_party     text default 'company',   -- company/driver/shared
  notes                 text default '',
  summon_copy_paths     jsonb default '[]'::jsonb,
  created_by            text default '',
  created_at            timestamptz default now(),
  updated_by            text default '',
  updated_at            timestamptz default now()
);
create index if not exists idx_lry_summon_plate on lry_summon_logs (plate);
create index if not exists idx_lry_summon_deadline on lry_summon_logs (payment_deadline);

-- ─── 9 · ROW-LEVEL SECURITY ──────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'lry_vehicles','lry_fuel_logs','lry_toll_park_logs','lry_maint_logs',
    'lry_compliance_logs','lry_incident_logs','lry_drivers','lry_summon_logs'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format('create policy %I_rw on %I for all to authenticated using (is_allowed()) with check (is_allowed())', t, t);
  end loop;
end $$;

-- ─── 10 · STORAGE — bucket 'lorry-files' (private, allowlist-gated) ──────────
insert into storage.buckets (id, name, public) values ('lorry-files','lorry-files', false)
on conflict (id) do nothing;
drop policy if exists "lorry-files_rw" on storage.objects;
create policy "lorry-files_rw" on storage.objects for all to authenticated
  using (bucket_id = 'lorry-files' and is_allowed())
  with check (bucket_id = 'lorry-files' and is_allowed());

-- ─── 11 · RPC — lry_save_maint (server-side recompute, mirrors GAS saveMaint) ─
-- payload: { id?, date, plate, odometer, type, workshop, invoiceNumber, paidRM,
--            nextServiceKm, nextServiceDate, notes, itemsReplaced?, costRM?,
--            lineItems:[{desc,qty,rate,tax}], taxable, taxRate, discountAmount,
--            receiptPhotoIds:[], beforePhotoIds:[], afterPhotoIds:[], paymentSlipIds:[] }
create or replace function lry_save_maint(payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id          uuid;
  v_line        jsonb;
  v_lines       jsonb := '[]'::jsonb;
  v_desc        text; v_qty numeric; v_rate numeric; v_tax numeric;
  v_sub         numeric := 0;
  v_perlinetax  numeric := 0;
  v_disc        numeric;
  v_taxable     boolean;
  v_legacyrate  numeric;
  v_legacytax   numeric := 0;
  v_taxamt      numeric;
  v_cost        numeric;
  v_items       text := '';
  v_cur         lry_maint_logs%rowtype;
  v_exists      boolean := false;
  v_has_lines   boolean;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  if coalesce(payload->>'date','') = '' or coalesce(payload->>'plate','') = '' then
    raise exception 'Date and plate required.';
  end if;
  if coalesce(payload->>'odometer','') = '' then
    raise exception 'Odometer is required for maintenance.';
  end if;

  -- Normalise line items (drop blank rows) — never trust client maths
  for v_line in select * from jsonb_array_elements(coalesce(payload->'lineItems','[]'::jsonb)) loop
    v_desc := trim(coalesce(v_line->>'desc',''));
    v_qty  := coalesce(nullif(v_line->>'qty','')::numeric, 0);
    v_rate := coalesce(nullif(v_line->>'rate','')::numeric, 0);
    v_tax  := greatest(0, coalesce(nullif(v_line->>'tax','')::numeric, 0));
    if v_desc <> '' or v_qty > 0 or v_rate > 0 then
      v_lines      := v_lines || jsonb_build_object('desc', v_desc, 'qty', v_qty, 'rate', v_rate, 'tax', v_tax);
      v_sub        := v_sub + v_qty * v_rate;
      v_perlinetax := v_perlinetax + v_qty * v_rate * v_tax / 100;
      v_items      := v_items || case when v_items = '' then '' else E'\n' end ||
                      case when v_qty > 1 then v_qty::text || 'x ' || v_desc else v_desc end;
    end if;
  end loop;
  v_has_lines := jsonb_array_length(v_lines) > 0;

  v_disc       := greatest(0, coalesce(nullif(payload->>'discountAmount','')::numeric, 0));
  v_taxable    := coalesce((payload->>'taxable')::boolean, false);
  v_legacyrate := coalesce(nullif(payload->>'taxRate','')::numeric, 0.06);
  if v_legacyrate < 0 then v_legacyrate := 0.06; end if;
  if v_perlinetax = 0 and v_taxable then v_legacytax := v_sub * v_legacyrate; end if;
  v_taxamt := case when v_perlinetax > 0 then v_perlinetax else v_legacytax end;

  if v_has_lines then
    v_cost := greatest(0, v_sub + v_taxamt - v_disc);
  else
    -- No line items — accept a raw costRM (legacy flow)
    v_cost := nullif(payload->>'costRM','')::numeric;
    if v_cost is null or v_cost < 0 then
      raise exception 'Either add line items or fill the Cost (RM) field.';
    end if;
    v_items := coalesce(payload->>'itemsReplaced','');
  end if;

  v_id := nullif(payload->>'id','')::uuid;
  if v_id is not null then
    select * into v_cur from lry_maint_logs where id = v_id;
    v_exists := found;
  end if;

  if v_exists then
    update lry_maint_logs set
      date                = (payload->>'date')::date,
      plate               = payload->>'plate',
      odometer            = (payload->>'odometer')::numeric,
      type                = coalesce(nullif(payload->>'type',''),'service'),
      items_replaced      = v_items,
      workshop            = trim(coalesce(payload->>'workshop','')),
      cost_rm             = v_cost,
      next_service_km     = nullif(payload->>'nextServiceKm','')::numeric,
      next_service_date   = nullif(payload->>'nextServiceDate','')::date,
      notes               = trim(coalesce(payload->>'notes','')),
      receipt_photo_paths = coalesce(payload->'receiptPhotoIds','[]'::jsonb),
      before_photo_paths  = coalesce(payload->'beforePhotoIds','[]'::jsonb),
      after_photo_paths   = coalesce(payload->'afterPhotoIds','[]'::jsonb),
      payment_slip_paths  = coalesce(payload->'paymentSlipIds','[]'::jsonb),
      line_items          = v_lines,
      sub_total           = case when v_has_lines then v_sub else null end,
      taxable             = case when v_has_lines then (v_perlinetax > 0 or v_taxable) else null end,
      tax_rate            = case when v_has_lines and v_perlinetax = 0 and v_taxable then v_legacyrate else null end,
      tax_amount          = case when v_has_lines then v_taxamt else null end,
      discount_amount     = case when v_has_lines then v_disc else null end,
      invoice_number      = trim(coalesce(payload->>'invoiceNumber','')),
      paid_rm             = greatest(0, coalesce(nullif(payload->>'paidRM','')::numeric, 0)),
      -- preserve prior bulk-pay metadata when not supplied (same as GAS)
      payment_ref         = case when payload ? 'paymentRef' then trim(coalesce(payload->>'paymentRef','')) else coalesce(v_cur.payment_ref,'') end,
      paid_date           = case when payload ? 'paidDate' then nullif(payload->>'paidDate','')::date else v_cur.paid_date end,
      updated_by          = current_email(),
      updated_at          = now()
    where id = v_id;
    perform log_audit('UPDATE Maint', (payload->>'plate') || ' ' || coalesce(payload->>'type','service') || ' RM' || round(v_cost,2));
  else
    insert into lry_maint_logs (
      date, plate, odometer, type, items_replaced, workshop, cost_rm,
      next_service_km, next_service_date, notes,
      receipt_photo_paths, before_photo_paths, after_photo_paths, payment_slip_paths,
      line_items, sub_total, taxable, tax_rate, tax_amount, discount_amount,
      invoice_number, paid_rm, payment_ref, paid_date, created_by, updated_by
    ) values (
      (payload->>'date')::date, payload->>'plate', (payload->>'odometer')::numeric,
      coalesce(nullif(payload->>'type',''),'service'), v_items,
      trim(coalesce(payload->>'workshop','')), v_cost,
      nullif(payload->>'nextServiceKm','')::numeric,
      nullif(payload->>'nextServiceDate','')::date,
      trim(coalesce(payload->>'notes','')),
      coalesce(payload->'receiptPhotoIds','[]'::jsonb),
      coalesce(payload->'beforePhotoIds','[]'::jsonb),
      coalesce(payload->'afterPhotoIds','[]'::jsonb),
      coalesce(payload->'paymentSlipIds','[]'::jsonb),
      v_lines,
      case when v_has_lines then v_sub else null end,
      case when v_has_lines then (v_perlinetax > 0 or v_taxable) else null end,
      case when v_has_lines and v_perlinetax = 0 and v_taxable then v_legacyrate else null end,
      case when v_has_lines then v_taxamt else null end,
      case when v_has_lines then v_disc else null end,
      trim(coalesce(payload->>'invoiceNumber','')),
      greatest(0, coalesce(nullif(payload->>'paidRM','')::numeric, 0)),
      trim(coalesce(payload->>'paymentRef','')),
      nullif(payload->>'paidDate','')::date,
      current_email(), current_email()
    ) returning id into v_id;
    perform log_audit('CREATE Maint', (payload->>'plate') || ' ' || coalesce(payload->>'type','service') || ' RM' || round(v_cost,2));
  end if;
  return v_id;
end;
$$;

-- ─── 12 · RPC — lry_bulk_mark_paid (one slip clears N bills, mirrors GAS) ─────
-- payload: { entries:[{kind:'compliance'|'maint'|'summon', id}], paymentSlipIds:[path],
--            paymentRef?, paidDate? }
create or replace function lry_bulk_mark_paid(payload jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  e        jsonb;
  v_slips  jsonb;
  v_ref    text;
  v_pd     date;
  v_cnt    int := 0;
  v_total  numeric := 0;
  amt      numeric;
  rc       lry_compliance_logs%rowtype;
  rm_      lry_maint_logs%rowtype;
  rs       lry_summon_logs%rowtype;
  merged   jsonb;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  v_slips := coalesce(payload->'paymentSlipIds','[]'::jsonb);
  if jsonb_array_length(v_slips) = 0 then raise exception 'Attach at least one payment slip.'; end if;
  if jsonb_array_length(coalesce(payload->'entries','[]'::jsonb)) = 0 then
    raise exception 'Select at least one bill to pay.';
  end if;
  v_ref := trim(coalesce(payload->>'paymentRef',''));
  v_pd  := coalesce(nullif(payload->>'paidDate','')::date, (now() at time zone 'Asia/Kuala_Lumpur')::date);

  for e in select * from jsonb_array_elements(payload->'entries') loop
    if coalesce(e->>'id','') = '' then continue; end if;

    if e->>'kind' = 'compliance' then
      select * into rc from lry_compliance_logs where id = (e->>'id')::uuid;
      if not found then continue; end if;
      select coalesce(jsonb_agg(v),'[]'::jsonb) into merged
        from (select distinct value as v from jsonb_array_elements(coalesce(rc.payment_slip_paths,'[]'::jsonb) || v_slips)) s;
      amt := coalesce(rc.amount_rm,0) + coalesce(rc.agency_charges_rm,0);
      update lry_compliance_logs
        set payment_slip_paths = merged,
            payment_ref = coalesce(nullif(v_ref,''), payment_ref, ''),
            paid_date = v_pd,
            updated_by = current_email(), updated_at = now()
        where id = rc.id;

    elsif e->>'kind' = 'maint' then
      select * into rm_ from lry_maint_logs where id = (e->>'id')::uuid;
      if not found then continue; end if;
      select coalesce(jsonb_agg(v),'[]'::jsonb) into merged
        from (select distinct value as v from jsonb_array_elements(coalesce(rm_.payment_slip_paths,'[]'::jsonb) || v_slips)) s;
      amt := greatest(0, coalesce(rm_.cost_rm,0) - coalesce(rm_.paid_rm,0));
      update lry_maint_logs
        set payment_slip_paths = merged,
            paid_rm = coalesce(cost_rm,0),          -- settle the full outstanding
            payment_ref = coalesce(nullif(v_ref,''), payment_ref, ''),
            paid_date = v_pd,
            updated_by = current_email(), updated_at = now()
        where id = rm_.id;

    elsif e->>'kind' = 'summon' then
      select * into rs from lry_summon_logs where id = (e->>'id')::uuid;
      if not found then continue; end if;
      select coalesce(jsonb_agg(v),'[]'::jsonb) into merged
        from (select distinct value as v from jsonb_array_elements(coalesce(rs.payment_proof_paths,'[]'::jsonb) || v_slips)) s;
      -- Discounted amount if the discount deadline hasn't passed
      if coalesce(rs.discount_rm,0) > 0 and rs.discount_deadline is not null and v_pd <= rs.discount_deadline then
        amt := greatest(0, coalesce(rs.fine_rm,0) - coalesce(rs.discount_rm,0));
      else
        amt := coalesce(rs.fine_rm,0);
      end if;
      update lry_summon_logs
        set payment_proof_paths = merged,
            paid_rm = amt,
            status = 'paid',
            payment_ref = coalesce(nullif(v_ref,''), payment_ref, ''),
            paid_date = v_pd,
            updated_by = current_email(), updated_at = now()
        where id = rs.id;
    else
      continue;
    end if;

    v_cnt := v_cnt + 1;
    v_total := v_total + coalesce(amt,0);
  end loop;

  perform log_audit('BULK_PAY',
    coalesce(nullif(v_ref,''),'no-ref') || ' · ' || v_cnt || ' bill(s) · RM ' || round(v_total,2) || ' · ' || v_pd);
  return v_cnt;
end;
$$;

-- ─── 13 · ALARMS VIEW — consumed by the shared daily-alarms Edge Function ─────
-- Columns: alarm_type, ref, detail, due_date, recipient
create or replace view lry_alarms with (security_invoker = true) as
-- Compliance (road tax / insurance / puspakom) expiring within 30 days or expired
select
  'lorry-compliance-' || c.type            as alarm_type,
  c.plate                                  as ref,
  case c.type when 'roadtax' then 'Road Tax' when 'insurance' then 'Insurance' else 'Puspakom' end
    || ' expires ' || to_char(c.expiry_date,'DD Mon YYYY')
    || case when c.expiry_date < (now() at time zone 'Asia/Kuala_Lumpur')::date then ' (EXPIRED)' else '' end as detail,
  c.expiry_date                            as due_date,
  coalesce((select value from app_settings where key = 'COMPANY_EMAIL'), '') as recipient
from lry_compliance_logs c
where lower(coalesce(c.status,'active')) in ('', 'active')
  and c.expiry_date is not null
  and c.expiry_date <= (now() at time zone 'Asia/Kuala_Lumpur')::date + 30
union all
-- Proposed service date within 30 days
select
  'lorry-service-due',
  m.plate,
  'Proposed service date ' || to_char(m.next_service_date,'DD Mon YYYY') || ' (' || coalesce(m.workshop,'') || ')',
  m.next_service_date,
  coalesce((select value from app_settings where key = 'COMPANY_EMAIL'), '')
from lry_maint_logs m
where m.next_service_date is not null
  and m.next_service_date <= (now() at time zone 'Asia/Kuala_Lumpur')::date + 30
union all
-- Driver licence / GDL expiring within 30 days (active drivers)
select
  'lorry-driver-licence',
  d.name,
  'Licence' || case when d.license_class <> '' then ' (' || d.license_class || ')' else '' end
    || ' expires ' || to_char(d.license_expiry_date,'DD Mon YYYY'),
  d.license_expiry_date,
  coalesce((select value from app_settings where key = 'COMPANY_EMAIL'), '')
from lry_drivers d
where d.status in ('active','on-leave')
  and d.license_expiry_date is not null
  and d.license_expiry_date <= (now() at time zone 'Asia/Kuala_Lumpur')::date + 30
union all
select
  'lorry-driver-gdl',
  d.name,
  'GDL expires ' || to_char(d.gdl_expiry_date,'DD Mon YYYY'),
  d.gdl_expiry_date,
  coalesce((select value from app_settings where key = 'COMPANY_EMAIL'), '')
from lry_drivers d
where d.status in ('active','on-leave')
  and d.gdl_expiry_date is not null
  and d.gdl_expiry_date <= (now() at time zone 'Asia/Kuala_Lumpur')::date + 30
union all
-- Outstanding summonses with payment deadline within 14 days or overdue
select
  'lorry-summon-deadline',
  s.plate || ' · ' || s.summon_number,
  'Summon RM ' || round(coalesce(s.fine_rm,0) - coalesce(s.paid_rm,0), 2)
    || ' pay by ' || to_char(s.payment_deadline,'DD Mon YYYY')
    || case when s.payment_deadline < (now() at time zone 'Asia/Kuala_Lumpur')::date then ' (OVERDUE)' else '' end,
  s.payment_deadline,
  coalesce((select value from app_settings where key = 'COMPANY_EMAIL'), '')
from lry_summon_logs s
where s.status in ('outstanding','partially-paid')
  and s.payment_deadline is not null
  and s.payment_deadline <= (now() at time zone 'Asia/Kuala_Lumpur')::date + 14;

-- Done. Frontend: lorry-supabase.html (project root).
