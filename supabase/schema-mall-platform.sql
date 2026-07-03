-- ============================================================================
-- HG MALL PLATFORM — Supabase schema (prefix mp_)
-- Run AFTER the foundation schema (supabase/schema.sql).
-- Additive + idempotent: safe to re-run. Uses foundation helpers:
--   is_allowed(), is_admin(), current_email(), log_audit(), allowed_users, audit_log
--
-- Converted from mall-platform/Code.gs:
--   Door 1  Site Drawing Vault  (Drive → storage bucket 'mall-sketches',
--           auto-versioning v1, v2, v3… per Mall+Lot preserved via mp_next_version)
--   Door 2  Requirement Lookup + Panel rate book (all reference tables)
--   Door 3  HIRARC / MOS generator (SWMS templates)
--   Door 4  Measurement Request tracker
-- ============================================================================

-- ─── 1 · TABLES ──────────────────────────────────────────────────────────────

-- Malls master (app-local; the GAS app had its own Malls sheet)
create table if not exists mp_malls (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  code       text default '',
  location   text default '',
  notes      text default '',
  added_by   text default '',
  created_at timestamptz default now()
);

-- Door 1 — the Sketches log (was the 'Sketches' sheet + Drive files)
create table if not exists mp_sketches (
  id           uuid primary key default gen_random_uuid(),
  mall         text not null,
  code         text default '',
  lot_no       text not null,
  shop_type    text default '',
  version      int not null default 1,
  file_name    text not null,
  storage_path text not null,          -- path inside the 'mall-sketches' bucket
  mime_type    text default '',
  remarks      text default '',
  uploaded_by  text default '',
  created_at   timestamptz default now()
);
create index if not exists idx_mp_sketches_mall_lot on mp_sketches (mall, lot_no);

create table if not exists mp_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null, sort int default 0, created_at timestamptz default now()
);

create table if not exists mp_requirements (
  id          uuid primary key default gen_random_uuid(),
  mall        text not null,
  category    text default '',
  requirement text default '',
  type        text default '',
  value       text default '',
  shop_type   text default '',
  notes       text default '',
  sort        int default 0,
  updated_by  text default '',
  updated_at  timestamptz default now(),
  created_at  timestamptz default now()
);
create index if not exists idx_mp_requirements_mall on mp_requirements (mall);

create table if not exists mp_requirement_types (
  id uuid primary key default gen_random_uuid(),
  category text default '', name text not null, sort int default 0,
  created_at timestamptz default now()
);

-- the Hoarding / Visual "Type" dropdown options (was the 'Types' sheet)
create table if not exists mp_types (
  id uuid primary key default gen_random_uuid(),
  category text default '', name text not null, sort int default 0,
  created_at timestamptz default now()
);

create table if not exists mp_job_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null, sort int default 0, created_at timestamptz default now()
);

create table if not exists mp_panels (
  id uuid primary key default gen_random_uuid(),
  name text not null, pic text default '', phone text default '',
  email text default '', notes text default '',
  updated_by text default '', updated_at timestamptz default now(),
  created_at timestamptz default now()
);

create table if not exists mp_panel_rates (
  id uuid primary key default gen_random_uuid(),
  panel text not null, job_category text default '', mall text default '',
  rate_basis text default '', price_from numeric, price_to numeric,
  lot_size_ref text default '', engaged_on text default '', notes text default '',
  updated_by text default '', updated_at timestamptz default now(),
  created_at timestamptz default now()
);
create index if not exists idx_mp_panel_rates_mall on mp_panel_rates (mall);

create table if not exists mp_shop_types (
  id uuid primary key default gen_random_uuid(),
  name text not null, sort int default 0, created_at timestamptz default now()
);

create table if not exists mp_rate_basis (
  id uuid primary key default gen_random_uuid(),
  name text not null, sort int default 0, created_at timestamptz default now()
);

create table if not exists mp_swms_services (
  id uuid primary key default gen_random_uuid(),
  name text not null, sort int default 0, created_at timestamptz default now()
);

create table if not exists mp_swms_steps (
  id uuid primary key default gen_random_uuid(),
  service text not null, step_no int default 0, job_step text default '',
  method text default '', hazards text default '', impacts text default '',
  existing_controls text default '', impact int, likelihood int,
  additional_controls text default '', sort int default 0,
  created_at timestamptz default now()
);
create index if not exists idx_mp_swms_steps_service on mp_swms_steps (service);

create table if not exists mp_swms_equipment (
  id uuid primary key default gen_random_uuid(),
  service text not null, equipment text default '', purpose text default '',
  sort int default 0, created_at timestamptz default now()
);

create table if not exists mp_swms_ppe (
  id uuid primary key default gen_random_uuid(),
  service text not null, ppe text default '', sort int default 0,
  created_at timestamptz default now()
);

create table if not exists mp_team_members (
  id uuid primary key default gen_random_uuid(),
  name text not null, sort int default 0, created_at timestamptz default now()
);

create table if not exists mp_measure_types (
  id uuid primary key default gen_random_uuid(),
  name text not null, sort int default 0, created_at timestamptz default now()
);

-- Door 4 — measurement request tracker (was 'MeasureRequests' sheet)
create table if not exists mp_measure_requests (
  id            uuid primary key default gen_random_uuid(),
  req_date      date not null default (now() at time zone 'Asia/Kuala_Lumpur')::date,
  requestor     text default '',
  mall          text not null,
  lot_no        text not null,
  client        text not null,
  work_type     text default '',
  assigned_to   text default '',
  remarks       text default '',
  ref_photos    text default '',       -- one 'file name|storage path' per line
  purpose       text default 'Quotation',
  status        text default 'Requested',   -- Requested / Measured / Quotation Sent / Closed
  quote_sent_on date,
  notes         text default '',
  updated_by    text default '',
  updated_at    timestamptz default now(),
  created_at    timestamptz default now()
);
create index if not exists idx_mp_measure_requests_mall_lot on mp_measure_requests (mall, lot_no);

-- ─── 2 · AUTO-VERSIONING RPC (Door 1) ───────────────────────────────────────
-- Same rule as the GAS nextVersion(): max version for that Mall+Lot, +1.
-- security definer so the number is assigned server-side per upload batch.
create or replace function mp_next_version(p_mall text, p_lot text) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  select coalesce(max(version), 0) + 1 into v
  from mp_sketches
  where lower(mall) = lower(coalesce(p_mall,''))
    and lower(lot_no) = lower(coalesce(p_lot,''));
  return v;
end;
$$;

-- ─── 3 · STORAGE BUCKET (replaces the Drive folder tree Mall → Lot) ────────
insert into storage.buckets (id, name, public) values ('mall-sketches','mall-sketches', false)
on conflict (id) do nothing;
drop policy if exists "mall-sketches_rw" on storage.objects;
create policy "mall-sketches_rw" on storage.objects for all to authenticated
  using (bucket_id = 'mall-sketches' and is_allowed())
  with check (bucket_id = 'mall-sketches' and is_allowed());

-- ─── 4 · ROW-LEVEL SECURITY ─────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'mp_malls','mp_sketches','mp_categories','mp_requirements','mp_requirement_types',
    'mp_types','mp_job_categories','mp_panels','mp_panel_rates','mp_shop_types',
    'mp_rate_basis','mp_swms_services','mp_swms_steps','mp_swms_equipment','mp_swms_ppe',
    'mp_team_members','mp_measure_types','mp_measure_requests'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format('create policy %I_rw on %I for all to authenticated using (is_allowed()) with check (is_allowed())', t, t);
  end loop;
end $$;

-- ─── 5 · SEED DATA (same as the GAS setup(); only fills empty tables) ───────

-- Malls (GAS migrateMalls seeded 'SCM' if empty)
insert into mp_malls (name, code, added_by)
select 'SCM', 'SCM', 'system'
where not exists (select 1 from mp_malls limit 1);

insert into mp_categories (name, sort)
select * from (values ('Hoarding',1),('Visual',2),('Reinstatement',3),('Renovation',4)) v(n,s)
where not exists (select 1 from mp_categories limit 1);

insert into mp_job_categories (name, sort)
select * from (values
  ('Sprinkler dismantling',1),('LPG gas piping dismantling',2),('Telephone line checking',3),
  ('Fire alarm (FAS) / PA speaker checking',4),('Wet chemical system dismantling',5),
  ('AC / exhaust ducting cleaning',6),('Flushing services',7),('Pest control services',8)) v(n,s)
where not exists (select 1 from mp_job_categories limit 1);

insert into mp_requirement_types (category, name, sort)
select * from (values
  ('Hoarding','Hoarding material',1),('Hoarding','Hoarding door',2),('Hoarding','Hoarding counterweight',3),
  ('Hoarding','Hoarding fabric (top cover)',4),('Hoarding','Transparent plastic sheet',5),('Hoarding','Floor protection',6),
  ('Visual','Visual material',7),('Visual','Visual skirting',8),
  ('Reinstatement','Insurance (PL / CAR / Workmen Comp)',9),('Reinstatement','Property coverage',10),
  ('Reinstatement','Scaffold with green tag',11),('Reinstatement','OSH coordinator certification',12),
  ('Reinstatement','Work at height',13),('Reinstatement','CIDB CIMS registration',14),('Reinstatement','Rorobin',15),
  ('Reinstatement','Permit to Work (Form C)',16),('Reinstatement','Hot Work Permit (Form D)',17),
  ('Reinstatement','Fire extinguisher (ABC + CO2)',18),('Reinstatement','Hoarding erection timing',19),
  ('Reinstatement','Safety signage at hoarding',20),('Reinstatement','Sprinkler dismantling',21),
  ('Reinstatement','LPG gas piping dismantling',22),('Reinstatement','Wet chemical system dismantling',23)) v(c,n,s)
where not exists (select 1 from mp_requirement_types limit 1);

insert into mp_types (category, name, sort)
select * from (values
  ('Hoarding','Lot (Shop Front) (Indoor)',1),
  ('Hoarding','Lot (Shop Front) (Outdoor)',2),
  ('Hoarding','Kiosk (Indoor)',3),
  ('Hoarding','Kiosk (Outdoor)',4),
  ('Hoarding','Building Facade (Outdoor)',5),
  ('Visual','Lot (Shop Front Hoarding) (Indoor)',6),
  ('Visual','Lot (Shop Front Hoarding) (Outdoor)',7),
  ('Visual','Kiosk (Indoor)',8),
  ('Visual','Kiosk (Outdoor)',9),
  ('Visual','Glass Panel',10),
  ('Visual','Wall (Indoor)',11),
  ('Visual','Pillar',12),
  ('Visual','Building Facade (Outdoor Hoarding)',13)) v(c,n,s)
where not exists (select 1 from mp_types limit 1);

insert into mp_shop_types (name, sort)
select * from (values ('All',1),('F&B',2),('Office',3),('Others',4)) v(n,s)
where not exists (select 1 from mp_shop_types limit 1);

insert into mp_rate_basis (name, sort)
select * from (values ('Per lot',1),('Per sqft',2),('Per point',3),('Lump sum',4)) v(n,s)
where not exists (select 1 from mp_rate_basis limit 1);

-- Real SCM requirement example (same rows as GAS seedRequirements)
insert into mp_requirements (mall, category, requirement, value, shop_type, notes, sort, updated_by)
select 'SCM', v.c, v.r, v.val, v.st, v.nt, v.s, 'system' from (values
  ('Hoarding','Hoarding material','White polyester laminated plywood (matte finish)','All','Per mall hoarding board spec',1),
  ('Hoarding','Hoarding door','Single leaf 1200×2400mm, swing outward, staple & hasp + number padlock','All','Door in middle of hoarding full length; gap from floor 25mm; 3 hinges; 50×50 timber frame',2),
  ('Hoarding','Hoarding counterweight','Yes','All','',3),
  ('Hoarding','Hoarding fabric (top cover)','Yes','All','Lot: top fabric cover. Kiosk: top surface + side handrail cover (depends on site condition)',4),
  ('Hoarding','Transparent plastic sheet','Depends on mall fit-out request','All','',5),
  ('Hoarding','Floor protection','Plastic sheet (1st layer) + plywood (2nd layer)','All','NO nail or screw to common corridor floor. Set back 6" from sprinkler/smoke curtain/hose reel',6),
  ('Visual','Visual material','Sticker','All','',7),
  ('Visual','Visual skirting','No (sticker)','All','Tarpaulin: Yes — sometimes No, depends on mall',8),
  ('Reinstatement','Insurance (PL / CAR / Workmen Comp)','RM2,000,000','All','Public Liability / Contractor All Risk / Workmen Compensation',9),
  ('Reinstatement','Property coverage','No','All','Sometimes Yes — RM5mil',10),
  ('Reinstatement','Scaffold with green tag','Yes','All','',11),
  ('Reinstatement','OSH coordinator certification','Yes','All','',12),
  ('Reinstatement','Work at height','Yes','All','',13),
  ('Reinstatement','CIDB CIMS registration','Yes','All','',14),
  ('Reinstatement','Rorobin','Yes — self engage','All','',15),
  ('Reinstatement','Permit to Work (Form C)','Required','All','Display PTW + 24h approval letter at front of hoarding in clear folder',16),
  ('Reinstatement','Hot Work Permit (Form D)','Required if hot work','All','',17),
  ('Reinstatement','Fire extinguisher (ABC + CO2)','Required if hot work','All','Valid license, on site',18),
  ('Reinstatement','Hoarding erection timing','Full height on last day of business night','All','',19),
  ('Reinstatement','Safety signage at hoarding','No Smoking / Eating / Urinating; PPE & Security Pass','All','',20),
  ('Reinstatement','Sprinkler dismantling','Yes — panel contractor','All','',21),
  ('Reinstatement','LPG gas piping dismantling','Yes','F&B','Gas meter compulsory dismantle by Gas Malaysia Sdn Bhd (arranged by tenant / panel)',22),
  ('Reinstatement','Wet chemical system dismantling','Yes','F&B','',23)) v(c,r,val,st,nt,s)
where not exists (select 1 from mp_requirements limit 1);

-- Sample panels + rates (GAS seedPanels — skipped if either table has data)
insert into mp_panels (name, pic, phone, email, notes, updated_by)
select * from (values
  ('ABC Engineering Sdn Bhd','Mr Tan','012-3456789','abc@example.com','SAMPLE — replace with real panel','system'),
  ('XYZ M&E Sdn Bhd','Ms Lim','012-9876543','xyz@example.com','SAMPLE — replace with real panel','system')) v(n,p,ph,e,nt,ub)
where not exists (select 1 from mp_panels limit 1)
  and not exists (select 1 from mp_panel_rates limit 1);

insert into mp_panel_rates (panel, job_category, mall, rate_basis, price_from, price_to, lot_size_ref, engaged_on, notes, updated_by)
select * from (values
  ('ABC Engineering Sdn Bhd','Sprinkler dismantling','SCM','Per lot',1500::numeric,2500::numeric,'≤ 1000 sqft','May 2025','SAMPLE','system'),
  ('XYZ M&E Sdn Bhd','Sprinkler dismantling','SCM','Per lot',1800::numeric,2800::numeric,'≤ 1000 sqft','Mar 2025','SAMPLE','system')) v(p,j,m,rb,pf,pt,ls,eo,nt,ub)
where not exists (select 1 from mp_panel_rates limit 1)
  and exists (select 1 from mp_panels where notes like 'SAMPLE%');

insert into mp_swms_services (name, sort)
select * from (values
  ('Hoarding',1),('Visual',2),('Reinstatement',3),('Scaffold',4),('Brick wall erection',5),
  ('Plaster ceiling',6),('Partition',7),('Tiling',8),('Flooring',9),('Painting',10)) v(n,s)
where not exists (select 1 from mp_swms_services limit 1);

insert into mp_swms_equipment (service, equipment, purpose, sort)
select * from (values
  ('Hoarding','Portable power drill','To drive screws',1),
  ('Hoarding','Aluminium ladder','Access height below 4m',2),
  ('Hoarding','Heavy duty trolley','Transport materials & tools',3),
  ('Hoarding','Floor protection mat','Floor protection during mobilization',4),
  ('Hoarding','Safety barricade cones','Barricade and secure work area',5),
  ('Hoarding','Laser lining machine','Levelling and alignment confirmation',6),
  ('Visual','Aluminium ladder','Access height below 4m',7),
  ('Visual','Heavy duty trolley','Transport materials & tools',8),
  ('Visual','Floor protection mat','Floor protection during mobilization',9),
  ('Visual','Safety barricade cones','Barricade and secure work area',10),
  ('Visual','Staple gun','Fix tarpaulin to hoarding',11),
  ('Visual','Hot gun','Smoothen wrinkled tarpaulin',12)) v(sv,e,p,s)
where not exists (select 1 from mp_swms_equipment limit 1);

insert into mp_swms_ppe (service, ppe, sort)
select 'All', v.n, v.s from (values
  ('Safety helmet',1),('Safety shoes',2),('Safety vest',3),('Hand gloves',4),('Safety glasses',5),
  ('Ear plug (if required)',6),('Dust mask (if required)',7)) v(n,s)
where not exists (select 1 from mp_swms_ppe limit 1);

insert into mp_team_members (name, sort)
select 'Calvin', 1
where not exists (select 1 from mp_team_members limit 1);

insert into mp_measure_types (name, sort)
select * from (values ('Hoarding size',1),('Reinstatement lot size',2)) v(n,s)
where not exists (select 1 from mp_measure_types limit 1);

-- Real hoarding + visual SWMS steps (TRX template — same text as GAS seedSwmsSteps).
-- Common steps 1-5 and closing steps 20-23 go to BOTH services; step 6-7 Hoarding only,
-- step 8 Visual only. One statement so the empty-table guard applies once.
insert into mp_swms_steps (service, step_no, job_step, method, hazards, impacts, existing_controls, impact, likelihood, additional_controls, sort)
select q.service, q.step_no, q.job_step, q.method, q.hazards, q.impacts, q.controls, q.impact, q.likelihood, '', q.step_no
from (
  -- common + closing → both services
  select s.svc as service, v.* from (values
    (1,'Lorry & workers reach at loading bay',
     E'Change working pass at security counter before start work\nBring along work permit copy & workers documents (IC, passport, visa, CIDB)\nCheck site dilapidation, floor tiles, sprinkler head, smoke curtain, fire shutter, hose reel, AC diffuser, fire door, CCTV — avoid blocking\nSnap pictures of all defects before start',
     E'Lorry hit on item / premise\nLorry hit on person',
     E'Damage to premise\nInjury to workers / public',
     E'Drive safely\nNot driving when sleepy\nBanksman to guide at loading bay',4,2),
    (2,'Unload materials, tools and equipment from lorry',
     E'Unload materials, tools and equipment from lorry\nPlace all items on trolley brought by HG',
     E'Back pain from manual lifting\nItem(s) drop when carrying',
     E'Muscle strain\nInjury to hand / leg',
     E'Use trolley\nWork with buddy system\nUse safety glove',3,4),
    (3,'Barricade work area and place floor protection',
     E'Place barricade cone around work area c/w safety signage\nPlace floor protection on common walkway from loading bay to installation area for trolley mobilization',
     E'Fell on slippery floor\nTrip on unclear debris\nStep on nail / screw on floor',
     E'Slip / trip / fall injury\nPuncture wound',
     E'Safety shoes\nUse safety glove\nClear off debris onsite',2,3),
    (4,'Floor protection mat installation for materials, tools and equipment placement',
     E'Place materials, tools and equipment on floor protection mat for easy monitoring and installation',
     E'Fell on slippery floor\nTrip on unclear debris\nStep on nail / screw on floor',
     E'Slip / trip / fall injury',
     E'Safety shoes\nUse safety glove\nClear off debris onsite',2,3),
    (5,'Prepare and place ladder for work at height (below 4m)',
     E'Use double sided step ladder / telescoping ladder\nInspect ladder before use',
     E'Fell from ladder\nDrop item when working at height',
     E'Fall injury\nInjury to person below',
     E'Work with buddy system\nUse tool belt\nMaintain 3-point contact on ladder',4,3),
    (20,'Testing',
     E'Test sturdiness by pushing frontward & backward in mild force\nIf not sturdy, install additional screw, tie & structure',
     E'Structure fall\nFlimsy structure\nStep on nail / screw',
     E'Crush / impact injury',
     E'Safety shoes\nWork with buddy system\nCompetent supervisor onsite',4,3),
    (21,'Packing up',
     E'Pack balance material and equipment on trolley and move back to lorry',
     E'Fell on slippery floor\nTrip on debris\nStep on nail / screw',
     E'Slip / trip / fall injury',
     E'Safety shoes\nClear off debris',2,3),
    (22,'Clean up',
     E'Sweep and clear off all debris onsite\nScrap off glue stain / stubborn debris\nMop and clear including lift & loading bay area\nCheck with mall security & management before leaving',
     E'Fell on slippery floor',
     E'Slip / fall injury',
     E'Safety shoes\nClear off debris',2,3),
    (23,'Snap pictures for reporting',
     E'Snap pictures of completed work and working area for record and report',
     'NA','NA','NA',1,1)
  ) v(step_no, job_step, method, hazards, impacts, controls, impact, likelihood)
  cross join (values ('Hoarding'),('Visual')) s(svc)
  union all
  -- Hoarding-only install steps
  select 'Hoarding', v.* from (values
    (6,'Hoarding marking after on-site measurement checking',
     E'Setup hoarding alignment & marking by referring to approved hoarding drawing using laser lining machine\nOnsite safety briefing to team before start work',
     'NA','NA','NA',1,1),
    (7,'Hoarding installation onsite',
     E'Pre-fabricate each hoarding panel with timber structure on floor within barricaded area; join board panels with screw\nPush jointed panel up from floor, place within laser line (adjust to site condition)\nContinue joining hoarding panels until whole structure complete\nWith concrete counterweight: install slanted timber support with timber frame base to hold counterweight until complete\nInstall sliding / swing door for hoarding access',
     E'Hoarding fall\nStep on nail / screw\nItem(s) fall (tools)\nWorker(s) fall\nFlimsy structure on hoarding',
     E'Crush / impact injury\nInjury to public',
     E'Safety shoes\nWork with buddy system\nUse safety glove\nBarricade working site to keep public out\nFull PPE compulsory\nCompetent supervisor onsite',4,3)
  ) v(step_no, job_step, method, hazards, impacts, controls, impact, likelihood)
  union all
  -- Visual-only install step
  select 'Visual', v.* from (values
    (8,'Visual tarpaulin installation onsite',
     E'Buddy system: worker A on ladder, worker B passes tarpaulin; A staples top edge until top complete\nAdjust bottom by pulling tarpaulin firm & smooth, then staple\nContinue until complete\nUse hot gun to smoothen wrinkled tarpaulin (if required)\nInstall aluminium skirting as visual frame to cover staple marks',
     E'Fall from height\nStep on nail / screw\nItem(s) fall (tools)\nWorker(s) fall\nFlimsy structure on hoarding',
     E'Crush / impact injury\nInjury to public',
     E'Safety shoes\nWork with buddy system\nUse safety glove\nBarricade working site to keep public out\nFull PPE compulsory\nCompetent supervisor onsite',4,3)
  ) v(step_no, job_step, method, hazards, impacts, controls, impact, likelihood)
) q
where not exists (select 1 from mp_swms_steps limit 1);

-- Done. Open mall-platform-supabase.html to use the app.
