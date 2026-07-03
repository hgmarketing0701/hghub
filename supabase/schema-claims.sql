-- ============================================================================
-- HG GROUP — RECEIPT CLAIMS (clm_) · Supabase schema
-- Run AFTER the foundation schema (supabase/schema.sql).
-- Additive & idempotent — safe to re-run.
--
-- Converted from apps-script-claims (Google Sheet tabs: Claims, ClaimLines,
-- Summaries, AuditLog → foundation audit_log). Drive → storage bucket
-- 'claim-receipts'. Gemini OCR → 'gemini-receipt' Edge Function (frontend).
-- ============================================================================

-- ─── 1 · CLAIMS ─────────────────────────────────────────────────────────────
create table if not exists clm_claims (
  id                  uuid primary key default gen_random_uuid(),
  claim_no            text not null unique,                 -- CLM-YYYY-###
  submitted_at        timestamptz default now(),
  submitted_by        text default '',
  receipt_date        date not null default (now() at time zone 'Asia/Kuala_Lumpur')::date,
  vendor              text not null default 'Unknown vendor',
  currency            text not null default 'RM',
  subtotal            numeric not null default 0,
  service_charge      numeric not null default 0,           -- restaurant SC (RM)
  subsidy_amount      numeric not null default 0,           -- Budi95 / fuel subsidy deducted
  sst_amount          numeric not null default 0,
  rounding_adjustment numeric not null default 0,           -- signed 5-sen cash rounding
  total               numeric not null default 0,           -- net claimable
  primary_category    text not null default 'other',
  status              text not null default 'submitted',
  receipt_paths       jsonb not null default '[]'::jsonb,   -- storage paths in 'claim-receipts'
  remarks             text default '',
  created_by          text default '',
  created_at          timestamptz default now()
);
create index if not exists idx_clm_claims_by on clm_claims (submitted_by);
create index if not exists idx_clm_claims_no on clm_claims (claim_no);

-- ─── 2 · CLAIM LINES ────────────────────────────────────────────────────────
create table if not exists clm_claim_lines (
  id          uuid primary key default gen_random_uuid(),
  claim_id    uuid not null references clm_claims(id) on delete cascade,
  description text not null default '',
  quantity    numeric not null default 0,
  unit_price  numeric not null default 0,
  line_amount numeric not null default 0,
  category    text not null default 'other',
  remarks     text default '',
  sort        int default 1
);
create index if not exists idx_clm_lines_claim on clm_claim_lines (claim_id);

-- ─── 3 · SUMMARIES (bundles of claims) ──────────────────────────────────────
create table if not exists clm_summaries (
  id           uuid primary key default gen_random_uuid(),
  summary_no   text not null unique,                        -- SUM-YYYY-###
  generated_at timestamptz default now(),
  generated_by text default '',
  claim_nos    text not null default '',                    -- 'CLM-2026-001 | CLM-2026-002'
  claim_count  int not null default 0,
  currency     text not null default 'RM',
  grand_total  numeric not null default 0,
  period_from  date,
  period_to    date,
  title        text default '',
  remarks      text default '',
  created_by   text default '',
  created_at   timestamptz default now()
);
create index if not exists idx_clm_summaries_by on clm_summaries (generated_by);

-- ─── 4 · SST rate setting (reuses foundation app_settings; seed if missing) ─
insert into app_settings (key, value) values ('SST_PERCENT', '6')
on conflict (key) do nothing;

-- ─── 5 · SUBMIT CLAIM RPC — server-side recompute + atomic claim number ─────
-- payload: { vendor, receiptDate, currency, sstEnabled, serviceCharge,
--            subsidyAmount, roundingAdjustment, remarks, receiptPaths:[...],
--            lines: [{description, quantity, unitPrice, category, remarks}] }
-- Mirrors submitClaimCore_ in apps-script-claims/Code.gs — never trusts client maths.
create or replace function clm_submit_claim(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_line     jsonb;
  v_qty      numeric; v_unit numeric; v_amt numeric;
  v_subtotal numeric := 0;
  v_sc       numeric; v_subsidy numeric; v_round numeric;
  v_sstpct   numeric := 6;
  v_sst      numeric := 0; v_taxbase numeric; v_total numeric;
  v_cat      text;
  v_year     text := to_char(now() at time zone 'Asia/Kuala_Lumpur', 'YYYY');
  v_next     int;
  v_no       text;
  v_id       uuid;
  v_sort     int := 0;
  v_computed jsonb := '[]'::jsonb;
  v_primary  text;
  v_vendor   text; v_currency text; v_date date;
  v_cats     text[] := array['food','grocery','apparel','fuel','transport',
                             'accommodation','materials','tools','office','other'];
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  if jsonb_array_length(coalesce(payload->'lines', '[]'::jsonb)) = 0 then
    raise exception 'At least one line item required.';
  end if;
  if jsonb_array_length(coalesce(payload->'receiptPaths', '[]'::jsonb)) = 0 then
    raise exception 'At least one receipt image required.';
  end if;

  -- recompute every line (qty × unit price) — same rules as the GAS server
  for v_line in select * from jsonb_array_elements(payload->'lines') loop
    v_qty  := coalesce((v_line->>'quantity')::numeric, 0);
    v_unit := coalesce((v_line->>'unitPrice')::numeric, 0);
    v_amt  := round(v_qty * v_unit, 2);
    v_cat  := lower(coalesce(v_line->>'category', 'other'));
    if not (v_cat = any(v_cats)) then v_cat := 'other'; end if;
    v_subtotal := v_subtotal + v_amt;
    v_sort := v_sort + 1;
    v_computed := v_computed || jsonb_build_object(
      'description', trim(coalesce(v_line->>'description','')),
      'quantity', v_qty, 'unitPrice', v_unit, 'lineAmount', v_amt,
      'category', v_cat, 'remarks', coalesce(v_line->>'remarks',''), 'sort', v_sort);
  end loop;
  v_subtotal := round(v_subtotal, 2);

  v_sc      := greatest(0, round(coalesce((payload->>'serviceCharge')::numeric, 0), 2));
  v_subsidy := greatest(0, round(coalesce((payload->>'subsidyAmount')::numeric, 0), 2));
  v_round   := round(coalesce((payload->>'roundingAdjustment')::numeric, 0), 2);
  v_taxbase := greatest(0, v_subtotal + v_sc - v_subsidy);
  if coalesce((payload->>'sstEnabled')::boolean, false) then
    select coalesce(nullif(value,'')::numeric, 6) into v_sstpct
    from app_settings where key = 'SST_PERCENT';
    v_sstpct := coalesce(v_sstpct, 6);
    v_sst := round(v_taxbase * v_sstpct / 100, 2);
  end if;
  v_total := round(v_subtotal + v_sc - v_subsidy + v_sst + v_round, 2);

  -- primary category = category covering the largest share of the total
  select l.cat into v_primary from (
    select x->>'category' as cat, sum((x->>'lineAmount')::numeric) as s
    from jsonb_array_elements(v_computed) x group by 1 order by s desc limit 1
  ) l;
  v_primary := coalesce(v_primary, 'other');

  v_vendor   := coalesce(nullif(trim(payload->>'vendor'), ''), 'Unknown vendor');
  v_currency := coalesce(nullif(trim(payload->>'currency'), ''), 'RM');
  v_date     := coalesce(nullif(payload->>'receiptDate','')::date,
                         (now() at time zone 'Asia/Kuala_Lumpur')::date);

  -- atomic sequential claim number: CLM-YYYY-###
  select coalesce(max((substring(claim_no from 10))::int), 0) + 1 into v_next
  from clm_claims
  where claim_no like 'CLM-' || v_year || '-%'
    and substring(claim_no from 10) ~ '^[0-9]+$';
  v_no := 'CLM-' || v_year || '-' || lpad(v_next::text, 3, '0');

  insert into clm_claims (claim_no, submitted_by, receipt_date, vendor, currency,
                          subtotal, service_charge, subsidy_amount, sst_amount,
                          rounding_adjustment, total, primary_category, status,
                          receipt_paths, remarks, created_by)
  values (v_no, current_email(), v_date, v_vendor, v_currency,
          v_subtotal, v_sc, v_subsidy, v_sst,
          v_round, v_total, v_primary, 'submitted',
          coalesce(payload->'receiptPaths', '[]'::jsonb),
          coalesce(payload->>'remarks',''), current_email())
  returning id into v_id;

  insert into clm_claim_lines (claim_id, description, quantity, unit_price,
                               line_amount, category, remarks, sort)
  select v_id, l->>'description', (l->>'quantity')::numeric, (l->>'unitPrice')::numeric,
         (l->>'lineAmount')::numeric, l->>'category', l->>'remarks', (l->>'sort')::int
  from jsonb_array_elements(v_computed) as l;

  perform log_audit('claim.create',
    v_no || ' · ' || v_vendor || ' · ' || v_currency || ' ' || to_char(v_total, 'FM999999990.00')
    || ' · ' || jsonb_array_length(v_computed) || ' line(s)');

  return jsonb_build_object(
    'id', v_id, 'claimNo', v_no, 'vendor', v_vendor, 'currency', v_currency,
    'subtotal', v_subtotal, 'serviceCharge', v_sc, 'subsidyAmount', v_subsidy,
    'sstAmount', v_sst, 'roundingAdjustment', v_round, 'total', v_total,
    'primaryCategory', v_primary, 'receiptDate', v_date);
end;
$$;

-- ─── 6 · GENERATE SUMMARY RPC — bundle N claims, atomic SUM-YYYY-### ────────
-- payload: { claimNos: ['CLM-2026-001', ...], title?, remarks? }
-- Mirrors generateSummary in Code.gs. Staff can only bundle their own claims.
create or replace function clm_generate_summary(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_nos      text[];
  v_missing  text[];
  v_count    int;
  v_grand    numeric;
  v_currency text;
  v_from     date; v_to date;
  v_year     text := to_char(now() at time zone 'Asia/Kuala_Lumpur', 'YYYY');
  v_next     int;
  v_no       text;
  v_id       uuid;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  select array_agg(x) into v_nos
  from jsonb_array_elements_text(coalesce(payload->'claimNos','[]'::jsonb)) as x;
  if v_nos is null or array_length(v_nos, 1) = 0 then
    raise exception 'Pick at least one claim to summarise.';
  end if;

  -- claims visible to this user only (admin sees all)
  select count(*), round(coalesce(sum(total), 0), 2),
         min(receipt_date), max(receipt_date)
    into v_count, v_grand, v_from, v_to
  from clm_claims
  where claim_no = any(v_nos)
    and (is_admin() or lower(submitted_by) = lower(current_email()));

  if v_count = 0 then raise exception 'None of the selected claims were found.'; end if;

  select array_agg(n) into v_missing
  from unnest(v_nos) as n
  where not exists (
    select 1 from clm_claims c where c.claim_no = n
      and (is_admin() or lower(c.submitted_by) = lower(current_email())));
  if v_missing is not null then
    raise exception 'Not found: %', array_to_string(v_missing, ', ');
  end if;

  -- primary currency = the one carrying the largest share of the total
  select currency into v_currency from (
    select currency, sum(total) as s from clm_claims
    where claim_no = any(v_nos)
      and (is_admin() or lower(submitted_by) = lower(current_email()))
    group by currency order by s desc limit 1
  ) c;
  v_currency := coalesce(v_currency, 'RM');

  -- atomic sequential summary number: SUM-YYYY-###
  select coalesce(max((substring(summary_no from 10))::int), 0) + 1 into v_next
  from clm_summaries
  where summary_no like 'SUM-' || v_year || '-%'
    and substring(summary_no from 10) ~ '^[0-9]+$';
  v_no := 'SUM-' || v_year || '-' || lpad(v_next::text, 3, '0');

  insert into clm_summaries (summary_no, generated_by, claim_nos, claim_count,
                             currency, grand_total, period_from, period_to,
                             title, remarks, created_by)
  values (v_no, current_email(), array_to_string(v_nos, ' | '), v_count,
          v_currency, v_grand, v_from, v_to,
          coalesce(trim(payload->>'title'),''), coalesce(trim(payload->>'remarks'),''),
          current_email())
  returning id into v_id;

  perform log_audit('summary.create',
    v_no || ' · ' || v_count || ' claim(s) · ' || v_currency || ' '
    || to_char(v_grand, 'FM999999990.00'));

  return jsonb_build_object(
    'id', v_id, 'summaryNo', v_no, 'claimCount', v_count, 'currency', v_currency,
    'grandTotal', v_grand, 'periodFrom', v_from, 'periodTo', v_to,
    'title', coalesce(trim(payload->>'title'),''));
end;
$$;

-- ─── 7 · STORAGE — receipt photos (replaces Drive "Black Lee — Claims") ─────
insert into storage.buckets (id, name, public) values ('claim-receipts','claim-receipts', false)
on conflict (id) do nothing;
drop policy if exists "claim-receipts_rw" on storage.objects;
create policy "claim-receipts_rw" on storage.objects for all to authenticated
  using (bucket_id = 'claim-receipts' and is_allowed())
  with check (bucket_id = 'claim-receipts' and is_allowed());

-- ─── 8 · ROW-LEVEL SECURITY — per-user privacy (staff own rows, admin all) ──
alter table clm_claims      enable row level security;
alter table clm_claim_lines enable row level security;
alter table clm_summaries   enable row level security;

drop policy if exists clm_claims_rw on clm_claims;
create policy clm_claims_rw on clm_claims for all to authenticated
  using (is_allowed() and (is_admin() or lower(submitted_by) = lower(current_email())))
  with check (is_allowed() and (is_admin() or lower(submitted_by) = lower(current_email())));

drop policy if exists clm_claim_lines_rw on clm_claim_lines;
create policy clm_claim_lines_rw on clm_claim_lines for all to authenticated
  using (is_allowed() and exists (
    select 1 from clm_claims c where c.id = claim_id
      and (is_admin() or lower(c.submitted_by) = lower(current_email()))))
  with check (is_allowed() and exists (
    select 1 from clm_claims c where c.id = claim_id
      and (is_admin() or lower(c.submitted_by) = lower(current_email()))));

drop policy if exists clm_summaries_rw on clm_summaries;
create policy clm_summaries_rw on clm_summaries for all to authenticated
  using (is_allowed() and (is_admin() or lower(generated_by) = lower(current_email())))
  with check (is_allowed() and (is_admin() or lower(generated_by) = lower(current_email())));

-- Done. Frontend: claims-supabase.html · OCR: 'gemini-receipt' Edge Function.
