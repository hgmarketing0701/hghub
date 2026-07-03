-- ============================================================================
-- HG GROUP — SUPABASE BACKBONE · Phase 1 (Smart Quotation pilot)
-- Run this ONCE in Supabase → SQL Editor → New query → paste → Run.
-- Safe to re-run: everything is IF NOT EXISTS / ON CONFLICT DO NOTHING.
--
-- What it creates:
--   1. allowed_users     — the login allowlist (Google sign-in + this list = access)
--   2. clients           — the BLUE layer: master client records (shared backbone)
--   3. malls / services  — dropdown masters
--   4. price_book        — the master PriceBook ((All Malls) defaults + overrides)
--   5. app_settings      — company info, SST %, quote prefix, footer
--   6. quotes / quote_lines — every saved quotation
--   7. audit_log         — who did what, when
--   8. save_quote() RPC  — server-side recompute (never trusts client maths)
--   9. Row-Level Security on every table (allowlist-gated)
-- ============================================================================

-- ─── 1 · ALLOWLIST ──────────────────────────────────────────────────────────
create table if not exists allowed_users (
  email      text primary key,
  full_name  text default '',
  is_admin   boolean default false,
  added_by   text default '',
  added_at   timestamptz default now()
);

-- Seed the first admins — EDIT THESE to your real logins, then add the rest
-- from inside the app (Settings → Team access).
insert into allowed_users (email, full_name, is_admin) values
  ('znerationmedia@gmail.com', 'Developer', true),
  ('lee@hggroup.com.my',       'Black Lee', true),
  ('marketing@hggroup.com.my',       'Marketing', true)
on conflict (email) do nothing;

-- Helper: is the signed-in user on the allowlist?
create or replace function is_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from allowed_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from allowed_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and is_admin
  );
$$;

create or replace function current_email() returns text
language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', 'unknown');
$$;

-- ─── 2 · CLIENTS (BLUE layer — the shared backbone every tool will use) ─────
create table if not exists clients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  type       text default 'Contractor',          -- Mall / Contractor / Tenant
  phone      text default '',
  email      text default '',
  notes      text default '',
  created_by text default '',
  created_at timestamptz default now()
);

-- ─── 3 · MASTERS ────────────────────────────────────────────────────────────
create table if not exists malls (
  id        uuid primary key default gen_random_uuid(),
  name      text not null unique,
  code      text default '',
  location  text default '',
  notes     text default ''
);

create table if not exists services (
  id        uuid primary key default gen_random_uuid(),
  name      text not null unique,
  is_extra  boolean default false,   -- Fit-Out / Scaffold style "extra work"
  sort      int default 0
);

-- ─── 4 · PRICE BOOK ─────────────────────────────────────────────────────────
-- mall = '(All Malls)' rows apply everywhere; a mall-specific row overrides
-- the default on the same (service, sub_scope, item).
create table if not exists price_book (
  id               uuid primary key default gen_random_uuid(),
  mall             text not null default '(All Malls)',
  service          text not null,
  sub_scope        text not null,
  item             text not null,
  unit             text not null default 'nos',     -- sqft/ft/m/nos/lot/day/month/trip/item
  compulsory       boolean default true,
  min_qty          numeric default 0,
  min_charge       numeric default 0,
  price_mall       numeric default 0,
  price_contractor numeric default 0,
  price_tenant     numeric default 0,
  sort             int default 1,
  notes            text default '',
  updated_by       text default '',
  updated_at       timestamptz default now()
);
create index if not exists idx_pricebook_mall on price_book (mall);
create index if not exists idx_pricebook_key  on price_book (service, sub_scope, item);

-- ─── 5 · SETTINGS ───────────────────────────────────────────────────────────
create table if not exists app_settings (
  key   text primary key,
  value text default ''
);
insert into app_settings (key, value) values
  ('COMPANY_NAME',   'HG Group'),
  ('COMPANY_REG',    '(your SSM reg no.)'),
  ('COMPANY_ADDRESS','(your address)'),
  ('COMPANY_PHONE',  '(your phone)'),
  ('COMPANY_EMAIL',  'lee@hggroup.com.my'),
  ('SST_PERCENT',    '6'),
  ('QUOTE_PREFIX',   'HG-Q'),
  ('VALIDITY_DAYS',  '14'),
  ('QUOTE_FOOTER',   'Subject to site condition. Validity 14 days.')
on conflict (key) do nothing;

-- ─── 6 · QUOTES ─────────────────────────────────────────────────────────────
create table if not exists quotes (
  id          uuid primary key default gen_random_uuid(),
  quote_no    text not null unique,
  quote_date  date not null default (now() at time zone 'Asia/Kuala_Lumpur')::date,
  mall        text not null,
  client_id   uuid references clients(id),
  client_name text not null,
  client_type text not null default 'Mall',       -- Mall / Contractor / Tenant
  attention   text default '',
  project     text default '',
  subtotal    numeric not null default 0,
  sst_pct     numeric not null default 0,
  sst         numeric not null default 0,
  total       numeric not null default 0,
  status      text not null default 'Draft',      -- Draft / Sent / Confirmed / Cancelled
  notes       text default '',
  created_by  text default '',
  created_at  timestamptz default now()
);

create table if not exists quote_lines (
  id        uuid primary key default gen_random_uuid(),
  quote_id  uuid not null references quotes(id) on delete cascade,
  service   text default '',
  sub_scope text default '',
  item      text not null,
  unit      text default '',
  qty       numeric default 0,
  rate      numeric default 0,
  amount    numeric default 0,
  note      text default '',
  sort      int default 1
);
create index if not exists idx_quotelines_quote on quote_lines (quote_id);

-- ─── 7 · AUDIT LOG ──────────────────────────────────────────────────────────
create table if not exists audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz default now(),
  user_email text default '',
  action     text not null,
  details    text default ''
);

create or replace function log_audit(p_action text, p_details text) returns void
language sql security definer set search_path = public as $$
  insert into audit_log (user_email, action, details)
  values (current_email(), p_action, left(coalesce(p_details,''), 300));
$$;

-- ─── 8 · SAVE QUOTE RPC — server-side recompute, atomic quote number ────────
-- payload: { mall, clientName, clientType, attention, project, notes, applySST,
--            lines: [{service, subScope, item, unit, qty, rate, minQty, minCharge, note}] }
create or replace function save_quote(payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_line     jsonb;
  v_qty      numeric; v_rate numeric; v_minq numeric; v_minc numeric;
  v_effqty   numeric; v_amount numeric; v_note text;
  v_subtotal numeric := 0;
  v_sstpct   numeric := 0;
  v_sst      numeric; v_total numeric;
  v_prefix   text;
  v_year     text := to_char(now() at time zone 'Asia/Kuala_Lumpur', 'YYYY');
  v_next     int;
  v_quoteno  text;
  v_qid      uuid;
  v_sort     int := 0;
  v_computed jsonb := '[]'::jsonb;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  if coalesce(payload->>'mall','')       = '' then raise exception 'Select a mall.'; end if;
  if coalesce(payload->>'clientName','') = '' then raise exception 'Enter the client name.'; end if;
  if jsonb_array_length(coalesce(payload->'lines','[]'::jsonb)) = 0 then
    raise exception 'Add at least one line item.';
  end if;

  -- SST
  if coalesce((payload->>'applySST')::boolean, false) then
    select coalesce(nullif(value,'')::numeric, 6) into v_sstpct
    from app_settings where key = 'SST_PERCENT';
    v_sstpct := coalesce(v_sstpct, 6);
  end if;

  -- recompute every line (min-qty / min-charge rules) — never trust client maths
  for v_line in select * from jsonb_array_elements(payload->'lines') loop
    v_qty  := coalesce((v_line->>'qty')::numeric, 0);
    v_rate := coalesce((v_line->>'rate')::numeric, 0);
    v_minq := coalesce((v_line->>'minQty')::numeric, 0);
    v_minc := coalesce((v_line->>'minCharge')::numeric, 0);
    v_effqty := v_qty; v_note := coalesce(v_line->>'note','');

    if v_minq > 0 and v_qty > 0 and v_qty < v_minq then
      v_effqty := v_minq;
      v_note := trim(both '; ' from v_note || '; min ' || v_minq || ' ' || coalesce(v_line->>'unit',''));
    end if;
    v_amount := round(v_effqty * v_rate, 2);
    if v_minc > 0 and v_amount < v_minc then
      v_amount := round(v_minc, 2);
      v_note := trim(both '; ' from v_note || '; min charge RM' || v_minc);
    end if;

    v_subtotal := v_subtotal + v_amount;
    v_sort := v_sort + 1;
    v_computed := v_computed || jsonb_build_object(
      'service', coalesce(v_line->>'service',''), 'subScope', coalesce(v_line->>'subScope',''),
      'item', v_line->>'item', 'unit', coalesce(v_line->>'unit',''),
      'qty', v_effqty, 'rate', v_rate, 'amount', v_amount, 'note', v_note, 'sort', v_sort);
  end loop;

  v_subtotal := round(v_subtotal, 2);
  v_sst      := round(v_subtotal * v_sstpct / 100, 2);
  v_total    := round(v_subtotal + v_sst, 2);

  -- atomic sequential quote number: HG-Q-YYYY-###
  select coalesce(nullif(value,''), 'HG-Q') into v_prefix from app_settings where key = 'QUOTE_PREFIX';
  v_prefix := coalesce(v_prefix, 'HG-Q') || '-' || v_year || '-';
  select coalesce(max((substring(quote_no from length(v_prefix)+1))::int), 0) + 1
    into v_next from quotes where quote_no like v_prefix || '%'
    and substring(quote_no from length(v_prefix)+1) ~ '^[0-9]+$';
  v_quoteno := v_prefix || lpad(v_next::text, 3, '0');

  insert into quotes (quote_no, mall, client_name, client_type, attention, project,
                      subtotal, sst_pct, sst, total, status, notes, created_by)
  values (v_quoteno, payload->>'mall', payload->>'clientName',
          coalesce(payload->>'clientType','Mall'), coalesce(payload->>'attention',''),
          coalesce(payload->>'project',''), v_subtotal, v_sstpct, v_sst, v_total,
          'Draft', coalesce(payload->>'notes',''), current_email())
  returning id into v_qid;

  insert into quote_lines (quote_id, service, sub_scope, item, unit, qty, rate, amount, note, sort)
  select v_qid, l->>'service', l->>'subScope', l->>'item', l->>'unit',
         (l->>'qty')::numeric, (l->>'rate')::numeric, (l->>'amount')::numeric,
         l->>'note', (l->>'sort')::int
  from jsonb_array_elements(v_computed) as l;

  perform log_audit('SAVE QUOTE',
    v_quoteno || ' · ' || (payload->>'mall') || ' · ' || (payload->>'clientName') || ' · RM' || v_total);
  return v_qid;
end;
$$;

-- ─── 9 · ROW-LEVEL SECURITY — allowlist-gated everything ────────────────────
alter table allowed_users enable row level security;
alter table clients       enable row level security;
alter table malls         enable row level security;
alter table services      enable row level security;
alter table price_book    enable row level security;
alter table app_settings  enable row level security;
alter table quotes        enable row level security;
alter table quote_lines   enable row level security;
alter table audit_log     enable row level security;

-- allowed_users: anyone signed-in may check (needed for the login gate);
-- only admins may change the list.
drop policy if exists au_select on allowed_users;
create policy au_select on allowed_users for select to authenticated using (true);
drop policy if exists au_admin_ins on allowed_users;
create policy au_admin_ins on allowed_users for insert to authenticated with check (is_admin());
drop policy if exists au_admin_upd on allowed_users;
create policy au_admin_upd on allowed_users for update to authenticated using (is_admin());
drop policy if exists au_admin_del on allowed_users;
create policy au_admin_del on allowed_users for delete to authenticated using (is_admin());

-- everything else: full access for allowlisted users
do $$
declare t text;
begin
  foreach t in array array['clients','malls','services','price_book','app_settings','quotes','quote_lines'] loop
    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format('create policy %I_rw on %I for all to authenticated using (is_allowed()) with check (is_allowed())', t, t);
  end loop;
end $$;

-- audit_log: allowlisted may read; writes only via the log_audit() function
drop policy if exists audit_read on audit_log;
create policy audit_read on audit_log for select to authenticated using (is_allowed());

-- ─── 10 · SEED DATA (same samples as the Apps Script version) ───────────────
insert into services (name, is_extra, sort) values
  ('Hoarding', false, 1), ('Reinstatement', false, 2), ('Visual Print & Install', false, 3),
  ('Fit-Out', true, 4), ('Scaffold', true, 5), ('Temporary Storage', true, 6)
on conflict (name) do nothing;

insert into malls (name, code, location) values
  ('KLCC', 'KLCC', 'Kuala Lumpur'), ('Pavilion KL', 'PAV', 'Bukit Bintang'),
  ('Mid Valley', 'MV', 'Kuala Lumpur'), ('Sunway Pyramid', 'SP', 'Petaling Jaya')
on conflict (name) do nothing;

-- Sample PriceBook (⚠ SAMPLE RM rates — replace in the Price Book tab)
insert into price_book (mall, service, sub_scope, item, unit, compulsory, min_qty, min_charge,
                        price_mall, price_contractor, price_tenant, sort, notes, updated_by)
select * from (values
  ('(All Malls)','Hoarding','Installation','Hoarding panel (plywood + metal frame)','sqft',true,0,0,18,15,22,1,'L×H per run','seed'),
  ('(All Malls)','Hoarding','Installation','Visual tarpaulin print & install','sqft',true,0,0,8,6,10,2,'','seed'),
  ('(All Malls)','Hoarding','Installation','Skirting','ft',true,0,0,12,10,14,3,'linear ft','seed'),
  ('(All Malls)','Hoarding','Installation','Sliding door','nos',true,0,0,850,750,1000,4,'','seed'),
  ('(All Malls)','Hoarding','Installation','Counterweight','nos',true,0,0,120,100,150,5,'','seed'),
  ('(All Malls)','Hoarding','Installation','Anti-climb capping','ft',false,0,0,9,7,11,6,'optional','seed'),
  ('(All Malls)','Hoarding','Installation','Inspection door / hatch','nos',false,0,0,350,300,420,7,'optional','seed'),
  ('(All Malls)','Hoarding','Modification','Hoarding relocation / modification','sqft',true,0,0,10,8,12,1,'','seed'),
  ('(All Malls)','Hoarding','Modification','Door relocation','nos',false,0,0,450,400,550,2,'','seed'),
  ('(All Malls)','Hoarding','Modification','Re-print tarpaulin','sqft',false,0,0,7,5,9,3,'','seed'),
  ('(All Malls)','Hoarding','Dismantling','Hoarding dismantling','sqft',true,0,0,6,5,8,1,'','seed'),
  ('(All Malls)','Hoarding','Dismantling','Disposal & cart away','lot',true,0,350,0,0,0,2,'min charge lot','seed'),
  ('(All Malls)','Reinstatement','F&B Lot','Hacking & removal of existing finishes','sqft',true,200,0,9,7,11,1,'min 200 sqft','seed'),
  ('(All Malls)','Reinstatement','F&B Lot','Floor screed & leveling','sqft',true,200,0,8,6,10,2,'min 200 sqft','seed'),
  ('(All Malls)','Reinstatement','F&B Lot','Repaint to base / original','sqft',true,200,0,4,3,5,3,'min 200 sqft','seed'),
  ('(All Malls)','Reinstatement','F&B Lot','Make good & handover cleaning','lot',true,0,800,0,0,0,4,'min charge RM800','seed'),
  ('(All Malls)','Reinstatement','F&B Kiosk','Hacking & removal','sqft',true,50,600,11,9,13,1,'min 50 sqft / RM600','seed'),
  ('(All Malls)','Reinstatement','F&B Kiosk','Make good & handover cleaning','lot',true,0,500,0,0,0,2,'min charge RM500','seed'),
  ('(All Malls)','Reinstatement','Other Trades Lot','Hacking & removal','sqft',true,150,0,7,5,9,1,'min 150 sqft','seed'),
  ('(All Malls)','Reinstatement','Other Trades Lot','Repaint to base / original','sqft',true,150,0,4,3,5,2,'min 150 sqft','seed'),
  ('(All Malls)','Reinstatement','Other Trades Lot','Make good & handover cleaning','lot',true,0,600,0,0,0,3,'min charge RM600','seed'),
  ('(All Malls)','Reinstatement','Other Trades Kiosk','Hacking & removal','sqft',true,40,450,9,7,11,1,'min 40 sqft / RM450','seed'),
  ('(All Malls)','Reinstatement','Other Trades Kiosk','Make good & handover cleaning','lot',true,0,400,0,0,0,2,'min charge RM400','seed'),
  ('(All Malls)','Visual Print & Install','Tarpaulin','Tarpaulin print & install','sqft',true,0,0,8,6,10,1,'','seed'),
  ('(All Malls)','Visual Print & Install','Sticker','Sticker print & install','sqft',true,0,0,10,8,13,1,'','seed'),
  ('(All Malls)','Visual Print & Install','Sticker','Lamination','sqft',false,0,0,3,2,4,2,'optional','seed'),
  ('(All Malls)','Fit-Out','Partition','Plaster board partition (both sides)','sqft',true,0,0,14,11,17,1,'','seed'),
  ('(All Malls)','Fit-Out','Plaster Ceiling','Plaster ceiling','sqft',true,0,0,12,10,15,1,'','seed'),
  ('(All Malls)','Fit-Out','Tiling','Floor / wall tiling (excl. tiles)','sqft',true,0,0,9,7,12,1,'labour only','seed'),
  ('(All Malls)','Fit-Out','Flooring','Vinyl / laminate flooring','sqft',true,0,0,7,5,9,1,'','seed'),
  ('(All Malls)','Fit-Out','Brick Wall','Brick wall erection & plaster','sqft',true,0,0,16,13,20,1,'','seed'),
  ('(All Malls)','Fit-Out','Painting','Painting (1 coat primer + 2 coats)','sqft',true,0,0,3.5,2.8,4.5,1,'','seed'),
  ('(All Malls)','Scaffold','Erection','Scaffold erection','sqft',true,0,0,6,5,8,1,'face area','seed'),
  ('(All Malls)','Scaffold','Erection','Green tag inspection','nos',false,0,0,150,120,180,2,'weekly','seed'),
  ('(All Malls)','Scaffold','Hire','Scaffold hire','day',true,0,0,2.5,2,3,1,'per sqft per day','seed'),
  ('(All Malls)','Scaffold','Dismantling','Scaffold dismantling','sqft',true,0,0,3,2.5,4,1,'','seed'),
  ('(All Malls)','Temporary Storage','Lot Rental','Storage lot rental','month',true,0,0,800,700,1000,1,'per lot per month','seed'),
  ('(All Malls)','Temporary Storage','Lot Rental','Transport in/out','trip',false,0,0,350,300,420,2,'optional','seed'),
  ('KLCC','Hoarding','Installation','Hoarding panel (plywood + metal frame)','sqft',true,0,0,22,19,26,1,'KLCC premium','seed'),
  ('KLCC','Hoarding','Installation','Visual tarpaulin print & install','sqft',true,0,0,10,8,13,2,'KLCC premium','seed')
) as v(mall,service,sub_scope,item,unit,compulsory,min_qty,min_charge,price_mall,price_contractor,price_tenant,sort,notes,updated_by)
where not exists (select 1 from price_book limit 1);

-- Done. Next: Supabase Dashboard → Authentication → Providers → enable Google.
