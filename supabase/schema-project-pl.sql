-- ============================================================================
-- HG GROUP — PROJECT REVENUE vs EXPENSES (P&L) v2.0 · Supabase schema
-- Prefix: pl_   ·  App file: project-pl-supabase.html
-- Run AFTER the foundation schema (supabase/schema.sql). Additive + idempotent.
--
-- Converted from apps-script-project-pl (Google Sheets backend):
--   Projects / JobScopes / Materials / Client-Subcon-Supplier Payments /
--   SubconCharges (lump-sum) / DailyReports / Manpower / ProjectPhotos /
--   CreditNotes / master lists / Lookups / UserRoles (RBAC) / AuditLog.
-- Reuses foundation objects: allowed_users, is_allowed(), is_admin(),
-- current_email(), log_audit(), audit_log, and the shared clients table.
-- ============================================================================

-- ─── 0 · EXTEND THE SHARED clients TABLE (never redefine it) ────────────────
alter table clients add column if not exists contact_person text default '';
alter table clients add column if not exists contact_number text default '';
alter table clients add column if not exists address        text default '';
alter table clients add column if not exists updated_at     timestamptz;
alter table clients add column if not exists updated_by     text default '';

-- ─── 1 · RBAC — pl_user_roles (email → Admin / Manager / Editor / Viewer) ───
create table if not exists pl_user_roles (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  role       text not null check (role in ('Admin','Manager','Editor','Viewer')),
  notes      text default '',
  created_at timestamptz default now(),
  created_by text default '',
  updated_at timestamptz,
  updated_by text default ''
);

-- Bootstrap admins (same idea as BOOTSTRAP_ADMINS in Code.gs)
insert into pl_user_roles (email, role, notes) values
  ('lee@hggroup.com.my',       'Admin', 'bootstrap admin'),
  ('marketing@hggroup.com.my', 'Admin', 'bootstrap admin · Finance UI/UX administration'),
  ('znerationmedia@gmail.com', 'Admin', 'bootstrap admin')
on conflict (email) do nothing;

-- Role of the signed-in user. Foundation admins (allowed_users.is_admin) are
-- ALWAYS Admin — mirrors the hard-coded bootstrap-admin rule in the GAS app.
create or replace function pl_role() returns text
language sql stable security definer set search_path = public as $$
  select case
    when is_admin() then 'Admin'
    else coalesce(
      (select role from pl_user_roles
        where lower(email) = lower(current_email()) limit 1),
      'Viewer')
  end;
$$;

-- Exposed to the app so it can gate the UI.
create or replace function pl_my_role() returns text
language sql stable security definer set search_path = public as $$
  select pl_role();
$$;

create or replace function pl_role_in(roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select is_allowed() and pl_role() = any(roles);
$$;

-- ─── 2 · MASTER LISTS ───────────────────────────────────────────────────────
create table if not exists pl_buildings (
  id uuid primary key default gen_random_uuid(),
  name text not null, address text default '', notes text default '',
  created_at timestamptz default now(), created_by text default '',
  updated_at timestamptz, updated_by text default ''
);
create table if not exists pl_subcons (
  id uuid primary key default gen_random_uuid(),
  name text not null, trade text default '', contact_person text default '',
  contact_number text default '', notes text default '',
  created_at timestamptz default now(), created_by text default '',
  updated_at timestamptz, updated_by text default ''
);
create table if not exists pl_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null, category text default '', contact_person text default '',
  contact_number text default '', address text default '', notes text default '',
  created_at timestamptz default now(), created_by text default '',
  updated_at timestamptz, updated_by text default ''
);
create table if not exists pl_material_items (
  id uuid primary key default gen_random_uuid(),
  name text not null, default_unit text default '', notes text default '',
  created_at timestamptz default now(), created_by text default '',
  updated_at timestamptz, updated_by text default ''
);
create table if not exists pl_divisions (
  id uuid primary key default gen_random_uuid(),
  name text not null, head text default '', contact_number text default '', notes text default '',
  created_at timestamptz default now(), created_by text default '',
  updated_at timestamptz, updated_by text default ''
);
create table if not exists pl_workers (
  id uuid primary key default gen_random_uuid(),
  name text not null, role text default '', contact_number text default '', notes text default '',
  created_at timestamptz default now(), created_by text default '',
  updated_at timestamptz, updated_by text default ''
);
create table if not exists pl_supervisors (
  id uuid primary key default gen_random_uuid(),
  name text not null, role text default '', contact_number text default '', notes text default '',
  created_at timestamptz default now(), created_by text default '',
  updated_at timestamptz, updated_by text default ''
);
create table if not exists pl_lookups (
  id uuid primary key default gen_random_uuid(),
  type text not null,           -- Category / SubCategory / ProjectStatus / JobStatus /
                                -- ClientPaymentStatus / JobScopeUnit / MaterialUnit
  value text not null,
  sort_order numeric default 0,
  created_at timestamptz default now(), created_by text default '',
  updated_at timestamptz, updated_by text default ''
);

-- ─── 3 · PROJECTS + TRANSACTIONS ────────────────────────────────────────────
create table if not exists pl_projects (
  id uuid primary key default gen_random_uuid(),
  code text default '',
  category text default '', sub_category text default '',
  client_id uuid, client_name text default '',
  building_id uuid, building_name text default '',
  address text default '', lot_number text default '',
  supervisor_ids text default '',      -- pipe-joined uuid list (as in GAS)
  supervisor_name text default '',
  po_number text default '', invoice_number text default '',
  invoice_date date, invoice_amount numeric default 0,
  client_invoice_url text default '',
  discount numeric default 0, adjustment numeric default 0,
  sst_applicable boolean default false, sst_rate numeric default 0,
  parent_project_id uuid references pl_projects(id) on delete set null,
  start_date date, end_date date, duration_days numeric,
  status text default '', notes text default '',
  created_at timestamptz default now(), created_by text default '',
  updated_at timestamptz, updated_by text default ''
);
create index if not exists idx_pl_projects_code on pl_projects (code);

create table if not exists pl_job_scopes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references pl_projects(id) on delete cascade,
  description text default '', qty numeric default 0, unit text default '',
  client_rate numeric default 0, client_amount numeric default 0,
  performed_by text default 'Subcon',        -- Subcon / InHouseTeam / OtherDivision
  subcon_id uuid, subcon_name text default '',
  subcon_rate numeric default 0, subcon_amount numeric default 0,
  division_id uuid, division_name text default '', internal_cost numeric default 0,
  cost_confirmation text default 'Confirmed', -- Confirmed / Estimated / Absorbed / None
  subcon_invoice_number text default '', subcon_invoice_date date,
  subcon_invoice_url text default '',
  completion_report_url text default '', supporting_docs_url text default '',
  job_status text default '', client_payment_status text default '', notes text default '',
  created_at timestamptz default now(), created_by text default '',
  updated_at timestamptz, updated_by text default ''
);
create index if not exists idx_pl_job_scopes_project on pl_job_scopes (project_id);

create table if not exists pl_materials (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references pl_projects(id) on delete cascade,
  job_scope_id uuid references pl_job_scopes(id) on delete cascade,
  item_id uuid, item_name text default '',
  qty numeric default 0, unit text default '',
  unit_cost numeric default 0, total_cost numeric default 0,
  supplier_id uuid, supplier_name text default '', po_number text default '',
  invoice_number text default '', invoice_date date, invoice_url text default '',
  delivery_order_url text default '', material_photos_url text default '', notes text default '',
  material_source text default 'Supplier',   -- Supplier / InHouseSubcon
  charged_to_subcon_id uuid, charged_to_subcon_name text default '',
  created_at timestamptz default now(), created_by text default '',
  updated_at timestamptz, updated_by text default ''
);
create index if not exists idx_pl_materials_project on pl_materials (project_id);

create table if not exists pl_client_payments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references pl_projects(id) on delete cascade,
  payment_date date, amount numeric default 0,
  reference text default '', slip_url text default '', notes text default '',
  created_at timestamptz default now(), created_by text default ''
);
create index if not exists idx_pl_client_payments_project on pl_client_payments (project_id);

create table if not exists pl_subcon_payments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references pl_projects(id) on delete cascade,
  job_scope_id uuid references pl_job_scopes(id) on delete cascade,
  subcon_id uuid, subcon_name text default '',
  payment_date date, amount numeric default 0,
  reference text default '', slip_url text default '', notes text default '',
  created_at timestamptz default now(), created_by text default ''
);
create index if not exists idx_pl_subcon_payments_project on pl_subcon_payments (project_id);

create table if not exists pl_supplier_payments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references pl_projects(id) on delete cascade,
  material_id uuid references pl_materials(id) on delete cascade,
  supplier_id uuid, supplier_name text default '',
  payment_date date, amount numeric default 0,
  reference text default '', slip_url text default '', notes text default '',
  created_at timestamptz default now(), created_by text default ''
);
create index if not exists idx_pl_supplier_payments_project on pl_supplier_payments (project_id);

create table if not exists pl_subcon_charges (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references pl_projects(id) on delete cascade,
  subcon_id uuid, subcon_name text default '',
  lump_amount numeric default 0,
  job_scope_ids text default '',       -- pipe-joined scope-id list (as in GAS)
  invoice_number text default '', invoice_date date, invoice_url text default '',
  completion_report_url text default '', supporting_docs_url text default '', notes text default '',
  created_at timestamptz default now(), created_by text default '',
  updated_at timestamptz, updated_by text default ''
);
create index if not exists idx_pl_subcon_charges_project on pl_subcon_charges (project_id);

create table if not exists pl_daily_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references pl_projects(id) on delete cascade,
  report_date date, title text default '', report_url text default '', notes text default '',
  created_at timestamptz default now(), created_by text default '',
  updated_at timestamptz, updated_by text default ''
);
create index if not exists idx_pl_daily_reports_project on pl_daily_reports (project_id);

create table if not exists pl_manpower (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references pl_projects(id) on delete cascade,
  job_scope_id uuid references pl_job_scopes(id) on delete set null,
  worker_type text default 'inhouse',  -- inhouse / subcon
  worker_id uuid,                      -- pl_workers.id OR pl_subcons.id (per worker_type)
  worker_name text default '',
  work_date date, duration_days numeric default 0, rate numeric default 0,
  total_cost numeric default 0, notes text default '',
  created_at timestamptz default now(), created_by text default '',
  updated_at timestamptz, updated_by text default ''
);
create index if not exists idx_pl_manpower_project on pl_manpower (project_id);

create table if not exists pl_project_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references pl_projects(id) on delete cascade,
  kind text default 'before',          -- before / after
  photo_url text default '', caption text default '', taken_date date,
  created_at timestamptz default now(), created_by text default '',
  updated_at timestamptz, updated_by text default ''
);
create index if not exists idx_pl_project_photos_project on pl_project_photos (project_id);

create table if not exists pl_credit_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references pl_projects(id) on delete cascade,
  type text default 'credit',          -- credit / refund
  credit_note_number text default '', credit_note_date date,
  amount numeric default 0, reason text default '', status text default '',
  bank_name text default '', bank_account_name text default '',
  bank_account_number text default '', refund_paid_date date,
  credit_note_url text default '', notes text default '',
  created_at timestamptz default now(), created_by text default '',
  updated_at timestamptz, updated_by text default ''
);
create index if not exists idx_pl_credit_notes_project on pl_credit_notes (project_id);

-- ─── 4 · APP AUDIT LOG (record-level, drives the in-app audit panels) ───────
create table if not exists pl_audit_log (
  id bigint generated always as identity primary key,
  at timestamptz default now(),
  user_email text default '',
  action text not null,
  record_type text default '',
  record_id text default '',
  details text default ''
);
create index if not exists idx_pl_audit_record on pl_audit_log (record_id);

-- Writes to the app audit log AND mirrors into the shared foundation audit_log.
create or replace function pl_log_audit(p_action text, p_record_type text, p_record_id text, p_details text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  insert into pl_audit_log (user_email, action, record_type, record_id, details)
  values (current_email(), p_action, coalesce(p_record_type,''), coalesce(p_record_id,''),
          left(coalesce(p_details,''), 300));
  perform log_audit('[P&L] ' || p_action || ' ' || coalesce(p_record_type,''),
                    coalesce(p_record_id,'') || ' · ' || coalesce(p_details,''));
end;
$$;

-- ─── 5 · SEQUENTIAL PROJECT CODES — PRJ-YYYYMM-### (+ add-on suffix -A/-B) ──
create or replace function pl_next_project_code(p_parent_code text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_yyyymm text := to_char(now() at time zone 'Asia/Kuala_Lumpur', 'YYYYMM');
  v_next int;
  v_letter text;
begin
  if not pl_role_in(array['Admin','Manager','Editor']) then
    raise exception 'Not authorised to create projects.';
  end if;
  if coalesce(p_parent_code,'') = '' then
    select coalesce(max((substring(code from '^PRJ-' || v_yyyymm || '-(\d+)$'))::int), 0) + 1
      into v_next from pl_projects
      where code ~ ('^PRJ-' || v_yyyymm || '-\d+$');
    return 'PRJ-' || v_yyyymm || '-' || lpad(v_next::text, 3, '0');
  else
    -- add-on job: parent code + next letter (A, B, C, …)
    select coalesce(max(substring(code from length(p_parent_code) + 2 for 1)), '@')
      into v_letter from pl_projects
      where code ~ ('^' || regexp_replace(p_parent_code, '([().\[\]\\+*?^$|{}-])', '\\\1', 'g') || '-[A-Z]$');
    return p_parent_code || '-' || chr(ascii(v_letter) + 1);
  end if;
end;
$$;

-- ─── 6 · SEED LOOKUPS (same defaults as GAS seedLookupsIfEmpty_) ────────────
insert into pl_lookups (type, value, sort_order, created_by)
select * from (values
  ('Category','Hoarding',1,'seed'), ('Category','Visual Print & Install',2,'seed'),
  ('Category','Scaffold',3,'seed'), ('Category','Temporary Storage Rental',4,'seed'),
  ('Category','Reinstatement',5,'seed'), ('Category','Fit-Out',6,'seed'),
  ('Category','In-House Building Maintenance',7,'seed'),
  ('SubCategory','Upgrading',1,'seed'), ('SubCategory','Repair',2,'seed'),
  ('SubCategory','Replacement',3,'seed'), ('SubCategory','New',4,'seed'),
  ('ProjectStatus','Quoted',1,'seed'), ('ProjectStatus','Active',2,'seed'),
  ('ProjectStatus','Completed',3,'seed'), ('ProjectStatus','On Hold',4,'seed'),
  ('ProjectStatus','Cancelled',5,'seed'),
  ('JobStatus','Not Started',1,'seed'), ('JobStatus','In Progress',2,'seed'),
  ('JobStatus','Completed',3,'seed'), ('JobStatus','On Hold',4,'seed'),
  ('JobStatus','Cancelled',5,'seed'),
  ('ClientPaymentStatus','Unbilled',1,'seed'), ('ClientPaymentStatus','Invoiced',2,'seed'),
  ('ClientPaymentStatus','Partially Paid',3,'seed'), ('ClientPaymentStatus','Fully Paid',4,'seed'),
  ('ClientPaymentStatus','Overdue',5,'seed'),
  ('JobScopeUnit','lm',1,'seed'), ('JobScopeUnit','sqm',2,'seed'), ('JobScopeUnit','lot',3,'seed'),
  ('JobScopeUnit','pc',4,'seed'), ('JobScopeUnit','nos',5,'seed'), ('JobScopeUnit','cum',6,'seed'),
  ('JobScopeUnit','set',7,'seed'), ('JobScopeUnit','day',8,'seed'),
  ('MaterialUnit','pcs',1,'seed'), ('MaterialUnit','sqm',2,'seed'), ('MaterialUnit','kg',3,'seed'),
  ('MaterialUnit','m',4,'seed'), ('MaterialUnit','lm',5,'seed'), ('MaterialUnit','box',6,'seed'),
  ('MaterialUnit','roll',7,'seed'), ('MaterialUnit','litre',8,'seed'), ('MaterialUnit','bag',9,'seed')
) as v(type, value, sort_order, created_by)
where not exists (select 1 from pl_lookups limit 1);

-- ─── 7 · ROW-LEVEL SECURITY ─────────────────────────────────────────────────
-- Role model (mirrors ROLE_PERMS in Code.gs):
--   Admin   : everything, incl. user-role management
--   Manager : everything except user-role management
--   Editor  : projects + operations only — NO payments/credit notes (money), no masters
--   Viewer  : read-only on operational data, no money visibility
do $$
declare t text;
begin
  -- Operational tables: allowlisted read; Editor+ write
  foreach t in array array['pl_projects','pl_job_scopes','pl_materials','pl_subcon_charges',
                           'pl_daily_reports','pl_manpower','pl_project_photos'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_sel on %I', t, t);
    execute format('create policy %I_sel on %I for select to authenticated using (is_allowed())', t, t);
    execute format('drop policy if exists %I_ins on %I', t, t);
    execute format('create policy %I_ins on %I for insert to authenticated with check (pl_role_in(array[''Admin'',''Manager'',''Editor'']))', t, t);
    execute format('drop policy if exists %I_upd on %I', t, t);
    execute format('create policy %I_upd on %I for update to authenticated using (pl_role_in(array[''Admin'',''Manager'',''Editor'']))', t, t);
    execute format('drop policy if exists %I_del on %I', t, t);
    execute format('create policy %I_del on %I for delete to authenticated using (pl_role_in(array[''Admin'',''Manager'',''Editor'']))', t, t);
  end loop;

  -- Project delete is Manager+ (DELETE_PROJECT perm)
  drop policy if exists pl_projects_del on pl_projects;
  create policy pl_projects_del on pl_projects for delete to authenticated
    using (pl_role_in(array['Admin','Manager']));

  -- Money tables: fully hidden from Editor/Viewer (VIEW_MONEY + EDIT_PAYMENTS)
  foreach t in array array['pl_client_payments','pl_subcon_payments','pl_supplier_payments','pl_credit_notes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format('create policy %I_rw on %I for all to authenticated using (pl_role_in(array[''Admin'',''Manager''])) with check (pl_role_in(array[''Admin'',''Manager'']))', t, t);
  end loop;

  -- Master lists + lookups: allowlisted read; Manager+ write (MANAGE_MASTER_LISTS)
  foreach t in array array['pl_buildings','pl_subcons','pl_suppliers','pl_material_items',
                           'pl_divisions','pl_workers','pl_supervisors','pl_lookups'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_sel on %I', t, t);
    execute format('create policy %I_sel on %I for select to authenticated using (is_allowed())', t, t);
    execute format('drop policy if exists %I_ins on %I', t, t);
    execute format('create policy %I_ins on %I for insert to authenticated with check (pl_role_in(array[''Admin'',''Manager'']))', t, t);
    execute format('drop policy if exists %I_upd on %I', t, t);
    execute format('create policy %I_upd on %I for update to authenticated using (pl_role_in(array[''Admin'',''Manager'']))', t, t);
    execute format('drop policy if exists %I_del on %I', t, t);
    execute format('create policy %I_del on %I for delete to authenticated using (pl_role_in(array[''Admin'',''Manager'']))', t, t);
  end loop;
end $$;

-- User roles: Admin only (MANAGE_USERS). Own role is read via pl_my_role().
alter table pl_user_roles enable row level security;
drop policy if exists pl_user_roles_rw on pl_user_roles;
create policy pl_user_roles_rw on pl_user_roles for all to authenticated
  using (pl_role_in(array['Admin'])) with check (pl_role_in(array['Admin']));

-- Audit log: readable by Admin/Manager (VIEW_AUDIT); writes only via pl_log_audit()
alter table pl_audit_log enable row level security;
drop policy if exists pl_audit_read on pl_audit_log;
create policy pl_audit_read on pl_audit_log for select to authenticated
  using (pl_role_in(array['Admin','Manager']));

-- ─── 8 · STORAGE — pl-files bucket (replaces the ProjectPL_Photos Drive folder)
insert into storage.buckets (id, name, public) values ('pl-files','pl-files', false)
on conflict (id) do nothing;
drop policy if exists "pl-files_rw" on storage.objects;
create policy "pl-files_rw" on storage.objects for all to authenticated
  using (bucket_id = 'pl-files' and is_allowed())
  with check (bucket_id = 'pl-files' and pl_role_in(array['Admin','Manager','Editor']));

-- Done. Deploy: Supabase → SQL Editor → run this file (after schema.sql).
