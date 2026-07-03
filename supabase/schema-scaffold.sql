-- ============================================================================
-- HG — SCAFFOLD & GREEN TAG SYSTEM · Supabase schema (slug: scaffold, prefix: scf_)
-- Run AFTER the foundation schema.sql (needs allowed_users / is_allowed() /
-- current_email() / log_audit()). Additive & idempotent — safe to re-run.
--
-- Converted from apps-script-scaffold (Google Sheet tabs → tables):
--   Engagements → scf_engagements     Charges   → scf_charges
--   Materials   → scf_materials       Inspections → scf_inspections
--   Invoices    → scf_invoices        Payments  → scf_payments
--   Personnel   → scf_personnel       Catalogue → scf_catalogue
--   Config      → scf_settings        AuditLog  → shared audit_log ('[scaffold]' details)
--   Drive folders → storage bucket 'scaffold'
--   Daily reminder emails → scf_alarms view (read by the daily-alarms Edge Function)
-- ============================================================================

-- ─── 1 · ENGAGEMENTS (jobs) ─────────────────────────────────────────────────
create table if not exists scf_engagements (
  id                    uuid primary key default gen_random_uuid(),
  job_no                text not null unique,
  service_type          text not null default 'Aluminium',   -- Aluminium / Customized / GreenTag
  scope                 text not null default 'Full',        -- Full / RentalOnly / EndorseOnly
  status                text not null default 'Active',      -- Quote / Active / Extension / OnHold / Completed / Cancelled
  client_company        text not null,
  client_pic            text default '',
  client_contact        text default '',
  client_email          text default '',
  client_address        text default '',
  site_name             text default '',
  site_address          text default '',
  scaffold_desc         text default '',
  third_party           text default '',
  pe_no                 text default '',
  pe_endorsed_by        text default '',
  pe_endorsed_date      date,
  start_date            date,
  expected_end_date     date,
  actual_return_date    date,
  green_tag             text default 'No',                   -- Yes / No
  inspect_interval_days int  default 7,
  assigned_inspector    text default '',
  delivery_sign_name    text default '',
  delivery_sign_date    date,
  delivery_sign_url     text default '',                     -- storage path in bucket 'scaffold'
  return_sign_name      text default '',
  return_sign_date      date,
  return_sign_url       text default '',
  photos_site           text default '',                     -- comma-joined storage paths
  photos_before         text default '',
  photos_after          text default '',
  photos_collection     text default '',
  photos_defect         text default '',
  handled_by            text default '',
  remarks               text default '',
  created_by            text default '',
  created_at            timestamptz default now(),
  updated_by            text default '',
  updated_at            timestamptz default now()
);

-- ─── 2 · CHARGES ────────────────────────────────────────────────────────────
create table if not exists scf_charges (
  id            uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references scf_engagements(id) on delete cascade,
  type          text not null default 'Other',   -- PE/Rental/Install/Transport/Dismantle/GreenTag/ThirdParty/Other
  description   text default '',
  qty           numeric default 1,
  unit          text default '',
  rate          numeric default 0,
  basis         text default '',                 -- Day/Week/Month/Trip/Visit/Lump sum
  amount        numeric default 0,
  invoice_id    uuid,                            -- set when billed (scf_invoices.id)
  created_by    text default '',
  created_at    timestamptz default now()
);
create index if not exists idx_scf_charges_eng on scf_charges (engagement_id);
create index if not exists idx_scf_charges_inv on scf_charges (invoice_id);

-- ─── 3 · MATERIALS (checkout / return) ─────────────────────────────────────
create table if not exists scf_materials (
  id            uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references scf_engagements(id) on delete cascade,
  code          text default '',
  item          text not null,
  spec          text default '',
  category      text default '',
  unit          text default 'pcs',
  qty_out       numeric default 0,
  qty_returned  numeric default 0,
  damage_qty    numeric default 0,
  damage_charge numeric default 0,
  remarks       text default '',
  updated_by    text default '',
  updated_at    timestamptz default now()
);
create index if not exists idx_scf_materials_eng on scf_materials (engagement_id);

-- ─── 4 · INSPECTIONS (green tag) ────────────────────────────────────────────
create table if not exists scf_inspections (
  id                uuid primary key default gen_random_uuid(),
  engagement_id     uuid not null references scf_engagements(id) on delete cascade,
  inspect_date      date not null,
  inspector         text not null,
  inspector_cert_no text default '',
  result            text not null default 'Green',   -- Green / Red / Hold
  tag_no            text default '',
  next_due_date     date,
  findings          text default '',
  photos_url        text default '',                 -- comma-joined storage paths
  cert_url          text default '',                 -- storage path
  created_by        text default '',
  created_at        timestamptz default now()
);
create index if not exists idx_scf_inspections_eng on scf_inspections (engagement_id);

-- ─── 5 · INVOICES & PAYMENTS ────────────────────────────────────────────────
create table if not exists scf_invoices (
  id             uuid primary key default gen_random_uuid(),
  inv_no         text not null unique,
  engagement_id  uuid references scf_engagements(id),
  client_company text not null,
  inv_date       date not null,
  due_date       date,
  description    text default '',
  amount         numeric not null default 0,
  sst_enabled    boolean default true,
  sst_amount     numeric not null default 0,
  total          numeric not null default 0,
  status         text default '',                 -- '' or 'Void'
  file_url       text default '',                 -- storage path (attached PDF)
  notes          text default '',
  created_by     text default '',
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index if not exists idx_scf_invoices_eng on scf_invoices (engagement_id);

create table if not exists scf_payments (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references scf_invoices(id) on delete cascade,
  pay_date    date not null,
  amount      numeric not null default 0,
  method      text default '',
  reference   text default '',
  received_by text default '',
  notes       text default '',
  created_by  text default '',
  created_at  timestamptz default now()
);
create index if not exists idx_scf_payments_inv on scf_payments (invoice_id);

-- ─── 6 · PERSONNEL / CERTS ──────────────────────────────────────────────────
create table if not exists scf_personnel (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  role        text default '',
  cert_type   text not null,     -- WAH / ScaffoldErector / ScaffoldInspector / OSHCoordinator
  cert_no     text default '',
  issued_date date,
  expiry_date date,
  contact     text default '',
  remarks     text default '',
  updated_at  timestamptz default now()
);

-- ─── 7 · CATALOGUE (HG aluminium scaffold material) ─────────────────────────
create table if not exists scf_catalogue (
  id       uuid primary key default gen_random_uuid(),
  code     text default '',
  item     text not null,
  spec     text default '',
  category text default '',
  unit     text default 'pcs',
  sort     int default 0
);

-- seed — codes + specs from the hardcopy delivery/return form (same as GAS seedCatalogue_)
insert into scf_catalogue (code, item, spec, category, unit, sort)
select * from (values
  ('AFS05/AFD05',    '5 Rung Frame',     '0.75m x 2.5m / 1.35m x 2.5m', 'Aluminium mobile', 'pcs', 1),
  ('AFS04/AFD04',    '4 Rung Frame',     '0.75m x 2m / 1.35m x 2m',     'Aluminium mobile', 'pcs', 2),
  ('AFS03/AFD03',    '3 Rung Frame',     '0.75m x 1.5m / 1.35m x 1.5m', 'Aluminium mobile', 'pcs', 3),
  ('AFS02/AFD02',    'Guardrail',        '0.75m x 1m / 1.35m x 1m',     'Aluminium mobile', 'pcs', 4),
  ('AHB01/AHB02',    'Horizontal Brace', '1.8m / 2.4m',                 'Aluminium mobile', 'pcs', 5),
  ('ADB01/ADB02',    'Diagonal Brace',   '2.4m / 3m',                   'Aluminium mobile', 'pcs', 6),
  ('DP01/DP02/DP03', 'Door Platform',    '1.8m / 1.9m / 2.4m',          'Aluminium mobile', 'pcs', 7),
  ('P01/P02/P03',    'Platform',         '1.8m / 1.9m / 2.4m',          'Aluminium mobile', 'pcs', 8),
  ('S01',            'Stabilizer',       '3.5m',                        'Aluminium mobile', 'pcs', 9),
  ('TB01',           'Toe Board',        '—',                           'Aluminium mobile', 'pcs', 10),
  ('L01',            'Ladder',           '2.4m',                        'Aluminium mobile', 'pcs', 11),
  ('LH01',           'Ladder Handrail',  '2.15m',                       'Aluminium mobile', 'pcs', 12),
  ('CW01',           '8" Castor Wheel',  '—',                           'Aluminium mobile', 'pcs', 13)
) as v(code, item, spec, category, unit, sort)
where not exists (select 1 from scf_catalogue limit 1);

-- ─── 8 · SETTINGS (was Config sheet — same keys as GAS DEFAULTS) ────────────
create table if not exists scf_settings (
  key   text primary key,
  value text default ''
);
insert into scf_settings (key, value) values
  ('GREENTAG_INTERVAL_DAYS',   '7'),
  ('GREENTAG_DUE_SOON_DAYS',   '2'),
  ('COLLECTION_DUE_SOON_DAYS', '7'),
  ('CERT_EXPIRY_WARN_DAYS',    '45'),
  ('INVOICE_DUE_SOON_DAYS',    '5'),
  ('SST_RATE_PCT',             '6'),
  ('REMINDER_TO',              ''),
  ('COMPANY_NAME',             'HG Services (M) Sdn Bhd'),
  ('COMPANY_REG',              '958510-M · CIDB 0120170412-WP1187072 (G7)'),
  ('COMPANY_ADDRESS',          'Lot 12 & 13, Jalan BK 1/11, Taman Perindustrian Bandar Kinrara, Bandar Kinrara 1, 47180 Puchong, Selangor'),
  ('COMPANY_PHONE',            '03-8082 3388 / 012-6273 3524'),
  ('SST_NO',                   ''),
  ('INVOICE_PREFIX',           'HG-INV'),
  ('INVOICE_TERMS_DAYS',       '30'),
  ('JOB_PREFIX',               'JOB-')
on conflict (key) do nothing;

-- ─── 9 · SEQUENTIAL NUMBERS (was nextSeq_ on the Config sheet) ──────────────
-- Format matches GAS: PREFIX + 4-digit sequence, skipping any manually typed
-- numbers already in use (e.g. JOB-0001, HG-INV0007).
create or replace function scf_next_job_no() returns text
language plpgsql security definer set search_path = public as $$
declare v_prefix text; v_next int;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  select coalesce(nullif(value,''),'JOB-') into v_prefix from scf_settings where key='JOB_PREFIX';
  v_prefix := coalesce(v_prefix,'JOB-');
  select coalesce(max((substring(job_no from length(v_prefix)+1))::int), 0) + 1
    into v_next from scf_engagements
   where job_no like v_prefix || '%'
     and substring(job_no from length(v_prefix)+1) ~ '^[0-9]+$';
  return v_prefix || lpad(v_next::text, 4, '0');
end;
$$;

create or replace function scf_next_invoice_no() returns text
language plpgsql security definer set search_path = public as $$
declare v_prefix text; v_next int;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  select coalesce(nullif(value,''),'HG-INV') into v_prefix from scf_settings where key='INVOICE_PREFIX';
  v_prefix := coalesce(v_prefix,'HG-INV');
  select coalesce(max((substring(inv_no from length(v_prefix)+1))::int), 0) + 1
    into v_next from scf_invoices
   where inv_no like v_prefix || '%'
     and substring(inv_no from length(v_prefix)+1) ~ '^[0-9]+$';
  return v_prefix || lpad(v_next::text, 4, '0');
end;
$$;

-- ─── 10 · INVOICE FROM CHARGES RPC (was invoiceFromCharges — server recompute)
-- payload: { engagementId, sstEnabled (default true), invNo?, invDate?, dueDate? }
-- Collects every uninvoiced charge on the job, recomputes totals server-side,
-- creates the invoice atomically and stamps the charges with the invoice id.
create or replace function scf_invoice_from_charges(payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_eng     scf_engagements%rowtype;
  v_amount  numeric := 0;
  v_sst_on  boolean := coalesce((payload->>'sstEnabled')::boolean, true);
  v_rate    numeric;
  v_sst     numeric; v_total numeric;
  v_invdate date; v_duedate date; v_terms int;
  v_invno   text; v_desc text; v_cnt int;
  v_id      uuid;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;

  select * into v_eng from scf_engagements where id = (payload->>'engagementId')::uuid;
  if v_eng.id is null then raise exception 'Job not found.'; end if;

  select coalesce(sum(amount),0), count(*) into v_amount, v_cnt
    from scf_charges where engagement_id = v_eng.id and invoice_id is null;
  if v_cnt = 0 then raise exception 'No uninvoiced charges on this job.'; end if;
  v_amount := round(v_amount, 2);

  select coalesce(nullif(value,'')::numeric, 6) into v_rate from scf_settings where key='SST_RATE_PCT';
  v_rate  := coalesce(v_rate, 6) / 100;
  v_sst   := case when v_sst_on then round(v_amount * v_rate, 2) else 0 end;
  v_total := round(v_amount + v_sst, 2);

  v_invdate := coalesce(nullif(payload->>'invDate','')::date, (now() at time zone 'Asia/Kuala_Lumpur')::date);
  select coalesce(nullif(value,'')::int, 30) into v_terms from scf_settings where key='INVOICE_TERMS_DAYS';
  v_duedate := coalesce(nullif(payload->>'dueDate','')::date, v_invdate + coalesce(v_terms,30));

  select string_agg(
           case c.type
             when 'PE' then 'PE calculation & endorsement' when 'Rental' then 'Scaffold rental'
             when 'Install' then 'Scaffold installation'    when 'Transport' then 'Lorry transport (delivery/pickup)'
             when 'Dismantle' then 'Scaffold dismantling'   when 'GreenTag' then 'Green tag endorsement'
             when 'ThirdParty' then '3rd-party supplier'    else coalesce(c.type,'Other') end
           || case when coalesce(c.description,'') <> '' then ' (' || c.description || ')' else '' end
           || ' — RM ' || to_char(c.amount, 'FM999G999G990.00'),
           e'\n' order by c.created_at)
    into v_desc
    from scf_charges c where c.engagement_id = v_eng.id and c.invoice_id is null;

  v_invno := coalesce(nullif(payload->>'invNo',''), scf_next_invoice_no());
  if exists (select 1 from scf_invoices where lower(inv_no) = lower(v_invno)) then
    raise exception 'Invoice number % already exists.', v_invno;
  end if;

  insert into scf_invoices (inv_no, engagement_id, client_company, inv_date, due_date,
                            description, amount, sst_enabled, sst_amount, total, status, notes, created_by)
  values (v_invno, v_eng.id, v_eng.client_company, v_invdate, v_duedate,
          coalesce(v_desc,''), v_amount, v_sst_on, v_sst, v_total, '',
          'From ' || v_cnt || ' charge line(s) · Job ' || v_eng.job_no, current_email())
  returning id into v_id;

  update scf_charges set invoice_id = v_id where engagement_id = v_eng.id and invoice_id is null;

  perform log_audit('SCF CREATE Invoice',
    '[scaffold] ' || v_invno || ' · ' || v_eng.client_company || ' · Job ' || v_eng.job_no || ' · RM' || v_total);
  return v_id;
end;
$$;

-- ─── 11 · ALARMS VIEW (read by the shared daily-alarms Edge Function) ───────
-- Same reminders the GAS runDailyReminders() emailed:
--   green tag due/overdue · scaffold collection due · overdue/due-soon invoices
--   · personnel cert expiry. Columns per the conversion guide §6.2.
create or replace view scf_alarms with (security_invoker = on) as
with cfg as (
  select
    coalesce((select nullif(value,'')::int from scf_settings where key='GREENTAG_DUE_SOON_DAYS'),   2)  as gt_soon,
    coalesce((select nullif(value,'')::int from scf_settings where key='COLLECTION_DUE_SOON_DAYS'), 7)  as col_soon,
    coalesce((select nullif(value,'')::int from scf_settings where key='INVOICE_DUE_SOON_DAYS'),    5)  as inv_soon,
    coalesce((select nullif(value,'')::int from scf_settings where key='CERT_EXPIRY_WARN_DAYS'),    45) as cert_warn,
    coalesce((select nullif(value,'')      from scf_settings where key='REMINDER_TO'), '')             as reminder_to,
    (now() at time zone 'Asia/Kuala_Lumpur')::date as today
),
eng as (
  select e.*,
    coalesce((select sum(greatest(m.qty_out - m.qty_returned, 0))
                from scf_materials m where m.engagement_id = e.id), 0) as material_out,
    (select max(i.inspect_date) from scf_inspections i where i.engagement_id = e.id) as last_inspection
  from scf_engagements e
  where e.status in ('Active','Extension')
)
-- green tag inspections due / overdue
select
  'greentag'::text as alarm_type,
  e.job_no as ref,
  'Green tag ' || case when d.due_date < c.today then 'OVERDUE ' || (c.today - d.due_date) || 'd'
                       when d.due_date = c.today then 'DUE TODAY'
                       else 'due in ' || (d.due_date - c.today) || 'd' end
    || ' · ' || e.client_company || coalesce(' · ' || nullif(e.site_name,''), '')
    || ' · last inspection: ' || coalesce(e.last_inspection::text, 'none yet')
    || coalesce(' · inspector: ' || nullif(e.assigned_inspector,''), '') as detail,
  d.due_date,
  case when coalesce(nullif(c.reminder_to,''),'') <> '' then c.reminder_to
       when e.handled_by ~ '^\S+@\S+\.\S+$' then e.handled_by else '' end as recipient
from eng e cross join cfg c
cross join lateral (select coalesce(e.last_inspection, e.start_date, c.today)
                           + coalesce(e.inspect_interval_days, 7)
                           * (case when e.last_inspection is null and e.start_date is null then 0 else 1 end) as due_date) d
where (e.green_tag = 'Yes' or e.service_type = 'GreenTag')
  and (d.due_date - c.today) <= c.gt_soon

union all
-- collection of deployed scaffold material vs rental return date
select
  'collection',
  e.job_no,
  'Collect back ' || case when e.expected_end_date < c.today then 'OVERDUE ' || (c.today - e.expected_end_date) || 'd'
                          when e.expected_end_date = c.today then 'TODAY'
                          else 'in ' || (e.expected_end_date - c.today) || 'd' end
    || ' · ' || e.client_company || coalesce(' · ' || nullif(e.site_name,''), '')
    || ' · ' || e.material_out || ' item(s) onsite'
    || ' · return date ' || e.expected_end_date,
  e.expected_end_date,
  case when coalesce(nullif(c.reminder_to,''),'') <> '' then c.reminder_to
       when e.handled_by ~ '^\S+@\S+\.\S+$' then e.handled_by else '' end
from eng e cross join cfg c
where e.material_out > 0
  and e.expected_end_date is not null
  and (e.expected_end_date - c.today) <= c.col_soon

union all
-- invoices overdue / due soon (unpaid balance)
select
  'invoice',
  i.inv_no,
  'Invoice ' || case when i.due_date < c.today then 'OVERDUE ' || (c.today - i.due_date) || 'd'
                     when i.due_date = c.today then 'DUE TODAY'
                     else 'due in ' || (i.due_date - c.today) || 'd' end
    || ' · ' || i.client_company
    || ' · balance RM ' || to_char(round(i.total - coalesce(p.paid,0), 2), 'FM999G999G990.00'),
  i.due_date,
  c.reminder_to
from scf_invoices i cross join cfg c
left join lateral (select sum(amount) as paid from scf_payments where invoice_id = i.id) p on true
where coalesce(i.status,'') <> 'Void'
  and i.due_date is not null
  and (i.total - coalesce(p.paid,0)) > 0.005
  and (i.due_date - c.today) <= c.inv_soon

union all
-- personnel certification expiry
select
  'cert',
  p.name,
  p.cert_type || coalesce(' ' || nullif(p.cert_no,''), '')
    || case when p.expiry_date < c.today then ' EXPIRED ' || (c.today - p.expiry_date) || 'd ago'
            else ' expires in ' || (p.expiry_date - c.today) || 'd' end
    || ' (' || p.expiry_date || ') — renew before assigning green tag work',
  p.expiry_date,
  c.reminder_to
from scf_personnel p cross join cfg c
where p.expiry_date is not null
  and (p.expiry_date - c.today) <= c.cert_warn;

-- ─── 12 · STORAGE (replaces Drive "HG — Scaffold & Green Tag" folder) ───────
insert into storage.buckets (id, name, public) values ('scaffold','scaffold', false)
on conflict (id) do nothing;
drop policy if exists "scaffold_rw" on storage.objects;
create policy "scaffold_rw" on storage.objects for all to authenticated
  using (bucket_id = 'scaffold' and is_allowed())
  with check (bucket_id = 'scaffold' and is_allowed());

-- ─── 13 · ROW-LEVEL SECURITY — allowlist-gated everything ───────────────────
do $$
declare t text;
begin
  foreach t in array array['scf_engagements','scf_charges','scf_materials','scf_inspections',
                           'scf_invoices','scf_payments','scf_personnel','scf_catalogue','scf_settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format('create policy %I_rw on %I for all to authenticated using (is_allowed()) with check (is_allowed())', t, t);
  end loop;
end $$;

-- Done. Open scaffold-supabase.html, connect, sign in.
