-- ============================================================================
-- HG GROUP — WORKERS DOCUMENTATION & WORK PERMITS · Supabase schema (wkr_)
-- Converted from apps-script-workers (Google Apps Script + Sheets).
-- Run AFTER the foundation schema.sql (needs allowed_users, is_allowed(),
-- current_email(), log_audit(), app_settings).
-- Additive + idempotent — safe to re-run.
--
-- Creates:
--   wkr_divisions, wkr_workers, wkr_documents,
--   wkr_work_permits, wkr_permit_workers, wkr_permit_attachments,
--   wkr_permit_forms,
--   wkr_insurance_policies, wkr_insurance_attachments,
--   wkr_insurance_quotes, wkr_insurance_payments,
--   wkr_report_history
--   RPCs: wkr_save_permit(jsonb), wkr_save_insurance(jsonb),
--         wkr_delete_division(uuid)
--   View: wkr_alarms  (read by the shared `daily-alarms` Edge Function + UI)
--   Storage bucket: worker-docs (private)
-- ============================================================================

-- ─── 1 · DIVISIONS ───────────────────────────────────────────────────────────
create table if not exists wkr_divisions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text default '',
  active      boolean default true,
  created_by  text default '',
  created_at  timestamptz default now()
);

-- ─── 2 · WORKERS ─────────────────────────────────────────────────────────────
create table if not exists wkr_workers (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null,
  ic_number       text default '',
  passport_number text default '',
  nationality     text default '',
  division_id     uuid references wkr_divisions(id),
  position        text default '',
  phone           text default '',
  photo_url       text default '',      -- sb://worker-docs/<path> or external URL
  status          text default 'active',  -- active / inactive / resigned
  created_by      text default '',
  created_at      timestamptz default now(),
  updated_by      text default '',
  updated_at      timestamptz default now()
);
create index if not exists idx_wkr_workers_division on wkr_workers (division_id);

-- ─── 3 · DOCUMENTS (per worker; doc_type is the locked 12-key enum in the UI) ─
create table if not exists wkr_documents (
  id                uuid primary key default gen_random_uuid(),
  worker_id         uuid not null references wkr_workers(id) on delete cascade,
  doc_type          text not null,       -- PASSPORT / IC / WORKING_VISA / … / DRIVING_HEAVY
  doc_subtype       text default '',     -- e.g. mall name, competency type, vehicle type
  doc_number        text default '',
  issue_date        date,
  expiry_date       date,
  issuing_authority text default '',
  file_url          text default '',
  notes             text default '',
  created_by        text default '',
  created_at        timestamptz default now(),
  updated_by        text default '',
  updated_at        timestamptz default now()
);
create index if not exists idx_wkr_documents_worker on wkr_documents (worker_id);
create index if not exists idx_wkr_documents_expiry on wkr_documents (expiry_date);

-- ─── 4 · INSURANCE POLICIES (HG's own cover-note library) ────────────────────
create table if not exists wkr_insurance_policies (
  id                uuid primary key default gen_random_uuid(),
  policy_number     text not null,
  provider          text not null,
  coverage_type     text default '',
  coverage_amount   text default '',
  valid_from        date,
  valid_until       date,
  file_url          text default '',
  notes             text default '',
  status            text default 'active',   -- active / expired / cancelled
  invoice_number    text default '',          -- invoice we sent to client
  premium_amount    numeric default 0,        -- cost we pay the insurer (RM)
  charged_to_client numeric default 0,        -- what we bill the client (RM)
  created_by        text default '',
  created_at        timestamptz default now(),
  updated_by        text default '',
  updated_at        timestamptz default now()
);

create table if not exists wkr_insurance_attachments (
  id         uuid primary key default gen_random_uuid(),
  policy_id  uuid not null references wkr_insurance_policies(id) on delete cascade,
  label      text default '',
  file_url   text default '',
  sort_order int default 0
);
create index if not exists idx_wkr_ins_att_policy on wkr_insurance_attachments (policy_id);

create table if not exists wkr_insurance_quotes (
  id         uuid primary key default gen_random_uuid(),
  policy_id  uuid not null references wkr_insurance_policies(id) on delete cascade,
  provider   text default '',
  amount     numeric default 0,
  notes      text default '',
  sort_order int default 0
);
create index if not exists idx_wkr_ins_q_policy on wkr_insurance_quotes (policy_id);

create table if not exists wkr_insurance_payments (
  id           uuid primary key default gen_random_uuid(),
  policy_id    uuid not null references wkr_insurance_policies(id) on delete cascade,
  payment_date date,
  amount       numeric default 0,
  reference    text default '',
  notes        text default '',
  sort_order   int default 0
);
create index if not exists idx_wkr_ins_p_policy on wkr_insurance_payments (policy_id);

-- ─── 5 · WORK PERMITS (issued mall / building permits) ───────────────────────
-- insurance_policy_id has NO cascade — deleting a policy that permits still
-- reference is blocked (same guard as the Apps Script version).
create table if not exists wkr_work_permits (
  id                      uuid primary key default gen_random_uuid(),
  permit_number           text default '',
  title                   text default '',
  mall_name               text default '',
  project_reference       text default '',
  contractor_client       text default '',
  work_scope              text default '',
  work_area               text default '',
  working_hours           text default '',
  applied_by              text default 'own_team',  -- own_team / client / mall
  issued_by               text default '',
  issue_date              date,
  valid_from              date,
  valid_until             date,
  file_url                text default '',           -- the approved permit PDF
  status                  text default 'active',     -- active / cancelled / superseded
  notes                   text default '',
  duration                text default 'ad_hoc',     -- yearly / monthly / ad_hoc
  insurance_source        text default 'none',       -- hg_existing / new / client / none
  insurance_policy_id     uuid references wkr_insurance_policies(id),
  insurance_provider      text default '',
  insurance_policy_number text default '',
  insurance_file_url      text default '',
  insurance_notes         text default '',
  client_invoice_number   text default '',
  created_by              text default '',
  created_at              timestamptz default now(),
  updated_by              text default '',
  updated_at              timestamptz default now()
);
create index if not exists idx_wkr_permits_valid_until on wkr_work_permits (valid_until);

create table if not exists wkr_permit_workers (
  id        uuid primary key default gen_random_uuid(),
  permit_id uuid not null references wkr_work_permits(id) on delete cascade,
  worker_id uuid not null references wkr_workers(id) on delete cascade,
  role      text default ''
);
create index if not exists idx_wkr_pw_permit on wkr_permit_workers (permit_id);
create index if not exists idx_wkr_pw_worker on wkr_permit_workers (worker_id);

create table if not exists wkr_permit_attachments (
  id         uuid primary key default gen_random_uuid(),
  permit_id  uuid not null references wkr_work_permits(id) on delete cascade,
  label      text default '',
  file_url   text default '',
  sort_order int default 0
);
create index if not exists idx_wkr_pa_permit on wkr_permit_attachments (permit_id);

-- ─── 6 · FORM LIBRARY (blank permit forms per mall) ──────────────────────────
create table if not exists wkr_permit_forms (
  id                 uuid primary key default gen_random_uuid(),
  mall_name          text not null,
  form_name          text not null,
  form_type          text default '',
  version            text default '',
  file_url           text default '',
  contact_info       text default '',
  lead_time          text default '',
  requirements       text default '',
  notes              text default '',
  last_verified_date date,
  created_by         text default '',
  created_at         timestamptz default now(),
  updated_by         text default '',
  updated_at         timestamptz default now()
);

-- ─── 7 · REPORT HISTORY (compliance-report wizard runs) ─────────────────────
create table if not exists wkr_report_history (
  id             uuid primary key default gen_random_uuid(),
  generated_at   timestamptz default now(),
  generated_by   text default '',
  format         text default '',     -- checklist / fullpack / combined
  mall_name      text default '',
  project_name   text default '',
  contractor_ref text default '',
  report_date    date,
  division_ids   text default '',     -- CSV, same shape as the GAS version
  worker_ids     text default '',
  doc_types      text default '',
  worker_count   int default 0,
  doc_type_count int default 0
);

-- ─── 8 · SETTINGS (was the Config sheet) ─────────────────────────────────────
insert into app_settings (key, value) values
  ('WKR_EXPIRING_SOON_DAYS', '30'),
  ('WKR_EXPIRING_WARN_DAYS', '90')
on conflict (key) do nothing;

-- ─── 9 · ROW-LEVEL SECURITY ──────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'wkr_divisions','wkr_workers','wkr_documents',
    'wkr_work_permits','wkr_permit_workers','wkr_permit_attachments',
    'wkr_permit_forms',
    'wkr_insurance_policies','wkr_insurance_attachments',
    'wkr_insurance_quotes','wkr_insurance_payments',
    'wkr_report_history'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format('create policy %I_rw on %I for all to authenticated using (is_allowed()) with check (is_allowed())', t, t);
  end loop;
end $$;

-- ─── 10 · STORAGE BUCKET (replaces Google Drive uploads) ─────────────────────
insert into storage.buckets (id, name, public) values ('worker-docs','worker-docs', false)
on conflict (id) do nothing;
drop policy if exists "worker-docs_rw" on storage.objects;
create policy "worker-docs_rw" on storage.objects for all to authenticated
  using (bucket_id = 'worker-docs' and is_allowed())
  with check (bucket_id = 'worker-docs' and is_allowed());

-- ─── 11 · RPC: save work permit (atomic multi-row save) ──────────────────────
-- Upserts the permit, then REPLACES its worker links + attachments from the
-- payload (payload is the source of truth — same behaviour as the GAS server).
-- payload: { id?, permitNumber, title, mallName, projectReference,
--            contractorClient, workScope, workArea, workingHours, appliedBy,
--            issuedBy, issueDate, validFrom, validUntil, fileUrl, status,
--            notes, duration, insuranceSource, insurancePolicyId,
--            insuranceProvider, insurancePolicyNumber, insuranceFileUrl,
--            insuranceNotes, clientInvoiceNumber,
--            workerIds: [uuid], attachments: [{label, fileUrl}] }
create or replace function wkr_save_permit(payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id      uuid;
  v_editing boolean := false;
  v_polid   uuid;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  if coalesce(payload->>'mallName','') = '' and coalesce(payload->>'permitNumber','') = ''
     and coalesce(payload->>'title','') = '' then
    raise exception 'At minimum the permit needs a mall, permit number, or title.';
  end if;

  v_id := coalesce(nullif(payload->>'id','')::uuid, gen_random_uuid());
  v_editing := exists (select 1 from wkr_work_permits where id = v_id);
  v_polid := nullif(payload->>'insurancePolicyId','')::uuid;
  -- only keep the linked policy when source really is the HG library
  if coalesce(payload->>'insuranceSource','none') <> 'hg_existing' then v_polid := null; end if;

  insert into wkr_work_permits as p (
    id, permit_number, title, mall_name, project_reference, contractor_client,
    work_scope, work_area, working_hours, applied_by, issued_by,
    issue_date, valid_from, valid_until, file_url, status, notes, duration,
    insurance_source, insurance_policy_id, insurance_provider,
    insurance_policy_number, insurance_file_url, insurance_notes,
    client_invoice_number, created_by, updated_by, updated_at)
  values (
    v_id,
    coalesce(payload->>'permitNumber',''),
    coalesce(payload->>'title',''),
    coalesce(payload->>'mallName',''),
    coalesce(payload->>'projectReference',''),
    coalesce(payload->>'contractorClient',''),
    coalesce(payload->>'workScope',''),
    coalesce(payload->>'workArea',''),
    coalesce(payload->>'workingHours',''),
    coalesce(nullif(payload->>'appliedBy',''),'own_team'),
    coalesce(payload->>'issuedBy',''),
    nullif(payload->>'issueDate','')::date,
    nullif(payload->>'validFrom','')::date,
    nullif(payload->>'validUntil','')::date,
    coalesce(payload->>'fileUrl',''),
    coalesce(nullif(payload->>'status',''),'active'),
    coalesce(payload->>'notes',''),
    coalesce(nullif(payload->>'duration',''),'ad_hoc'),
    coalesce(nullif(payload->>'insuranceSource',''),'none'),
    v_polid,
    coalesce(payload->>'insuranceProvider',''),
    coalesce(payload->>'insurancePolicyNumber',''),
    coalesce(payload->>'insuranceFileUrl',''),
    coalesce(payload->>'insuranceNotes',''),
    coalesce(payload->>'clientInvoiceNumber',''),
    current_email(), current_email(), now())
  on conflict (id) do update set
    permit_number           = excluded.permit_number,
    title                   = excluded.title,
    mall_name               = excluded.mall_name,
    project_reference       = excluded.project_reference,
    contractor_client       = excluded.contractor_client,
    work_scope              = excluded.work_scope,
    work_area               = excluded.work_area,
    working_hours           = excluded.working_hours,
    applied_by              = excluded.applied_by,
    issued_by               = excluded.issued_by,
    issue_date              = excluded.issue_date,
    valid_from              = excluded.valid_from,
    valid_until             = excluded.valid_until,
    file_url                = excluded.file_url,
    status                  = excluded.status,
    notes                   = excluded.notes,
    duration                = excluded.duration,
    insurance_source        = excluded.insurance_source,
    insurance_policy_id     = excluded.insurance_policy_id,
    insurance_provider      = excluded.insurance_provider,
    insurance_policy_number = excluded.insurance_policy_number,
    insurance_file_url      = excluded.insurance_file_url,
    insurance_notes         = excluded.insurance_notes,
    client_invoice_number   = excluded.client_invoice_number,
    updated_by              = current_email(),
    updated_at              = now();

  -- Replace worker join rows (dedup the incoming list)
  if payload ? 'workerIds' then
    delete from wkr_permit_workers where permit_id = v_id;
    insert into wkr_permit_workers (permit_id, worker_id)
    select v_id, wid::uuid
    from (select distinct jsonb_array_elements_text(payload->'workerIds') as wid) x
    where coalesce(wid,'') <> '';
  end if;

  -- Replace attachments (keep incoming order as sort_order; drop empty rows)
  if payload ? 'attachments' then
    delete from wkr_permit_attachments where permit_id = v_id;
    insert into wkr_permit_attachments (permit_id, label, file_url, sort_order)
    select v_id,
           coalesce(a->>'label',''),
           coalesce(a->>'fileUrl',''),
           (ord - 1)::int
    from jsonb_array_elements(payload->'attachments') with ordinality as t(a, ord)
    where coalesce(a->>'label','') <> '' or coalesce(a->>'fileUrl','') <> '';
  end if;

  perform log_audit(
    case when v_editing then 'wkr.permit.update' else 'wkr.permit.create' end,
    coalesce(nullif(payload->>'permitNumber',''), nullif(payload->>'title',''), payload->>'mallName'));
  return v_id;
end;
$$;

-- ─── 12 · RPC: save insurance policy (atomic multi-row save) ─────────────────
-- payload: { id?, policyNumber, provider, coverageType, coverageAmount,
--            validFrom, validUntil, fileUrl, notes, status, invoiceNumber,
--            premiumAmount, chargedToClient,
--            attachments: [{label, fileUrl}],
--            quotes: [{provider, amount, notes}],
--            payments: [{paymentDate, amount, reference, notes}] }
create or replace function wkr_save_insurance(payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id      uuid;
  v_editing boolean := false;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  if coalesce(payload->>'policyNumber','') = '' then raise exception 'Policy / cover note number required.'; end if;
  if coalesce(payload->>'provider','')     = '' then raise exception 'Insurance provider required.'; end if;

  v_id := coalesce(nullif(payload->>'id','')::uuid, gen_random_uuid());
  v_editing := exists (select 1 from wkr_insurance_policies where id = v_id);

  insert into wkr_insurance_policies as p (
    id, policy_number, provider, coverage_type, coverage_amount,
    valid_from, valid_until, file_url, notes, status,
    invoice_number, premium_amount, charged_to_client,
    created_by, updated_by, updated_at)
  values (
    v_id,
    trim(payload->>'policyNumber'),
    trim(payload->>'provider'),
    coalesce(payload->>'coverageType',''),
    coalesce(payload->>'coverageAmount',''),
    nullif(payload->>'validFrom','')::date,
    nullif(payload->>'validUntil','')::date,
    coalesce(payload->>'fileUrl',''),
    coalesce(payload->>'notes',''),
    coalesce(nullif(payload->>'status',''),'active'),
    coalesce(payload->>'invoiceNumber',''),
    coalesce(nullif(payload->>'premiumAmount','')::numeric, 0),
    coalesce(nullif(payload->>'chargedToClient','')::numeric, 0),
    current_email(), current_email(), now())
  on conflict (id) do update set
    policy_number     = excluded.policy_number,
    provider          = excluded.provider,
    coverage_type     = excluded.coverage_type,
    coverage_amount   = excluded.coverage_amount,
    valid_from        = excluded.valid_from,
    valid_until       = excluded.valid_until,
    file_url          = excluded.file_url,
    notes             = excluded.notes,
    status            = excluded.status,
    invoice_number    = excluded.invoice_number,
    premium_amount    = excluded.premium_amount,
    charged_to_client = excluded.charged_to_client,
    updated_by        = current_email(),
    updated_at        = now();

  if payload ? 'attachments' then
    delete from wkr_insurance_attachments where policy_id = v_id;
    insert into wkr_insurance_attachments (policy_id, label, file_url, sort_order)
    select v_id, coalesce(a->>'label',''), coalesce(a->>'fileUrl',''), (ord - 1)::int
    from jsonb_array_elements(payload->'attachments') with ordinality as t(a, ord)
    where coalesce(a->>'label','') <> '' or coalesce(a->>'fileUrl','') <> '';
  end if;

  if payload ? 'quotes' then
    delete from wkr_insurance_quotes where policy_id = v_id;
    insert into wkr_insurance_quotes (policy_id, provider, amount, notes, sort_order)
    select v_id, coalesce(q->>'provider',''),
           coalesce(nullif(q->>'amount','')::numeric, 0),
           coalesce(q->>'notes',''), (ord - 1)::int
    from jsonb_array_elements(payload->'quotes') with ordinality as t(q, ord)
    where coalesce(q->>'provider','') <> '' or coalesce(nullif(q->>'amount','')::numeric, 0) <> 0;
  end if;

  if payload ? 'payments' then
    delete from wkr_insurance_payments where policy_id = v_id;
    insert into wkr_insurance_payments (policy_id, payment_date, amount, reference, notes, sort_order)
    select v_id, nullif(pm->>'paymentDate','')::date,
           coalesce(nullif(pm->>'amount','')::numeric, 0),
           coalesce(pm->>'reference',''), coalesce(pm->>'notes',''), (ord - 1)::int
    from jsonb_array_elements(payload->'payments') with ordinality as t(pm, ord)
    where coalesce(nullif(pm->>'amount','')::numeric, 0) <> 0 or coalesce(pm->>'paymentDate','') <> '';
  end if;

  perform log_audit(
    case when v_editing then 'wkr.insurance.update' else 'wkr.insurance.create' end,
    (payload->>'provider') || ' · ' || (payload->>'policyNumber'));
  return v_id;
end;
$$;

-- ─── 13 · RPC: delete division (same guard as the GAS version) ───────────────
-- Blocks the delete if any non-resigned workers are still assigned; detaches
-- resigned workers, then deletes.
create or replace function wkr_delete_division(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  select name into v_name from wkr_divisions where id = p_id;
  if v_name is null then raise exception 'Division not found.'; end if;
  if exists (select 1 from wkr_workers where division_id = p_id and status <> 'resigned') then
    raise exception 'Cannot delete: workers are still assigned to "%". Reassign them first, or mark the division inactive.', v_name;
  end if;
  update wkr_workers set division_id = null where division_id = p_id;
  delete from wkr_divisions where id = p_id;
  perform log_audit('wkr.division.delete', v_name);
end;
$$;

-- ─── 14 · ALARMS VIEW — read by the daily-alarms Edge Function + the UI ──────
-- Same content as the old weekly digest email: worker documents (active
-- workers only) and active work permits that are expired or expiring within
-- WKR_EXPIRING_SOON_DAYS (default 30).
create or replace view wkr_alarms
with (security_invoker = true) as
with soon as (
  select coalesce((select nullif(value,'')::int from app_settings
                   where key = 'WKR_EXPIRING_SOON_DAYS'), 30) as days
)
select 'worker_doc_expiry'::text as alarm_type,
       w.full_name as ref,
       'Worker doc · ' || w.full_name || ' · ' || d.doc_type
         || case when coalesce(d.doc_subtype,'') <> '' then ' · ' || d.doc_subtype else '' end
         || case when coalesce(d.doc_number,'')  <> '' then ' · #' || d.doc_number else '' end as detail,
       d.expiry_date as due_date,
       coalesce((select value from app_settings where key = 'COMPANY_EMAIL'), '') as recipient
from wkr_documents d
join wkr_workers w on w.id = d.worker_id
where w.status = 'active'
  and d.expiry_date is not null
  and d.expiry_date <= (now() at time zone 'Asia/Kuala_Lumpur')::date + (select days from soon)
union all
select 'permit_expiry'::text,
       coalesce(nullif(p.permit_number,''), nullif(p.title,''), p.mall_name),
       'Work permit · ' || coalesce(nullif(p.title,''), '(untitled)')
         || case when coalesce(p.mall_name,'') <> '' then ' · ' || p.mall_name else '' end
         || case when coalesce(p.contractor_client,'') <> '' then ' · ' || p.contractor_client else '' end,
       p.valid_until,
       coalesce((select value from app_settings where key = 'COMPANY_EMAIL'), '')
from wkr_work_permits p
where coalesce(p.status,'active') = 'active'
  and p.valid_until is not null
  and p.valid_until <= (now() at time zone 'Asia/Kuala_Lumpur')::date + (select days from soon);

grant select on wkr_alarms to authenticated;

-- Done. Open workers-supabase.html, connect once, sign in with an allowlisted
-- account. Reminder emails are sent by the shared daily-alarms Edge Function.
