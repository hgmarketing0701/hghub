-- ============================================================================
-- HG GROUP — INVENTORY, TOOLS/EQUIPMENT & PURCHASING (slug: inventory)
-- Converted from apps-script-v4 (Cloud v4.2) — Google Sheets → Supabase.
-- Additive + idempotent. Run AFTER the foundation schema (supabase/schema.sql).
-- Uses (never redefines): allowed_users, is_allowed(), is_admin(),
--   current_email(), log_audit(), app_settings, audit_log.
--
-- Tables (prefix inv_):
--   inv_materials, inv_suppliers, inv_purchases, inv_purchase_lines,
--   inv_stock_outs, inv_stock_out_lines, inv_quotations, inv_tools,
--   inv_tool_assignments, inv_repairs, inv_stock_counts,
--   inv_payments, inv_payment_allocations
-- RPCs: inv_save_purchase, inv_delete_purchase, inv_save_stock_out,
--       inv_save_payment
-- Storage bucket: inventory-files (private) — drag/drop uploads
--   (photos, invoice/DO PDFs, delivery & collection photos, payment slips)
-- ============================================================================

-- ─── MASTERS ────────────────────────────────────────────────────────────────
create table if not exists inv_materials (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  unit                text default 'pc',
  category            text default '',
  low_stock_threshold numeric default 0,
  photo_url           text default '',
  created_by          text default '',
  created_at          timestamptz default now(),
  updated_by          text default '',
  updated_at          timestamptz default now()
);

create table if not exists inv_suppliers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  contact        text default '',
  contact_person text default '',
  category       text default '',
  supplier_type  text default '',            -- '', Material, Tool, Both
  notes          text default '',
  created_by     text default '',
  created_at     timestamptz default now(),
  updated_by     text default '',
  updated_at     timestamptz default now()
);

create table if not exists inv_tools (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category      text default '',
  brand         text default '',
  unit          text default 'pc',
  total_qty     numeric default 0,
  serial_number text default '',
  photo_url     text default '',
  notes         text default '',
  created_by    text default '',
  created_at    timestamptz default now(),
  updated_by    text default '',
  updated_at    timestamptz default now()
);

-- ─── PURCHASES (Stock IN) ───────────────────────────────────────────────────
-- NOTE: supplier/material/tool cross-references are stored as text ids (no FK)
-- on purpose — the original app allows deleting a master even when linked
-- records exist (with a confirm prompt). Header→line relations DO cascade.
create table if not exists inv_purchases (
  id                  uuid primary key default gen_random_uuid(),
  date                date not null,
  supplier_id         text default '',
  do_number           text default '',
  notes               text default '',
  invoice_url         text default '',
  discount            numeric default 0,
  delivery            numeric default 0,
  tax                 numeric default 0,
  rounding_adjustment numeric default 0,
  delivery_photos     jsonb default '[]'::jsonb,
  paid_by             text default 'company',  -- company | self (Black Lee claim)
  created_by          text default '',
  created_at          timestamptz default now()
);

create table if not exists inv_purchase_lines (
  id           uuid primary key default gen_random_uuid(),
  purchase_id  uuid not null references inv_purchases(id) on delete cascade,
  item_type    text default 'material',       -- material | tool
  material_id  text default '',               -- inv_materials.id OR inv_tools.id (polymorphic)
  qty          numeric default 0,
  rate         numeric default 0,
  amount       numeric default 0,
  division     text default '',
  requested_by text default ''
);
create index if not exists idx_inv_purlines_purchase on inv_purchase_lines (purchase_id);

-- ─── STOCK OUTS (Delivery Notes) ────────────────────────────────────────────
create table if not exists inv_stock_outs (
  id                uuid primary key default gen_random_uuid(),
  dn_number         text not null unique,
  date              date not null,
  division          text not null,
  project           text default '',
  notes             text default '',
  requested_by      text default '',
  collection_photos jsonb default '[]'::jsonb,
  created_by        text default '',
  created_at        timestamptz default now()
);

create table if not exists inv_stock_out_lines (
  id            uuid primary key default gen_random_uuid(),
  stock_out_id  uuid not null references inv_stock_outs(id) on delete cascade,
  material_id   text default '',
  qty           numeric default 0,
  rate_per_unit numeric default 0,
  amount        numeric default 0
);
create index if not exists idx_inv_outlines_out on inv_stock_out_lines (stock_out_id);

-- ─── PRICE QUOTATIONS (supplier quotes) ─────────────────────────────────────
create table if not exists inv_quotations (
  id             uuid primary key default gen_random_uuid(),
  item_type      text default 'material',     -- material | tool
  material_id    text default '',             -- inv_materials.id OR inv_tools.id
  supplier_id    text default '',
  rate           numeric default 0,
  qty_offered    numeric,
  valid_until    date,
  source         text default '',             -- WhatsApp / Email / Phone / ...
  notes          text default '',
  screenshot_url text default '',
  created_by     text default '',
  created_at     timestamptz default now(),
  updated_by     text default '',
  updated_at     timestamptz default now()
);

-- ─── TOOL ASSIGNMENTS ───────────────────────────────────────────────────────
create table if not exists inv_tool_assignments (
  id                 uuid primary key default gen_random_uuid(),
  tool_id            text default '',
  qty                numeric default 0,
  person             text default '',
  division           text default '',
  assigned_date      date,
  assigned_notes     text default '',
  returned_date      date,
  returned_qty       numeric,
  returned_condition text default '',         -- OK / TO_REPAIR / TO_DISCARD / TO_REASSIGN
  returned_notes     text default '',
  returned_photo_url text default '',
  created_by         text default '',
  created_at         timestamptz default now(),
  updated_by         text default '',
  updated_at         timestamptz default now()
);

-- ─── REPAIRS ────────────────────────────────────────────────────────────────
create table if not exists inv_repairs (
  id                 uuid primary key default gen_random_uuid(),
  tool_id            text default '',
  assignment_id      text default '',
  qty                numeric default 0,
  supplier_id        text default '',
  sent_date          date,
  sent_notes         text default '',
  sent_photo_url     text default '',
  status             text default 'SENT',     -- SENT | RETURNED
  returned_date      date,
  returned_qty       numeric,
  returned_notes     text default '',
  returned_photo_url text default '',
  created_by         text default '',
  created_at         timestamptz default now(),
  updated_by         text default '',
  updated_at         timestamptz default now()
);

-- ─── STOCK COUNTS / AUDIT ───────────────────────────────────────────────────
create table if not exists inv_stock_counts (
  id          uuid primary key default gen_random_uuid(),
  count_date  date,
  item_type   text default 'material',        -- material | tool
  item_id     text default '',
  system_qty  numeric default 0,
  counted_qty numeric default 0,
  variance    numeric default 0,
  reason      text default '',                -- LOST/DAMAGED/FOUND/MISPLACED/DISPUTE/ADJUSTMENT/OTHER
  notes       text default '',
  photo_url   text default '',
  created_by  text default '',
  created_at  timestamptz default now(),
  updated_by  text default '',
  updated_at  timestamptz default now()
);

-- ─── PAYMENTS (v4.1 — supplier payments + Black Lee self-claim reimbursements) ─
create table if not exists inv_payments (
  id               uuid primary key default gen_random_uuid(),
  payment_date     date not null,
  payee_type       text default 'supplier',   -- supplier | self
  payee_id         text default '',           -- inv_suppliers.id when supplier; '' for self
  amount           numeric default 0,
  method           text default '',
  reference_number text default '',
  notes            text default '',
  slip_photo_url   text default '',
  created_by       text default '',
  created_at       timestamptz default now(),
  updated_by       text default '',
  updated_at       timestamptz default now()
);

create table if not exists inv_payment_allocations (
  id             uuid primary key default gen_random_uuid(),
  payment_id     uuid not null references inv_payments(id) on delete cascade,
  purchase_id    uuid not null references inv_purchases(id) on delete cascade,
  amount_applied numeric default 0
);
create index if not exists idx_inv_payalloc_payment  on inv_payment_allocations (payment_id);
create index if not exists idx_inv_payalloc_purchase on inv_payment_allocations (purchase_id);

-- ─── RPC · SAVE PURCHASE (atomic header + lines + tool-qty auto-increase) ────
-- payload: { date, supplierId, doNumber, notes, invoiceUrl, discount, delivery,
--            tax, roundingAdjustment, deliveryPhotos:[url], paidBy,
--            lines:[{ itemType, materialId, qty, rate, division, requestedBy }] }
create or replace function inv_save_purchase(payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_line   jsonb;
  v_qty    numeric; v_rate numeric;
  v_type   text;    v_mat  text;
  v_paidby text;
  v_id     uuid;
  v_count  int := 0;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  if coalesce(payload->>'date','') = '' or coalesce(payload->>'supplierId','') = '' then
    raise exception 'Date and supplier are required.';
  end if;
  if jsonb_array_length(coalesce(payload->'lines','[]'::jsonb)) = 0 then
    raise exception 'At least one valid item line required.';
  end if;

  v_paidby := lower(coalesce(payload->>'paidBy','company'));
  if v_paidby <> 'self' then v_paidby := 'company'; end if;

  insert into inv_purchases (date, supplier_id, do_number, notes, invoice_url,
    discount, delivery, tax, rounding_adjustment, delivery_photos, paid_by, created_by)
  values (
    (payload->>'date')::date,
    payload->>'supplierId',
    coalesce(payload->>'doNumber',''),
    coalesce(payload->>'notes',''),
    coalesce(payload->>'invoiceUrl',''),
    coalesce((payload->>'discount')::numeric, 0),
    coalesce((payload->>'delivery')::numeric, 0),
    coalesce((payload->>'tax')::numeric, 0),
    coalesce((payload->>'roundingAdjustment')::numeric, 0),
    coalesce(payload->'deliveryPhotos','[]'::jsonb),
    v_paidby,
    current_email())
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(payload->'lines') loop
    v_qty  := coalesce((v_line->>'qty')::numeric, 0);
    v_rate := coalesce((v_line->>'rate')::numeric, 0);
    v_type := coalesce(v_line->>'itemType','material');
    v_mat  := coalesce(v_line->>'materialId','');
    if v_mat = '' or v_qty <= 0 then continue; end if;

    insert into inv_purchase_lines (purchase_id, item_type, material_id, qty, rate, amount, division, requested_by)
    values (v_id, v_type, v_mat, v_qty, v_rate, round(v_qty * v_rate, 2),
            coalesce(v_line->>'division',''), coalesce(v_line->>'requestedBy',''));
    v_count := v_count + 1;

    -- Buying a tool auto-increases its owned Total Qty (same as GAS updateToolQty_)
    if v_type = 'tool' then
      update inv_tools
         set total_qty  = greatest(0, coalesce(total_qty,0) + v_qty),
             updated_at = now(),
             updated_by = current_email()
       where id::text = v_mat;
    end if;
  end loop;

  if v_count = 0 then raise exception 'At least one valid item line required.'; end if;

  perform log_audit('CREATE Purchase',
    coalesce(payload->>'doNumber','') || ' · ' || v_count || ' item(s)' ||
    case when coalesce(payload->>'invoiceUrl','') <> '' then ' · invoice attached' else '' end ||
    case when v_paidby = 'self' then ' · paid by SELF (reimbursable)' else '' end);
  return v_id;
end;
$$;

-- ─── RPC · DELETE PURCHASE (reverses tool qty, cascades lines + allocations) ─
create or replace function inv_delete_purchase(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_line record;
  v_do   text;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  select do_number into v_do from inv_purchases where id = p_id;
  if not found then raise exception 'Purchase not found.'; end if;

  for v_line in select material_id, qty from inv_purchase_lines
                 where purchase_id = p_id and item_type = 'tool' loop
    update inv_tools
       set total_qty  = greatest(0, coalesce(total_qty,0) - coalesce(v_line.qty,0)),
           updated_at = now(),
           updated_by = current_email()
     where id::text = v_line.material_id;
  end loop;

  delete from inv_purchases where id = p_id;  -- lines + payment allocations cascade
  perform log_audit('DELETE Purchase', coalesce(v_do,'') || ' (' || left(p_id::text,8) || ')');
end;
$$;

-- ─── RPC · SAVE STOCK OUT (atomic DN number DN-YYYYMMDD-###) ─────────────────
-- payload: { date, division, project, notes, requestedBy,
--            collectionPhotos:[url], lines:[{ materialId, qty, ratePerUnit }] }
create or replace function inv_save_stock_out(payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_line   jsonb;
  v_qty    numeric; v_rate numeric;
  v_prefix text := 'DN-' || to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYYMMDD') || '-';
  v_next   int;
  v_dn     text;
  v_id     uuid;
  v_count  int := 0;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  if coalesce(payload->>'date','') = '' or coalesce(payload->>'division','') = '' then
    raise exception 'Date and division are required.';
  end if;
  if jsonb_array_length(coalesce(payload->'lines','[]'::jsonb)) = 0 then
    raise exception 'At least one valid item line required.';
  end if;

  -- serialise DN numbering across concurrent saves
  perform pg_advisory_xact_lock(hashtext('inv_stock_outs_dn'));
  select coalesce(max((substring(dn_number from length(v_prefix)+1))::int), 0) + 1
    into v_next
    from inv_stock_outs
   where dn_number like v_prefix || '%'
     and substring(dn_number from length(v_prefix)+1) ~ '^[0-9]+$';
  v_dn := v_prefix || lpad(v_next::text, 3, '0');

  insert into inv_stock_outs (dn_number, date, division, project, notes, requested_by, collection_photos, created_by)
  values (v_dn, (payload->>'date')::date, payload->>'division',
          coalesce(payload->>'project',''), coalesce(payload->>'notes',''),
          coalesce(payload->>'requestedBy',''),
          coalesce(payload->'collectionPhotos','[]'::jsonb),
          current_email())
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(payload->'lines') loop
    v_qty  := coalesce((v_line->>'qty')::numeric, 0);
    v_rate := coalesce((v_line->>'ratePerUnit')::numeric, 0);
    if coalesce(v_line->>'materialId','') = '' or v_qty <= 0 then continue; end if;
    insert into inv_stock_out_lines (stock_out_id, material_id, qty, rate_per_unit, amount)
    values (v_id, v_line->>'materialId', v_qty, v_rate, round(v_qty * v_rate, 2));
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then raise exception 'At least one valid item line required.'; end if;

  perform log_audit('CREATE StockOut', v_dn || ' → ' || (payload->>'division') || ' · ' || v_count || ' item(s)');
  return v_id;
end;
$$;

-- ─── RPC · SAVE PAYMENT (header + allocations, server-computed total) ────────
-- payload: { id?, paymentDate, payeeType('supplier'|'self'), payeeId, method,
--            referenceNumber, notes, slipPhotoUrl,
--            allocations:[{ purchaseId, amountApplied }] }
create or replace function inv_save_payment(payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_alloc  jsonb;
  v_amt    numeric;
  v_total  numeric := 0;
  v_type   text;
  v_payee  text;
  v_id     uuid;
  v_exists boolean := false;
  v_count  int := 0;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  if coalesce(payload->>'paymentDate','') = '' then raise exception 'Payment date is required.'; end if;

  v_type := lower(coalesce(payload->>'payeeType',''));
  if v_type not in ('supplier','self') then
    raise exception 'payeeType must be "supplier" or "self".';
  end if;
  v_payee := case when v_type = 'supplier' then coalesce(payload->>'payeeId','') else '' end;
  if v_type = 'supplier' and v_payee = '' then
    raise exception 'Supplier is required for supplier payment.';
  end if;

  -- validate allocations + total
  for v_alloc in select * from jsonb_array_elements(coalesce(payload->'allocations','[]'::jsonb)) loop
    v_amt := coalesce((v_alloc->>'amountApplied')::numeric, 0);
    if coalesce(v_alloc->>'purchaseId','') = '' or v_amt <= 0 then continue; end if;
    v_total := v_total + v_amt;
    v_count := v_count + 1;
  end loop;
  if v_count = 0 or v_total <= 0 then
    raise exception 'Allocate at least one invoice with a positive amount.';
  end if;

  if coalesce(payload->>'id','') <> '' then
    v_id := (payload->>'id')::uuid;
    select true into v_exists from inv_payments where id = v_id;
  end if;

  if coalesce(v_exists,false) then
    update inv_payments
       set payment_date     = (payload->>'paymentDate')::date,
           payee_type       = v_type,
           payee_id         = v_payee,
           amount           = v_total,
           method           = coalesce(payload->>'method',''),
           reference_number = coalesce(payload->>'referenceNumber',''),
           notes            = coalesce(payload->>'notes',''),
           slip_photo_url   = coalesce(payload->>'slipPhotoUrl',''),
           updated_at       = now(),
           updated_by       = current_email()
     where id = v_id;
    delete from inv_payment_allocations where payment_id = v_id;
  else
    insert into inv_payments (payment_date, payee_type, payee_id, amount, method,
                              reference_number, notes, slip_photo_url, created_by, updated_by)
    values ((payload->>'paymentDate')::date, v_type, v_payee, v_total,
            coalesce(payload->>'method',''), coalesce(payload->>'referenceNumber',''),
            coalesce(payload->>'notes',''), coalesce(payload->>'slipPhotoUrl',''),
            current_email(), current_email())
    returning id into v_id;
  end if;

  for v_alloc in select * from jsonb_array_elements(coalesce(payload->'allocations','[]'::jsonb)) loop
    v_amt := coalesce((v_alloc->>'amountApplied')::numeric, 0);
    if coalesce(v_alloc->>'purchaseId','') = '' or v_amt <= 0 then continue; end if;
    insert into inv_payment_allocations (payment_id, purchase_id, amount_applied)
    values (v_id, (v_alloc->>'purchaseId')::uuid, v_amt);
  end loop;

  perform log_audit(case when coalesce(v_exists,false) then 'UPDATE Payment' else 'CREATE Payment' end,
    case when v_type = 'self' then 'Self-claim' else 'Supplier ' || v_payee end ||
    ' · RM ' || to_char(v_total,'FM999999990.00') || ' · ' || v_count || ' invoice(s)' ||
    case when coalesce(payload->>'method','') <> '' then ' · ' || (payload->>'method') else '' end);
  return v_id;
end;
$$;

-- ─── ROW-LEVEL SECURITY (allowlist-gated on every table) ─────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'inv_materials','inv_suppliers','inv_tools',
    'inv_purchases','inv_purchase_lines',
    'inv_stock_outs','inv_stock_out_lines',
    'inv_quotations','inv_tool_assignments','inv_repairs','inv_stock_counts',
    'inv_payments','inv_payment_allocations'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format('create policy %I_rw on %I for all to authenticated using (is_allowed()) with check (is_allowed())', t, t);
  end loop;
end $$;

-- ─── STORAGE BUCKET (private) — replaces the Google Drive upload folder ──────
insert into storage.buckets (id, name, public) values ('inventory-files','inventory-files', false)
on conflict (id) do nothing;
drop policy if exists "inventory-files_rw" on storage.objects;
create policy "inventory-files_rw" on storage.objects for all to authenticated
  using (bucket_id = 'inventory-files' and is_allowed())
  with check (bucket_id = 'inventory-files' and is_allowed());

-- Done. The original GAS app had no seed rows and no scheduled email alarms,
-- so there is no seed block and no inv_alarms view.
