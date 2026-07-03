-- ============================================================================
-- HG GROUP — SUBCON INVOICE GENERATOR · Supabase schema (prefix: sci_)
-- Run AFTER the foundation schema (supabase/schema.sql).
-- Additive & idempotent — safe to re-run.
--
-- Converted from apps-script-subcon-invoice (Google Sheet: Invoices,
-- InvoiceLines, Subcons, AuditLog + Drive PDFs & Logos).
--   Invoices     → sci_invoices
--   InvoiceLines → sci_invoice_lines
--   Subcons      → sci_subcons (logo file → 'subcon-invoices' storage bucket)
--   AuditLog     → foundation audit_log via log_audit()
--   MY_COMPANY script property → app_settings keys SCI_MY_COMPANY_NAME / _ADDR
--   PDF          → generated client-side via print window (browser Save as PDF);
--                  the record + lines stay authoritative in the database.
-- ============================================================================

-- ─── 1 · INVOICES ───────────────────────────────────────────────────────────
create table if not exists sci_invoices (
  id           uuid primary key default gen_random_uuid(),
  inv_no       text not null unique,
  inv_date     date not null default (now() at time zone 'Asia/Kuala_Lumpur')::date,
  ref          text default '',                -- claim ref / period
  issuer_type  text not null default 'ind',    -- 'ind' (individual) / 'co' (company)
  issuer_name  text not null,
  issuer_ic    text default '',
  issuer_addr  text default '',
  issuer_phone text default '',
  issuer_email text default '',
  bill_to_name text default '',
  bill_to_addr text default '',
  subtotal     numeric not null default 0,
  sst_enabled  boolean not null default false,
  sst_amount   numeric not null default 0,
  total        numeric not null default 0,
  pay_info     text default '',
  notes        text default '',
  created_by   text default '',
  created_at   timestamptz default now()
);

create table if not exists sci_invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references sci_invoices(id) on delete cascade,
  description text default '',
  quantity    numeric default 0,
  unit_price  numeric default 0,
  line_amount numeric default 0,
  sort        int default 1
);
create index if not exists idx_sci_lines_invoice on sci_invoice_lines (invoice_id);

-- ─── 2 · SAVED SUBCONS (remembered issuers, one logo each) ──────────────────
create table if not exists sci_subcons (
  id         uuid primary key default gen_random_uuid(),
  type       text not null default 'ind',      -- 'ind' / 'co'
  name       text not null,
  ic         text default '',
  addr       text default '',
  phone      text default '',
  email      text default '',
  pay_info   text default '',
  logo_path  text default '',                  -- storage path in 'subcon-invoices' bucket
  updated_at timestamptz default now()
);
-- same identity rule as the Apps Script version: unique on (type, name), case-insensitive
create unique index if not exists idx_sci_subcons_key on sci_subcons (type, lower(name));

-- ─── 3 · MY-COMPANY DEFAULT (was Script Property MY_COMPANY) ────────────────
insert into app_settings (key, value) values
  ('SCI_MY_COMPANY_NAME', ''),
  ('SCI_MY_COMPANY_ADDR', '')
on conflict (key) do nothing;

-- ─── 4 · STORAGE BUCKET (subcon logos; replaces Drive "Logos" folder) ───────
insert into storage.buckets (id, name, public) values ('subcon-invoices','subcon-invoices', false)
on conflict (id) do nothing;
drop policy if exists "subcon-invoices_rw" on storage.objects;
create policy "subcon-invoices_rw" on storage.objects for all to authenticated
  using (bucket_id = 'subcon-invoices' and is_allowed())
  with check (bucket_id = 'subcon-invoices' and is_allowed());

-- ─── 5 · SAVE INVOICE RPC — server-side recompute + atomic SUB-YYYY-#### ────
-- payload: { invNo, invDate, ref, issuerType, issuerName, issuerIc, issuerAddr,
--            issuerPhone, issuerEmail, billToName, billToAddr, sstEnabled,
--            payInfo, notes, logoPath,
--            lines: [{description, quantity, unitPrice}] }
-- Mirrors GAS saveInvoice(): recomputes every line (never trusts client maths),
-- SST fixed at 6% when enabled, upserts the subcon, persists the bill-to
-- company default, logs invoice.create.
create or replace function sci_save_invoice(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_line     jsonb;
  v_qty      numeric; v_unit numeric; v_amt numeric;
  v_subtotal numeric := 0;
  v_sst_on   boolean := coalesce((payload->>'sstEnabled')::boolean, false);
  v_sst      numeric; v_total numeric;
  v_type     text := case when payload->>'issuerType' = 'co' then 'co' else 'ind' end;
  v_name     text := trim(coalesce(payload->>'issuerName',''));
  v_invno    text := trim(coalesce(payload->>'invNo',''));
  v_year     text := to_char(now() at time zone 'Asia/Kuala_Lumpur', 'YYYY');
  v_next     int;
  v_id       uuid;
  v_sub_id   uuid;
  v_logo     text := trim(coalesce(payload->>'logoPath',''));
  v_sort     int := 0;
  v_computed jsonb := '[]'::jsonb;
  v_bt_name  text := trim(coalesce(payload->>'billToName',''));
  v_bt_addr  text := trim(coalesce(payload->>'billToAddr',''));
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  if v_name = '' then raise exception 'Issuer name is required.'; end if;
  if jsonb_array_length(coalesce(payload->'lines','[]'::jsonb)) = 0 then
    raise exception 'At least one line item is required.';
  end if;

  -- serialise number generation (replaces GAS LockService)
  perform pg_advisory_xact_lock(hashtext('sci_invoices'));

  -- recompute lines server-side; drop fully-empty rows (same filter as GAS)
  for v_line in select * from jsonb_array_elements(payload->'lines') loop
    v_qty  := coalesce((v_line->>'quantity')::numeric, 0);
    v_unit := coalesce((v_line->>'unitPrice')::numeric, 0);
    if trim(coalesce(v_line->>'description','')) = '' and v_unit = 0 and v_qty = 0 then
      continue;
    end if;
    v_amt := round(v_qty * v_unit, 2);
    v_subtotal := v_subtotal + v_amt;
    v_sort := v_sort + 1;
    v_computed := v_computed || jsonb_build_object(
      'description', trim(coalesce(v_line->>'description','')),
      'quantity', v_qty, 'unitPrice', v_unit, 'lineAmount', v_amt, 'sort', v_sort);
  end loop;
  if v_sort = 0 then raise exception 'At least one line item with an amount is required.'; end if;

  v_subtotal := round(v_subtotal, 2);
  v_sst      := case when v_sst_on then round(v_subtotal * 0.06, 2) else 0 end;
  v_total    := round(v_subtotal + v_sst, 2);

  -- invoice number: keep a typed one, else next SUB-YYYY-#### for this year
  if v_invno = '' then
    select coalesce(max((regexp_match(inv_no, '^SUB-' || v_year || '-(\d+)$'))[1]::int), 0) + 1
      into v_next
      from sci_invoices
     where inv_no ~ ('^SUB-' || v_year || '-\d+$');
    v_invno := 'SUB-' || v_year || '-' || lpad(v_next::text, 4, '0');
  end if;

  -- remember / update the subcon (same (type, name) identity as GAS upsertSubcon_)
  select id into v_sub_id from sci_subcons
   where type = v_type and lower(name) = lower(v_name);
  if v_sub_id is null then
    insert into sci_subcons (type, name, ic, addr, phone, email, pay_info, logo_path)
    values (v_type, v_name,
            trim(coalesce(payload->>'issuerIc','')),  trim(coalesce(payload->>'issuerAddr','')),
            trim(coalesce(payload->>'issuerPhone','')), trim(coalesce(payload->>'issuerEmail','')),
            coalesce(payload->>'payInfo',''), v_logo)
    returning id into v_sub_id;
  else
    update sci_subcons set
      ic        = trim(coalesce(payload->>'issuerIc','')),
      addr      = trim(coalesce(payload->>'issuerAddr','')),
      phone     = trim(coalesce(payload->>'issuerPhone','')),
      email     = trim(coalesce(payload->>'issuerEmail','')),
      pay_info  = coalesce(payload->>'payInfo',''),
      logo_path = case when v_logo <> '' then v_logo else logo_path end,
      updated_at = now()
    where id = v_sub_id;
  end if;

  -- persist "Bill to" company default for next time (was Script Property)
  if v_bt_name <> '' or v_bt_addr <> '' then
    insert into app_settings (key, value) values
      ('SCI_MY_COMPANY_NAME', v_bt_name), ('SCI_MY_COMPANY_ADDR', v_bt_addr)
    on conflict (key) do update set value = excluded.value;
  end if;

  insert into sci_invoices (inv_no, inv_date, ref, issuer_type, issuer_name, issuer_ic,
      issuer_addr, issuer_phone, issuer_email, bill_to_name, bill_to_addr,
      subtotal, sst_enabled, sst_amount, total, pay_info, notes, created_by)
  values (v_invno,
      coalesce(nullif(trim(coalesce(payload->>'invDate','')),'')::date,
               (now() at time zone 'Asia/Kuala_Lumpur')::date),
      trim(coalesce(payload->>'ref','')), v_type, v_name,
      trim(coalesce(payload->>'issuerIc','')),  trim(coalesce(payload->>'issuerAddr','')),
      trim(coalesce(payload->>'issuerPhone','')), trim(coalesce(payload->>'issuerEmail','')),
      v_bt_name, v_bt_addr,
      v_subtotal, v_sst_on, v_sst, v_total,
      coalesce(payload->>'payInfo',''), coalesce(payload->>'notes',''), current_email())
  returning id into v_id;

  insert into sci_invoice_lines (invoice_id, description, quantity, unit_price, line_amount, sort)
  select v_id, l->>'description', (l->>'quantity')::numeric, (l->>'unitPrice')::numeric,
         (l->>'lineAmount')::numeric, (l->>'sort')::int
  from jsonb_array_elements(v_computed) as l;

  perform log_audit('invoice.create',
    v_invno || ' · ' || v_name || ' · RM ' || to_char(v_total, 'FM999999990.00') ||
    ' · ' || v_sort || ' line(s)');

  return jsonb_build_object('id', v_id, 'invNo', v_invno,
    'subtotal', v_subtotal, 'sstAmount', v_sst, 'total', v_total);
end;
$$;

-- ─── 6 · ROW-LEVEL SECURITY — allowlist-gated ───────────────────────────────
alter table sci_invoices      enable row level security;
alter table sci_invoice_lines enable row level security;
alter table sci_subcons       enable row level security;

drop policy if exists sci_invoices_rw on sci_invoices;
create policy sci_invoices_rw on sci_invoices for all to authenticated
  using (is_allowed()) with check (is_allowed());

drop policy if exists sci_invoice_lines_rw on sci_invoice_lines;
create policy sci_invoice_lines_rw on sci_invoice_lines for all to authenticated
  using (is_allowed()) with check (is_allowed());

drop policy if exists sci_subcons_rw on sci_subcons;
create policy sci_subcons_rw on sci_subcons for all to authenticated
  using (is_allowed()) with check (is_allowed());

-- Done. Open subcon-invoice-supabase.html and connect.
