-- ============================================================================
-- HG — HOARDING PRICING SYSTEM (Metal Deck) · Supabase schema  (prefix: hrd_)
-- Converted from apps-script-hoarding (Code.gs / Index.html).
-- Additive & idempotent — run AFTER the foundation supabase/schema.sql.
-- Uses foundation helpers (never redefined here):
--   is_allowed(), is_admin(), current_email(), log_audit(action, details)
--
-- CALC ENGINE: verified exact port of "HG Metal Deck Calculator (3).xlsx".
-- Test case L160 / H2.4 / CC3 / 1 door reproduces:
--   Hoarding 47,860.14 · Gate 5,740.26 · Grand ex-tax 53,600.39 — to the cent.
-- The server-side recompute in hrd_save_quote() below is the authoritative
-- copy of that engine (same formulas, same rounding: ceil(x - 1e-9) round-ups,
-- IEEE-754 double maths, final totals rounded to 2 dp).
-- ============================================================================

-- ─── 1 · MATERIAL CATALOG ────────────────────────────────────────────────────
create table if not exists hrd_materials (
  code       text primary key,
  type       text default '',
  size       text default '',
  thickness  numeric,                 -- null = n/a (GAS stored '')
  bar_qty    numeric default 1,       -- units per bar / sheet (cost divisor)
  unit       text default 'm',
  cost_price numeric default 0,       -- RM per bar/sheet
  markup     numeric default 0.4,     -- FRACTION (0.4 = 40%), same as GAS sheet
  updated_by text default '',
  updated_at timestamptz default now()
);

-- ─── 2 · QUOTES (full snapshot, like the GAS Quotes sheet + dataJson) ────────
create table if not exists hrd_quotes (
  id             uuid primary key default gen_random_uuid(),
  quote_no       text not null unique,
  quote_date     date default (now() at time zone 'Asia/Kuala_Lumpur')::date,
  client         text not null,
  contact        text default '',
  project        text default '',
  mall           text default '',
  lot            text default '',
  location       text default '',
  validity       numeric default 0,
  status         text not null default 'Draft',   -- Draft / Sent / Won / Lost
  length         numeric default 0,
  height         numeric default 0,
  doors          numeric default 0,
  hoarding_total numeric default 0,
  gate_total     numeric default 0,
  subtotal       numeric default 0,
  sst_pct        numeric default 0,
  sst_amount     numeric default 0,
  grand_total    numeric default 0,
  data           jsonb not null default '{}'::jsonb, -- {inputs, lines:{H,G}, metrics}
  created_by     text default '',
  created_at     timestamptz default now(),
  updated_by     text default '',
  updated_at     timestamptz default now()
);

-- ─── 3 · SUPPLIER PRICES (comparison only) ──────────────────────────────────
create table if not exists hrd_supplier_prices (
  id         uuid primary key default gen_random_uuid(),
  code       text not null,           -- material code
  supplier   text not null,
  cost_price numeric default 0,
  note       text default '',
  created_by text default '',         -- = recordedBy in the GAS sheet
  created_at timestamptz default now()
);

-- ─── 4 · PRICE HISTORY (WHEN a price changed, by whom, why) ─────────────────
create table if not exists hrd_price_history (
  id         bigint generated always as identity primary key,
  ts         timestamptz default now(),
  code       text not null,
  field      text not null,           -- 'Cost Price' | 'Markup %'
  old_val    numeric default 0,       -- display values (markup shown as %)
  new_val    numeric default 0,
  user_email text default '',
  reason     text default ''
);

-- ─── 5 · TOOL CONFIG (own table — does not touch shared app_settings) ───────
create table if not exists hrd_config (
  key   text primary key,
  value text default ''
);
insert into hrd_config (key, value) values
  ('COMPANY_NAME',   'HG Services (M) Sdn Bhd'),
  ('COMPANY_REG',    'Co. No. 958510-M'),
  ('COMPANY_ADDRESS','Bandar Kinrara, Puchong, Selangor'),
  ('COMPANY_EMAIL',  'info@hggroup.com.my'),
  ('COMPANY_WEB',    'www.hggroup.com.my'),
  ('SST_PCT',        '6'),   -- Excel labelled "8%" but computed 6% — 6% is HG standard
  ('DEFAULT_MARKUP', '40'),
  ('QUOTE_PREFIX',   'HG-Q-'),
  ('QUOTE_SEQ',      '0'),
  ('CODE_GI',        'GI-4x8-0.4'),
  ('CODE_DECK_MAIN', 'DECK-0.23'),
  ('CODE_DECK_GATE', 'DECK-0.48'),
  ('CODE_FOOTING',   'FOOTING-450x450x750'),
  ('CODE_BASE',      'BASE-200x200x5'),
  ('CODE_XBRACE',    'MS-50x50x5'),
  ('XBRACE_LEN',     '10.8'),
  ('L_FAB_POST',     '150'),
  ('L_PRELIM',       '1200'),
  ('L_INSTALL',      '1500'),
  ('L_FAB_GATE',     '1200'),
  ('L_INSTALL_GATE', '1500'),
  ('SIGNATORY',      'Lee Chun Hui (Black) — Director'),
  ('TERMS', E'1. Validity: As stated above from quote date.\n2. Payment: 50% deposit on confirmation, 50% on completion. Payment within 30 days of invoice.\n3. Lead time: Mobilization within 7 working days of confirmed PO and site readiness.\n4. Site requirements: Client to provide unobstructed access, water & power, and necessary permits.\n5. Variations: Any scope changes quoted separately, require written approval before execution.\n6. Warranty: Workmanship warranty of 6 months from completion against manufacturing defects.\n7. Force majeure: HG not liable for delays from weather, mall restrictions, or third-party works.\n8. Insurance: Public liability coverage included as per HG Group standard policy.')
on conflict (key) do nothing;

-- ─── 6 · SEED — 28-material catalog from HG Metal Deck Calculator (3).xlsx ──
insert into hrd_materials (code, type, size, thickness, bar_qty, unit, cost_price, markup, updated_by) values
  ('MS-25x25x2.8','MS Square Hollow','25x25',2.8,6,'m',18,0.4,'seed'),
  ('MS-38x38x2.8','MS Square Hollow','38x38',2.8,6,'m',26.5,0.4,'seed'),
  ('MS-50x50x2.8','MS Square Hollow','50x50',2.8,6,'m',39,0.4,'seed'),
  ('MS-100x100x2.3','MS Square Hollow','100x100',2.3,6,'m',111,0.4,'seed'),
  ('MS-150x150x3','MS Square Hollow','150x150',3,6,'m',272,0.4,'seed'),
  ('MS-150x100x3','MS Rect Hollow','150x100',3,6,'m',200,0.4,'seed'),
  ('MS-100x75x3','MS Rect Hollow','100x75',3,6,'m',120,0.4,'seed'),
  ('MS-50x100x6','MS Rect Hollow','50x100',6,6,'m',233,0.4,'seed'),
  ('MS-65x38x3','MS Rect Hollow','65x38',3,6,'m',73,0.4,'seed'),
  ('MS-50x50x6','MS Square Hollow','50x50',6,6,'m',193,0.4,'seed'),
  ('MS-25x25x1','MS Square Hollow','25x25',1,6,'m',12,0.4,'seed'),
  ('MS-38x38x1.6','MS Square Hollow','38x38',1.6,6,'m',28.5,0.4,'seed'),
  ('MS-25x50x1.5','MS Rect Hollow','25x50',1.5,6,'m',26,0.4,'seed'),
  ('MS-50x50x1.5','MS Square Hollow','50x50',1.5,6,'m',38,0.4,'seed'),
  ('MS-50x75x1.5','MS Rect Hollow','50x75',1.5,6,'m',48,0.4,'seed'),
  ('MS-75x75x1.6','MS Square Hollow','75x75',1.6,6,'m',59,0.4,'seed'),
  ('MS-75x75x4','MS Square Hollow','75x75',4,6,'m',155,0.4,'seed'),
  ('MS-100x75x1.9','MS Rect Hollow','100x75',1.9,6,'m',79,0.4,'seed'),
  ('MS-50x50x5','MS Square Solid','50x50',5,6,'m',205.71,0.4,'seed'),
  ('GI-4x8-0.4','GI Sheet','4x8 ft',0.4,32,'sqft',52,0.4,'seed'),
  ('BASE-200x200x5','MS Base Plate','200x200',5,1,'nos',28,0.4,'seed'),
  ('DECK-0.23','Metal Deck','762mm x 8ft',0.23,20,'sqft',21.2,0.4,'seed'),
  ('DECK-0.35','Metal Deck','762mm x 8ft',0.35,20,'sqft',42,0.4,'seed'),
  ('DECK-0.48','Metal Deck','762mm x 8ft',0.48,20,'sqft',46,0.4,'seed'),
  ('FOOTING-3000x300x600','Concrete Footing','3000x300x600',null,1,'nos',35,0.4,'seed'),
  ('FOOTING-450x450x750','Concrete Footing','450x450x750',null,1,'nos',40,0.4,'seed'),
  ('BESI-BIRU-0.45x121','Besi Biru','0.45x121',0.75,6,'m',15,0.4,'seed'),
  ('BESI-BIRU-0.73x153','Besi Biru','0.73x153',1.55,6,'m',25,0.4,'seed')
on conflict (code) do nothing;

-- ─── 7 · ROW-LEVEL SECURITY ─────────────────────────────────────────────────
alter table hrd_materials       enable row level security;
alter table hrd_quotes          enable row level security;
alter table hrd_supplier_prices enable row level security;
alter table hrd_price_history   enable row level security;
alter table hrd_config          enable row level security;

do $$
declare t text;
begin
  foreach t in array array['hrd_materials','hrd_quotes','hrd_supplier_prices','hrd_price_history','hrd_config'] loop
    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format('create policy %I_rw on %I for all to authenticated using (is_allowed()) with check (is_allowed())', t, t);
  end loop;
end $$;

-- ─── 8 · HELPERS ────────────────────────────────────────────────────────────
create or replace function hrd_cfg(p_key text) returns text
language sql stable security definer set search_path = public as $$
  select value from hrd_config where key = p_key;
$$;

-- clientRate = (costPrice / barQty when barQty≠0 else costPrice) × (1 + markup)
-- (exact port of withRates_ in Code.gs; missing material → rate 0)
create or replace function hrd_client_rate(p_code text) returns double precision
language sql stable security definer set search_path = public as $$
  select coalesce((
    select (case when coalesce(bar_qty,0) <> 0 then cost_price / bar_qty else cost_price end)
           * (1 + coalesce(markup,0))
    from hrd_materials where code = p_code
  )::double precision, 0);
$$;

create or replace function hrd_unit_of(p_code text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select unit from hrd_materials where code = p_code), '');
$$;

-- roundUp_(x) = Math.ceil(x - 1e-9)  — exact port
create or replace function hrd_roundup(x double precision) returns double precision
language sql immutable as $$ select ceil(x - 1e-9); $$;

-- one costing line { item, code, rate, sub, qty, unit, total: sub*qty }
create or replace function hrd_line(p_item text, p_code text, p_rate double precision,
  p_sub double precision, p_qty double precision, p_unit text) returns jsonb
language sql immutable as $$
  select jsonb_build_object('item',p_item,'code',p_code,'rate',p_rate,'sub',p_sub,
                            'qty',p_qty,'unit',p_unit,'total',p_sub*p_qty);
$$;

-- ─── 9 · SAVE QUOTE RPC — authoritative server-side recompute ────────────────
-- Exact port of computeQuote_ + saveQuote in Code.gs. Rates are resolved from
-- the LIVE hrd_materials catalog and the full snapshot (inputs, lines, metrics)
-- is frozen into hrd_quotes.data — editing material prices later never changes
-- a saved quote.
-- VERIFIED TEST CASE (Excel port): inputs L=160, H=2.4, CC=3, doors=1,
-- horizLines=3, footPerPost=2, pInstall=8, pFab=15, gateDays=2, sqftF=11.16,
-- gStruct=40.8, gPanel=155, gPosts=2, gFoot=4, oXbrace=0, post=MS-50x75x1.5,
-- horiz=MS-50x50x1.5, panel=DECK-0.23, footing=FOOTING-450x450x750, seed rates
-- → hoarding_total 47,860.14 · gate_total 5,740.26 · subtotal 53,600.39.
-- payload: { id?, quoteNo?, date?, client, contact, project, mall, lot,
--            location, validity, status, inputs:{...builder form...} }
create or replace function hrd_save_quote(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  i jsonb := coalesce(payload->'inputs', '{}'::jsonb);
  -- inputs (double precision = IEEE-754 doubles, same maths as the JS/Excel engine)
  v_length double precision := coalesce(nullif(i->>'length','')::double precision, 0);
  v_height double precision := coalesce(nullif(i->>'height','')::double precision, 0);
  v_cc     double precision;
  v_doors  double precision := coalesce(nullif(i->>'doors','')::double precision, 0);
  v_horiz_lines   double precision := coalesce(nullif(i->>'horizLines','')::double precision, 0);
  v_foot_per_post double precision := coalesce(nullif(i->>'footPerPost','')::double precision, 0);
  v_p_install double precision;
  v_p_fab     double precision;
  v_gate_days double precision := coalesce(nullif(i->>'gateDays','')::double precision, 0);
  v_sqft_f   double precision := coalesce(nullif(i->>'sqftF','')::double precision, 0);
  v_g_struct double precision := coalesce(nullif(i->>'gStruct','')::double precision, 0);
  v_g_panel  double precision := coalesce(nullif(i->>'gPanel','')::double precision, 0);
  v_g_posts  double precision := coalesce(nullif(i->>'gPosts','')::double precision, 0);
  v_g_foot   double precision := coalesce(nullif(i->>'gFoot','')::double precision, 0);
  v_o_xbrace double precision := coalesce(nullif(i->>'oXbrace','')::double precision, 0);
  v_xbrace_len double precision;
  v_l_fab_post double precision := coalesce(nullif(i->>'lFabPost','')::double precision, 0);
  v_l_prelim   double precision := coalesce(nullif(i->>'lPrelim','')::double precision, 0);
  v_l_install  double precision := coalesce(nullif(i->>'lInstall','')::double precision, 0);
  v_l_fab_gate double precision := coalesce(nullif(i->>'lFabGate','')::double precision, 0);
  v_l_install_gate double precision := coalesce(nullif(i->>'lInstallGate','')::double precision, 0);
  v_sst_pct double precision := coalesce(nullif(i->>'sst','')::double precision, 0);
  -- category-driven material selection (backward compatible with old
  -- cladding/fixed-code quotes, same fallback chain as Code.gs)
  v_post_code  text := coalesce(i->>'postCode','');
  v_horiz_code text := coalesce(i->>'horizCode','');
  v_panel_code text;
  v_found_code text;
  v_deck_gate  text;
  v_xbrace_code text;
  -- derived
  post_per_post double precision;
  posts double precision; install_days double precision; fab_days double precision;
  deck_sqft double precision;
  r_post double precision; r_horiz double precision;
  "H" jsonb := '[]'::jsonb; "G" jsonb := '[]'::jsonb;
  hoard_total double precision; gate_total double precision;
  v_sub double precision; v_sst_amt double precision; v_grand double precision;
  v_metrics jsonb; v_data jsonb;
  -- record plumbing
  v_id uuid; v_existing hrd_quotes%rowtype; v_found boolean := false;
  v_quoteno text; v_status text; v_date date;
  v_prefix text; v_year text := to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY');
  v_seq int; v_cur int; v_used int; v_m text;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  if coalesce(payload->>'client','') = '' then raise exception 'Client name is required.'; end if;

  -- n(i.cc)||1 / n(i.pInstall)||1 / n(i.pFab)||1
  v_cc := coalesce(nullif(i->>'cc','')::double precision, 0);
  if v_cc = 0 then v_cc := 1; end if;
  v_p_install := coalesce(nullif(i->>'pInstall','')::double precision, 0);
  if v_p_install = 0 then v_p_install := 1; end if;
  v_p_fab := coalesce(nullif(i->>'pFab','')::double precision, 0);
  if v_p_fab = 0 then v_p_fab := 1; end if;

  v_xbrace_len := coalesce(nullif(i->>'xbraceLen','')::double precision,
                           coalesce(nullif(hrd_cfg('XBRACE_LEN'),'')::double precision, 10.8));

  v_panel_code := coalesce(nullif(i->>'panelCode',''),
    case when i->>'cladding' = 'gi'
         then coalesce(nullif(i->>'giCode',''), hrd_cfg('CODE_GI'))
         else coalesce(nullif(i->>'deckMain',''), hrd_cfg('CODE_DECK_MAIN')) end);
  v_found_code  := coalesce(nullif(i->>'foundCode',''), nullif(i->>'footCode',''), hrd_cfg('CODE_FOOTING'));
  v_deck_gate   := coalesce(nullif(i->>'deckGate',''), hrd_cfg('CODE_DECK_GATE'));
  v_xbrace_code := coalesce(nullif(i->>'xbraceCode',''), hrd_cfg('CODE_XBRACE'));

  -- ═══ CALC ENGINE (do not change — exact Excel port) ═══
  post_per_post := 2 * sqrt(power(v_height - 0.3, 2) + power(1.2, 2)) + 2.1;
  posts        := hrd_roundup(v_length / v_cc);
  install_days := hrd_roundup(posts / v_p_install);
  fab_days     := hrd_roundup(posts / v_p_fab);
  deck_sqft    := hrd_roundup(v_length * v_height * v_sqft_f);
  r_post  := hrd_client_rate(v_post_code);
  r_horiz := hrd_client_rate(v_horiz_code);

  "H" := "H" || hrd_line('Vertical Post + Brace', v_post_code, r_post, post_per_post * r_post, posts, 'set');
  "H" := "H" || hrd_line('Horizontal', v_horiz_code, r_horiz, r_horiz, v_length * v_horiz_lines, 'm');
  "H" := "H" || hrd_line('Labor Fabrication (Post)', '—', v_l_fab_post, v_l_fab_post, posts, 'set');
  "H" := "H" || hrd_line('Preliminaries', '—', v_l_prelim, v_l_prelim, install_days, 'day');
  "H" := "H" || hrd_line('Labor Installation (Onsite)', '—', v_l_install, v_l_install, install_days, 'day');
  "H" := "H" || hrd_line('Hoarding Panel', v_panel_code, hrd_client_rate(v_panel_code), hrd_client_rate(v_panel_code), deck_sqft, hrd_unit_of(v_panel_code));
  "H" := "H" || hrd_line('Base / Footing', v_found_code, hrd_client_rate(v_found_code), hrd_client_rate(v_found_code), posts * v_foot_per_post, hrd_unit_of(v_found_code));
  "H" := "H" || hrd_line('ADD ON: X Brace', v_xbrace_code, hrd_client_rate(v_xbrace_code), v_xbrace_len * hrd_client_rate(v_xbrace_code), v_o_xbrace, 'set');
  select coalesce(sum((e->>'total')::double precision), 0) into hoard_total from jsonb_array_elements("H") e;

  "G" := "G" || hrd_line('Gate Post', v_post_code, r_post, post_per_post * r_post, v_doors * v_g_posts, 'nos');
  "G" := "G" || hrd_line('Gate Structure', v_horiz_code, r_horiz, r_horiz, v_doors * v_g_struct, 'm');
  "G" := "G" || hrd_line('Gate Panel', v_deck_gate, hrd_client_rate(v_deck_gate), hrd_client_rate(v_deck_gate), v_doors * v_g_panel, hrd_unit_of(v_deck_gate));
  "G" := "G" || hrd_line('Base / Footing (Gate)', v_found_code, hrd_client_rate(v_found_code), hrd_client_rate(v_found_code), v_doors * v_g_foot, hrd_unit_of(v_found_code));
  "G" := "G" || hrd_line('Labor Fabrication (Post-Gate)', '—', v_l_fab_post, v_l_fab_post, v_doors * v_g_posts, 'nos');
  "G" := "G" || hrd_line('Labor Fabrication (Gate)', '—', v_l_fab_gate, v_l_fab_gate, v_doors, 'nos');
  "G" := "G" || hrd_line('Labor Installation (Gate Onsite)', '—', v_l_install_gate, v_l_install_gate, v_doors * v_gate_days, 'day');
  select coalesce(sum((e->>'total')::double precision), 0) into gate_total from jsonb_array_elements("G") e;

  v_sub     := hoard_total + gate_total;
  v_sst_amt := v_sub * (v_sst_pct / 100);
  v_grand   := v_sub + v_sst_amt;
  -- ═══ end calc engine ═══

  v_metrics := jsonb_build_object(
    'posts', posts, 'postPerPost', post_per_post, 'vert', posts * post_per_post,
    'horiz', v_length * v_horiz_lines, 'foot', posts * v_foot_per_post,
    'sqft', deck_sqft, 'installDays', install_days, 'fabDays', fab_days,
    'projectDays', greatest(install_days, fab_days) + v_doors * v_gate_days);
  v_data := jsonb_build_object('inputs', i, 'lines', jsonb_build_object('H', "H", 'G', "G"), 'metrics', v_metrics);

  v_status := case when payload->>'status' in ('Draft','Sent','Won','Lost')
                   then payload->>'status' else 'Draft' end;
  v_date := coalesce(nullif(payload->>'date','')::date,
                     (now() at time zone 'Asia/Kuala_Lumpur')::date);

  -- existing record?
  if coalesce(payload->>'id','') <> '' then
    select * into v_existing from hrd_quotes where id = (payload->>'id')::uuid;
    if not found then raise exception 'Quote not found.'; end if;
    v_found := true;
  end if;

  -- quote number: given > existing > next sequential PREFIX-YYYY-### (skips used)
  v_quoteno := nullif(payload->>'quoteNo','');
  if v_quoteno is null and v_found then v_quoteno := v_existing.quote_no; end if;
  if v_quoteno is null then
    v_prefix := coalesce(nullif(hrd_cfg('QUOTE_PREFIX'),''), 'HG-Q-');
    v_seq := coalesce(nullif(hrd_cfg('QUOTE_SEQ'),'')::int, 0);
    loop
      v_seq := v_seq + 1;
      v_quoteno := v_prefix || v_year || '-' || lpad(v_seq::text, 3, '0');
      exit when not exists (select 1 from hrd_quotes where lower(quote_no) = lower(v_quoteno));
    end loop;
  end if;

  if v_found then
    update hrd_quotes set
      quote_no = v_quoteno, quote_date = v_date,
      client = payload->>'client', contact = coalesce(payload->>'contact',''),
      project = coalesce(payload->>'project',''), mall = coalesce(payload->>'mall',''),
      lot = coalesce(payload->>'lot',''), location = coalesce(payload->>'location',''),
      validity = coalesce(nullif(payload->>'validity','')::numeric, 0), status = v_status,
      length = round(v_length::numeric, 4), height = round(v_height::numeric, 4), doors = round(v_doors::numeric, 4),
      hoarding_total = round(hoard_total::numeric, 2), gate_total = round(gate_total::numeric, 2),
      subtotal = round(v_sub::numeric, 2), sst_pct = round(v_sst_pct::numeric, 4),
      sst_amount = round(v_sst_amt::numeric, 2), grand_total = round(v_grand::numeric, 2),
      data = v_data, updated_by = current_email(), updated_at = now()
    where id = v_existing.id
    returning id into v_id;
    perform log_audit('HRD UPDATE Quote',
      v_quoteno || ' · ' || (payload->>'client') || ' / RM ' || to_char(round(v_grand::numeric,2), 'FM999,999,999,990.00'));
  else
    insert into hrd_quotes (quote_no, quote_date, client, contact, project, mall, lot, location,
      validity, status, length, height, doors, hoarding_total, gate_total, subtotal,
      sst_pct, sst_amount, grand_total, data, created_by, updated_by)
    values (v_quoteno, v_date, payload->>'client', coalesce(payload->>'contact',''),
      coalesce(payload->>'project',''), coalesce(payload->>'mall',''),
      coalesce(payload->>'lot',''), coalesce(payload->>'location',''),
      coalesce(nullif(payload->>'validity','')::numeric, 0), v_status,
      round(v_length::numeric,4), round(v_height::numeric,4), round(v_doors::numeric,4),
      round(hoard_total::numeric,2), round(gate_total::numeric,2), round(v_sub::numeric,2),
      round(v_sst_pct::numeric,4), round(v_sst_amt::numeric,2), round(v_grand::numeric,2),
      v_data, current_email(), current_email())
    returning id into v_id;
    -- bumpQuoteSeq_: trailing digits of the number used, if > stored QUOTE_SEQ
    v_m := substring(v_quoteno from '(\d+)\s*$');
    if v_m is not null then
      v_cur := coalesce(nullif(hrd_cfg('QUOTE_SEQ'),'')::int, 0);
      v_used := v_m::int;
      if v_used > v_cur then
        insert into hrd_config (key, value) values ('QUOTE_SEQ', v_used::text)
        on conflict (key) do update set value = excluded.value;
      end if;
    end if;
    perform log_audit('HRD CREATE Quote',
      v_quoteno || ' · ' || (payload->>'client') || ' / RM ' || to_char(round(v_grand::numeric,2), 'FM999,999,999,990.00'));
  end if;

  return jsonb_build_object('id', v_id, 'quote_no', v_quoteno);
end;
$$;

-- ─── 10 · MATERIAL PRICE EDIT RPC (atomic: update + history + audit) ─────────
create or replace function hrd_edit_material_price(p_code text, p_field text, p_value numeric, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_old numeric; v_new numeric;
  v_old_disp numeric; v_new_disp numeric; v_field_disp text;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  if p_field not in ('costPrice','markup') then raise exception 'Bad field.'; end if;
  v_new := coalesce(p_value, 0);
  if p_field = 'markup' then v_new := v_new / 100; end if;  -- form sends % (40), store fraction (0.4)
  select case when p_field = 'markup' then coalesce(markup,0) else coalesce(cost_price,0) end
    into v_old from hrd_materials where code = p_code;
  if not found then raise exception 'Material not found.'; end if;
  if abs(v_old - v_new) < 1e-9 then return; end if;
  if p_field = 'markup' then
    update hrd_materials set markup = v_new, updated_at = now(), updated_by = current_email() where code = p_code;
    v_old_disp := v_old * 100; v_new_disp := v_new * 100; v_field_disp := 'Markup %';
  else
    update hrd_materials set cost_price = v_new, updated_at = now(), updated_by = current_email() where code = p_code;
    v_old_disp := v_old; v_new_disp := v_new; v_field_disp := 'Cost Price';
  end if;
  insert into hrd_price_history (code, field, old_val, new_val, user_email, reason)
  values (p_code, v_field_disp, v_old_disp, v_new_disp, current_email(), coalesce(p_reason,''));
  perform log_audit('HRD PRICE-CHANGE Material',
    p_code || ' · ' ||
    case when p_field = 'markup' then v_old_disp || '% -> ' || v_new_disp || '%'
         else 'RM' || v_old_disp || ' -> RM' || v_new_disp end ||
    case when coalesce(p_reason,'') <> '' then ' (' || p_reason || ')' else '' end);
end;
$$;

-- ─── 11 · APPLY SUPPLIER PRICE → CATALOG RPC (logs a price change too) ───────
create or replace function hrd_apply_supplier(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  s hrd_supplier_prices%rowtype;
  v_old numeric;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  select * into s from hrd_supplier_prices where id = p_id;
  if not found then raise exception 'Supplier price not found.'; end if;
  select coalesce(cost_price,0) into v_old from hrd_materials where code = s.code;
  if not found then raise exception 'Material % not in catalog.', s.code; end if;
  update hrd_materials set cost_price = s.cost_price, updated_at = now(), updated_by = current_email()
  where code = s.code;
  insert into hrd_price_history (code, field, old_val, new_val, user_email, reason)
  values (s.code, 'Cost Price', v_old, s.cost_price, current_email(), 'Applied supplier: ' || s.supplier);
  perform log_audit('HRD PRICE-CHANGE Material',
    s.code || ' · RM' || v_old || ' -> RM' || s.cost_price || ' (supplier ' || s.supplier || ')');
end;
$$;

-- Done. No storage bucket (the GAS app stores no files) and no hrd_alarms view
-- (the GAS app has no scheduled email digests).
