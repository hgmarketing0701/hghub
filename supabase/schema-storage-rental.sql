-- ============================================================================
-- HG GROUP — TEMPORARY STORAGE RENTAL · Supabase schema (prefix: str_)
-- Converted from apps-script-storage (Google Apps Script + Sheets + Drive).
-- Run AFTER the foundation schema (supabase/schema.sql). Safe to re-run:
-- everything is IF NOT EXISTS / ON CONFLICT DO NOTHING / CREATE OR REPLACE.
--
-- Creates:
--   str_lots / str_rentals / str_invoices / str_payments / str_config
--   str_generate_monthly()  — atomic auto monthly invoicing RPC (STR-#### numbers)
--   str_alarms              — view read by the daily-alarms Edge Function + the UI
--   storage bucket 'storage-items' (item photos, signed agreements, invoice files)
--   RLS on every table (allowlist-gated via is_allowed())
-- Uses (never redefines): allowed_users, is_allowed(), is_admin(), current_email(),
--                         log_audit(), audit_log, app_settings.
-- ============================================================================

-- ─── 1 · LOTS (inventory from the floor plans) ──────────────────────────────
create table if not exists str_lots (
  id         text primary key,               -- e.g. 'A-01'
  zone       text default '',
  floor      text default '',
  type       text default 'Standard',        -- Standard / Small / Large
  lockset    text default '',
  width_mm   numeric default 0,
  depth_mm   numeric default 0,
  area_sqm   numeric,
  notes      text default '',
  updated_at timestamptz default now()
);

-- ─── 2 · RENTALS / ENGAGEMENTS (client + internal HG use) ───────────────────
create table if not exists str_rentals (
  id                text primary key default replace(gen_random_uuid()::text,'-',''),
  engagement_type   text not null default 'Client',   -- Client / Internal
  lot_id            text not null default '',
  client_company    text default '',
  department        text default '',                  -- HG dept (internal use)
  client_pic        text default '',
  client_contact    text default '',
  client_email      text default '',
  start_date        date,
  end_date          date,                             -- null = open-ended (internal)
  monthly_rate      numeric default 0,
  deposit           numeric default 0,
  deposit_status    text default 'None',              -- None / Held / Refunded
  status            text default 'Active',            -- Active/Expiring/Expired/Vacated/SoldOff/Internal/Released
  notice1_sent      text default '',                  -- stamped by daily-alarms Edge Function
  notice2_sent      text default '',
  agreement_signed  text default '',                  -- '' / Yes / Pending
  cctv_no           text default '',
  cctv_url          text default '',
  items_description text default '',
  photos_url        text default '',                  -- pasted external links (comma-separated)
  photo_paths       text default '',                  -- storage-items paths (comma-separated)
  agreement_path    text default '',                  -- storage-items path of signed agreement
  handled_by        text default '',
  remarks           text default '',
  created_by        text default '',
  created_at        timestamptz default now(),
  updated_by        text default '',
  updated_at        timestamptz default now()
);
create index if not exists idx_str_rentals_lot on str_rentals (lot_id);

-- ─── 3 · INVOICES (with SST) ────────────────────────────────────────────────
create table if not exists str_invoices (
  id             uuid primary key default gen_random_uuid(),
  inv_no         text not null,
  rental_id      text references str_rentals(id),     -- null = manual / unlinked
  lot_id         text default '',
  client_company text not null,
  inv_date       date not null,
  due_date       date,
  period_from    date,
  period_to      date,
  description    text default '',
  amount         numeric not null default 0,
  sst_enabled    boolean default false,
  sst_amount     numeric not null default 0,
  total          numeric not null default 0,
  status         text default '',                     -- '' (live) or 'Void'
  file_path      text default '',                     -- storage-items path (PDF/image)
  notes          text default '',
  created_by     text default '',
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create unique index if not exists idx_str_invoices_no on str_invoices (lower(inv_no));
create index if not exists idx_str_invoices_rental on str_invoices (rental_id);

-- ─── 4 · PAYMENTS ───────────────────────────────────────────────────────────
create table if not exists str_payments (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references str_invoices(id) on delete cascade,
  pay_date    date not null,
  amount      numeric not null default 0,
  method      text default '',
  reference   text default '',
  received_by text default '',
  notes       text default '',
  created_by  text default '',
  created_at  timestamptz default now()
);
create index if not exists idx_str_payments_inv on str_payments (invoice_id);

-- ─── 5 · CONFIG (same keys as the GAS Config sheet) ─────────────────────────
create table if not exists str_config (
  key   text primary key,
  value text default ''
);
insert into str_config (key, value) values
  ('NOTICE1_DAYS',          '30'),
  ('NOTICE2_DAYS',          '7'),
  ('INVOICE_DUE_SOON_DAYS', '5'),
  ('NEW_CLIENT_DAYS',       '60'),
  ('REMINDER_TO',           ''),
  ('COMPANY_NAME',          'HG Group'),
  ('COMPANY_REG',           ''),
  ('COMPANY_ADDRESS',       ''),
  ('COMPANY_PHONE',         ''),
  ('SST_NO',                ''),
  ('INVOICE_PREFIX',        'STR-'),
  ('INVOICE_SEQ',           '0'),
  ('INVOICE_TERMS_DAYS',    '7'),
  ('AUTO_INVOICE_SST',      '1')
on conflict (key) do nothing;

-- ─── 6 · SEED THE 32 LOTS FROM THE FLOOR PLANS (same as GAS setupSystem) ────
insert into str_lots (id, zone, floor, type, lockset, width_mm, depth_mm, area_sqm, notes)
select v.id, v.zone, v.floor, v.type, v.lockset, v.w, v.d,
       case when v.w > 0 and v.d > 0 then round(v.w * v.d / 1e6, 2) end,
       v.notes
from (values
  ('A-01','A','Ground','Standard','34579',6000::numeric,6000::numeric,'verify dimensions on site'),
  ('A-02','A','Ground','Standard','24679',6000,6000,'verify dimensions on site'),
  ('A-03','A','Ground','Standard','23568',6000,6000,'verify dimensions on site'),
  ('A-04','A','Ground','Standard','25789',6000,6000,'labelled "ZONE A B04"; verify dimensions on site'),
  ('A-05','A','Ground','Standard','24590',6000,6000,'lockset 24590 also on B-S01 — confirm'),
  ('A-06','A','Ground','Standard','24567',6000,6000,'verify dimensions on site'),
  ('A-07','A','Ground','Standard','12340',6000,6000,'verify dimensions on site'),
  ('A-08','A','Ground','Standard','45890',6000,6000,'verify dimensions on site'),
  ('A-09','A','Ground','Standard','12690',6000,6000,'verify dimensions on site'),
  ('B-01','B','Level 1','Standard','26790',6000,6000,''),
  ('B-02','B','Level 1','Standard','24568',6000,6000,''),
  ('B-03','B','Level 1','Standard','12578',6000,6000,''),
  ('B-04','B','Level 1','Standard','13569',6000,6000,''),
  ('B-05','B','Level 1','Standard','23569',6000,6000,''),
  ('B-S01','B','Level 1','Small','24590',0,0,'lockset 24590 also on A-05 — confirm; verify dimensions on site'),
  ('B-S02','B','Level 1','Small','13789',0,0,'verify dimensions on site'),
  ('B-S03','B','Level 1','Small','26890',0,0,'verify dimensions on site'),
  ('B-S04','B','Level 1','Small','36789',0,0,'verify dimensions on site'),
  ('B-S05','B','Level 1','Small','24689',0,0,'verify dimensions on site'),
  ('B-S06','B','Level 1','Small','24789',0,0,'verify dimensions on site'),
  ('B-S07','B','Level 1','Small','24578',0,0,'verify dimensions on site'),
  ('C-01','C','Level 1','Standard','12689',4765,4700,''),
  ('C-02','C','Level 1','Standard','13568',6000,4700,''),
  ('C-03','C','Level 1','Large','12457',6000,7000,''),
  ('C-04','C','Level 1','Standard','24680',6000,4770,''),
  ('D-01','D','Level 2','Standard','23590',6000,6000,''),
  ('D-02','D','Level 2','Standard','23670',6000,6000,''),
  ('D-03','D','Level 2','Standard','35790',6000,6000,''),
  ('D-S01','D','Level 2','Small','36780',6000,3000,''),
  ('D-S02','D','Level 2','Standard','34578',8500,3000,''),
  ('D-S03','D','Level 2','Small','25680',3000,6000,''),
  ('D-S04','D','Level 2','Small','13680',4000,6000,'')
) as v(id, zone, floor, type, lockset, w, d, notes)
on conflict (id) do nothing;

-- ─── 7 · AUTO MONTHLY INVOICING RPC (was generateMonthlyInvoices/genMonthly_) ─
-- One invoice per active CLIENT rental with monthly_rate > 0, for the month.
-- Skips internal use, terminated rentals, rentals not active in that month, and
-- rentals already invoiced for the same period. Sequential STR-#### numbers via
-- str_config INVOICE_SEQ — atomic, server-side, never trusts the client.
create or replace function str_generate_monthly(p_month text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_from    date;
  v_to      date;
  v_terms   int;
  v_due     date;
  v_autosst boolean;
  v_sstrate numeric := 0.06;
  v_prefix  text;
  v_seq     int;
  v_no      text;
  v_amount  numeric; v_sst numeric; v_total numeric;
  v_count   int := 0;
  v_created jsonb := '[]'::jsonb;
  v_today   date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_label   text;
  r         record;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'Month must be YYYY-MM.'; end if;

  v_from := (p_month || '-01')::date;
  v_to   := (v_from + interval '1 month' - interval '1 day')::date;
  select coalesce(nullif(value,'')::int, 7)  into v_terms   from str_config where key = 'INVOICE_TERMS_DAYS';
  v_terms := coalesce(v_terms, 7);
  v_due := v_from + v_terms;
  select coalesce(value,'1') in ('1','true','TRUE') into v_autosst from str_config where key = 'AUTO_INVOICE_SST';
  v_autosst := coalesce(v_autosst, true);
  select coalesce(nullif(value,''), 'STR-') into v_prefix from str_config where key = 'INVOICE_PREFIX';
  v_prefix := coalesce(v_prefix, 'STR-');
  select coalesce(nullif(value,'')::int, 0) into v_seq from str_config where key = 'INVOICE_SEQ';
  v_seq := coalesce(v_seq, 0);
  v_label := to_char(v_from, 'Mon YYYY');

  for r in
    select * from str_rentals
    where engagement_type <> 'Internal'
      and status not in ('Vacated','SoldOff','Released')
      and coalesce(monthly_rate, 0) > 0
      and (start_date is null or start_date <= v_to)
      and (end_date   is null or end_date   >= v_from)
    order by lot_id
  loop
    if exists (select 1 from str_invoices i
               where i.rental_id = r.id and i.period_from = v_from and i.status <> 'Void') then
      continue;
    end if;
    -- next unused sequential number
    loop
      v_seq := v_seq + 1;
      v_no := v_prefix || lpad(v_seq::text, 4, '0');
      exit when not exists (select 1 from str_invoices where lower(inv_no) = lower(v_no));
    end loop;
    v_amount := round(r.monthly_rate, 2);
    v_sst    := case when v_autosst then round(v_amount * v_sstrate, 2) else 0 end;
    v_total  := round(v_amount + v_sst, 2);
    insert into str_invoices (inv_no, rental_id, lot_id, client_company, inv_date, due_date,
                              period_from, period_to, description, amount, sst_enabled,
                              sst_amount, total, status, notes, created_by)
    values (v_no, r.id, r.lot_id, r.client_company, v_today, v_due, v_from, v_to,
            'Storage rental — Lot ' || r.lot_id || ' · ' || v_label,
            v_amount, v_autosst, v_sst, v_total, '', 'Auto-generated', 'auto/' || current_email());
    v_count := v_count + 1;
    v_created := v_created || to_jsonb(v_no || ' · ' || r.client_company || ' (Lot ' || r.lot_id || ')');
    perform log_audit('AUTO_INVOICE', v_no || ' · ' || r.client_company || ' · ' || v_label || ' · RM' || v_total);
  end loop;

  update str_config set value = v_seq::text where key = 'INVOICE_SEQ';
  insert into str_config (key, value)
    select 'INVOICE_SEQ', v_seq::text
    where not exists (select 1 from str_config where key = 'INVOICE_SEQ');

  return jsonb_build_object('month', p_month, 'count', v_count, 'created', v_created);
end;
$$;

-- ─── 8 · ALARMS VIEW (read by daily-alarms Edge Function + shown in the UI) ──
-- Was the GAS runDailyReminders 2-notice renewal engine + overdue-invoice nudges.
-- Columns per convention: alarm_type, ref, detail, due_date, recipient.
create or replace view str_alarms with (security_invoker = on) as
with cfg as (
  select
    coalesce((select nullif(value,'')::int from str_config where key = 'NOTICE1_DAYS'), 30)          as n1,
    coalesce((select nullif(value,'')::int from str_config where key = 'NOTICE2_DAYS'), 7)           as n2,
    coalesce((select nullif(value,'')::int from str_config where key = 'INVOICE_DUE_SOON_DAYS'), 5)  as due_soon,
    coalesce((select nullif(value,'')     from str_config where key = 'REMINDER_TO'), '')            as reminder_to
),
today as (select (now() at time zone 'Asia/Kuala_Lumpur')::date as d)
select * from (
  -- rentals: expiring within NOTICE1_DAYS, or already expired (sell-off decision)
  select
    case when r.end_date < t.d then 'RENTAL_EXPIRED'
         when (r.end_date - t.d) <= c.n2 then 'RENTAL_NOTICE2'
         else 'RENTAL_NOTICE1' end                                     as alarm_type,
    'Lot ' || r.lot_id || ' · ' || r.client_company                    as ref,
    case when r.end_date < t.d
      then 'Expired ' || (t.d - r.end_date) || 'd ago — no renewal. Decide: renew / sell-off (items become HG). N1: '
           || coalesce(nullif(r.notice1_sent,''),'—') || ' · N2: ' || coalesce(nullif(r.notice2_sent,''),'—')
      else 'Expires in ' || (r.end_date - t.d) || 'd (' || r.start_date || ' → ' || r.end_date
           || '). N1: ' || coalesce(nullif(r.notice1_sent,''),'—')
           || ' · N2: ' || coalesce(nullif(r.notice2_sent,''),'—')
           || case when r.client_pic <> '' then ' · PIC: ' || r.client_pic else '' end end as detail,
    r.end_date                                                         as due_date,
    case when c.reminder_to <> '' then c.reminder_to
         when r.handled_by ~ '^\S+@\S+\.\S+$' then r.handled_by
         else coalesce(r.created_by, '') end                           as recipient
  from str_rentals r, cfg c, today t
  where r.engagement_type <> 'Internal'
    and r.status not in ('Vacated','SoldOff','Released')
    and r.end_date is not null
    and (r.end_date - t.d) <= c.n1

  union all

  -- invoices: unpaid balance, due soon or overdue
  select
    case when i.due_date < t.d then 'INVOICE_OVERDUE' else 'INVOICE_DUE' end,
    i.inv_no || ' · ' || i.client_company,
    'Balance RM ' || to_char(round(i.total - coalesce(p.paid, 0), 2), 'FM999,999,990.00')
      || ' (total RM ' || to_char(i.total, 'FM999,999,990.00') || ')'
      || case when i.due_date < t.d then ' — overdue ' || (t.d - i.due_date) || 'd'
              else ' — due in ' || (i.due_date - t.d) || 'd' end,
    i.due_date,
    case when c.reminder_to <> '' then c.reminder_to else coalesce(i.created_by, '') end
  from str_invoices i
  left join lateral (select round(sum(amount), 2) as paid
                     from str_payments where invoice_id = i.id) p on true,
       cfg c, today t
  where i.status <> 'Void'
    and i.due_date is not null
    and (i.total - coalesce(p.paid, 0)) > 0.005
    and (i.due_date - t.d) <= c.due_soon
) a
order by due_date;

-- ─── 9 · STORAGE BUCKET (replaces the Google Drive folders) ─────────────────
-- storage-items/photos/…     — item photos at intake
-- storage-items/agreements/… — signed agreement scans
-- storage-items/invoices/…   — invoice PDFs/images
insert into storage.buckets (id, name, public) values ('storage-items','storage-items', false)
on conflict (id) do nothing;
drop policy if exists "storage-items_rw" on storage.objects;
create policy "storage-items_rw" on storage.objects for all to authenticated
  using (bucket_id = 'storage-items' and is_allowed())
  with check (bucket_id = 'storage-items' and is_allowed());

-- ─── 10 · ROW-LEVEL SECURITY (allowlist-gated everything) ───────────────────
alter table str_lots     enable row level security;
alter table str_rentals  enable row level security;
alter table str_invoices enable row level security;
alter table str_payments enable row level security;
alter table str_config   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['str_lots','str_rentals','str_invoices','str_payments','str_config'] loop
    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format('create policy %I_rw on %I for all to authenticated using (is_allowed()) with check (is_allowed())', t, t);
  end loop;
end $$;

-- Done. Open storage-rental-supabase.html, connect, sign in.
