-- ============================================================================
-- HG GROUP — VISUAL WORKS CONTROL · Supabase schema (slug: visual, prefix: vis_)
-- Converted from apps-script-visual (Black Lee — Visual Works, GAS + Sheets).
-- Run AFTER the foundation schema.sql. Additive + idempotent — safe to re-run.
--
-- Uses from the foundation (never redefined here):
--   allowed_users, is_allowed(), is_admin(), current_email(), log_audit(), app_settings
--
-- Creates:
--   vis_malls, vis_materials, vis_rates, vis_jobs, vis_job_panels,
--   vis_permits, vis_workers, vis_invoices, vis_invoice_jobs
--   vis_pick_rate() helper · vis_save_job() RPC · vis_save_invoice() RPC
--   vis_alarms view (permit + worker-doc expiry — feeds daily-alarms edge fn)
--   storage bucket 'visual' (sketches, proofs, photos, permits, worker docs, B invoices)
-- ============================================================================

-- ─── MASTERS ────────────────────────────────────────────────────────────────
create table if not exists vis_malls (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  notes      text default '',
  updated_at timestamptz default now()
);

create table if not exists vis_materials (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  notes      text default '',
  updated_at timestamptz default now()
);

-- Seed materials (same as GAS setupConfig → seedMaterials_)
insert into vis_materials (name) values
  ('Tarpaulin'), ('Sticker'), ('Fabric'), ('Vinyl'), ('Forex Board')
on conflict (name) do nothing;

-- ─── RATE CARD — B's rates per mall / material / job type ───────────────────
create table if not exists vis_rates (
  id             uuid primary key default gen_random_uuid(),
  mall           text default 'ALL',
  material       text default 'ALL',
  job_type       text default 'ALL',          -- print_install / print_only / install_only / ALL
  rate_per_sqft  numeric default 0,           -- print rate
  install_rate   numeric default 0,
  package_rate   numeric default 0,           -- all-in supply+install (overrides split)
  min_charge     numeric default 0,
  effective_from date,
  notes          text default '',
  updated_by     text default '',
  updated_at     timestamptz default now()
);

-- ─── JOBS + PANELS ──────────────────────────────────────────────────────────
create table if not exists vis_permits (
  id          uuid primary key default gen_random_uuid(),
  mall        text not null,
  lot_no      text default '',
  permit_type text default '',                -- monthly / yearly / one-off
  permit_no   text default '',
  valid_from  date,
  valid_to    date,
  file_url    text default '',                -- pasted link (if any)
  file_path   text default '',                -- storage path in bucket 'visual'
  notes       text default '',
  created_by  text default '',
  created_at  timestamptz default now()
);

create table if not exists vis_jobs (
  id                 uuid primary key default gen_random_uuid(),
  job_no             text not null unique,    -- VIS-YYYY-####
  status             text not null default 'NEW',
  mall               text not null,
  lot_no             text not null,
  job_type           text not null default 'print_install',
  client             text default '',
  requested_by       text default '',
  request_date       date,
  install_date       date,
  completed_date     date,
  artwork_link       text default '',         -- WeTransfer / Drive link (URL kept as-is)
  artwork_proof_url  text default '',         -- pasted proof link
  artwork_proof_path text default '',         -- uploaded proof (storage path)
  sketch_url         text default '',         -- pasted sketch link
  sketch_path        text default '',         -- uploaded sketch (storage path)
  site_photo_paths   jsonb default '[]'::jsonb,  -- site reference photos (storage paths)
  photo_paths        jsonb default '[]'::jsonb,  -- completion photos (storage paths)
  material           text default '',
  total_sqft         numeric default 0,
  rate_id            uuid,
  rate_per_sqft      numeric default 0,
  install_rate       numeric default 0,
  subtotal           numeric default 0,
  expected_amount    numeric default 0,
  permit_id          uuid references vis_permits(id) on delete set null,
  proceed_by         text default '',
  proceed_at         timestamptz,
  notes              text default '',
  created_by         text default '',
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);
create index if not exists idx_vis_jobs_status on vis_jobs (status);
create index if not exists idx_vis_jobs_mall   on vis_jobs (mall);

create table if not exists vis_job_panels (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references vis_jobs(id) on delete cascade,
  label         text default '',
  width_val     numeric default 0,
  height_val    numeric default 0,
  unit          text default 'mm',            -- mm / cm / m / in / ft
  qty           numeric default 1,
  sqft          numeric default 0,
  material      text default '',
  rate_per_sqft numeric default 0,
  amount        numeric default 0
);
create index if not exists idx_vis_panels_job on vis_job_panels (job_id);

-- ─── B's WORKERS (IC / CIDB / WAH / other doc slots) ────────────────────────
create table if not exists vis_workers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  role           text default '',
  phone          text default '',
  ic_no          text default '',
  ic_file_url    text default '',
  ic_file_path   text default '',
  cidb_no        text default '',
  cidb_expiry    date,
  cidb_file_url  text default '',
  cidb_file_path text default '',
  wah_no         text default '',
  wah_expiry     date,
  wah_file_url   text default '',
  wah_file_path  text default '',
  doc_type       text default '',
  doc_no         text default '',
  doc_expiry     date,
  doc_url        text default '',
  doc_file_path  text default '',
  status         text default 'active',       -- active / inactive
  notes          text default '',
  updated_by     text default '',
  updated_at     timestamptz default now()
);

-- ─── B's INVOICES + RECONCILIATION ──────────────────────────────────────────
create table if not exists vis_invoices (
  id             uuid primary key default gen_random_uuid(),
  inv_no         text not null,
  inv_date       date,
  period         text default '',
  malls          text default '',
  claimed_amount numeric default 0,
  sst_enabled    boolean default false,
  sst_amount     numeric default 0,
  claimed_total  numeric default 0,
  file_url       text default '',
  file_path      text default '',
  status         text default 'checking',     -- checking / verified / disputed / paid
  recon_verdict  text default '',             -- MATCH / CHECK
  recon_note     text default '',
  notes          text default '',
  created_by     text default '',
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- job_id intentionally NOT a foreign key: like the GAS original, deleting a job
-- keeps the invoice line (shown as "(deleted)").
create table if not exists vis_invoice_jobs (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references vis_invoices(id) on delete cascade,
  job_id          uuid not null,
  claimed_sqft    numeric default 0,
  claimed_amount  numeric default 0,
  recorded_sqft   numeric default 0,
  recorded_amount numeric default 0,
  variance_rm     numeric default 0,
  flag            text default ''              -- OK / OVER / UNDER
);
create index if not exists idx_vis_invjobs_inv on vis_invoice_jobs (invoice_id);

-- ─── ROW-LEVEL SECURITY — allowlist-gated everything ────────────────────────
do $$
declare t text;
begin
  foreach t in array array['vis_malls','vis_materials','vis_rates','vis_jobs',
    'vis_job_panels','vis_permits','vis_workers','vis_invoices','vis_invoice_jobs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format('create policy %I_rw on %I for all to authenticated using (is_allowed()) with check (is_allowed())', t, t);
  end loop;
end $$;

-- ─── STORAGE — bucket for sketches / proofs / photos / permits / docs / invoices
insert into storage.buckets (id, name, public) values ('visual','visual', false)
on conflict (id) do nothing;
drop policy if exists "visual_rw" on storage.objects;
create policy "visual_rw" on storage.objects for all to authenticated
  using (bucket_id = 'visual' and is_allowed())
  with check (bucket_id = 'visual' and is_allowed());

-- ─── RATE PICKER — most-specific match wins ─────────────────────────────────
-- mall+material+jobType (7) > mall+material (6) > mall+jobType (5) > mall (4)
-- > material(+type) (2-3) > jobType (1) > ALL (0). Only rates effective on/before
-- the job date count; tie-break = most recent effective_from. NULL if no match.
create or replace function vis_pick_rate(p_mall text, p_material text, p_job_type text, p_date date)
returns vis_rates
language plpgsql stable security definer set search_path = public as $$
declare
  r vis_rates;
begin
  select * into r
  from vis_rates v
  where (v.effective_from is null or p_date is null or v.effective_from <= p_date)
    and (lower(coalesce(v.mall,''))     in ('','all','any','*') or lower(v.mall)     = lower(coalesce(p_mall,'')))
    and (lower(coalesce(v.material,'')) in ('','all','any','*') or lower(v.material) = lower(coalesce(p_material,'')))
    and (lower(coalesce(v.job_type,'')) in ('','all','any','*') or lower(v.job_type) = lower(coalesce(p_job_type,'')))
  order by
    ( (case when lower(coalesce(v.mall,''))     not in ('','all','any','*') then 4 else 0 end)
    + (case when lower(coalesce(v.material,'')) not in ('','all','any','*') then 2 else 0 end)
    + (case when lower(coalesce(v.job_type,'')) not in ('','all','any','*') then 1 else 0 end) ) desc,
    v.effective_from desc nulls last
  limit 1;
  return r;   -- null record when nothing matches
end;
$$;

-- ─── SAVE JOB RPC — server recomputes every sqft + amount (never trusts client)
-- payload: { id?, status?, mall, lotNo, jobType, client, requestedBy, requestDate,
--            installDate, material, notes, permitId, artworkLink,
--            sketchPath?, sketchLink?, proofPath?, proofLink?, sitePhotoPaths?[],
--            panels:[{label,widthVal,heightVal,unit,qty,material?,ratePerSqft?}] }
create or replace function vis_save_job(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_editing   boolean := coalesce(payload->>'id','') <> '';
  v_id        uuid;
  v_old       vis_jobs;
  v_job_no    text;
  v_year      text := to_char(now() at time zone 'Asia/Kuala_Lumpur', 'YYYY');
  v_next      int;
  v_mall      text := trim(coalesce(payload->>'mall',''));
  v_lot       text := trim(coalesce(payload->>'lotNo',''));
  v_type      text;
  v_date      date;
  v_material  text := trim(coalesce(payload->>'material',''));
  v_rate      vis_rates;           -- job-level rate snapshot
  v_prate     vis_rates;           -- per-panel rate lookup
  v_use_pkg   boolean := false;
  v_panel     jsonb;
  v_w numeric; v_h numeric; v_q numeric; v_wft numeric; v_hft numeric;
  v_unit text; v_pmat text; v_prv numeric; v_sqft numeric; v_amt numeric;
  v_total_sqft numeric := 0;
  v_subtotal   numeric := 0;
  v_panels     jsonb := '[]'::jsonb;
  v_job_rate   numeric := 0;
  v_inst_rate  numeric := 0;
  v_inst_amt   numeric := 0;
  v_expected   numeric := 0;
  v_status     text;
  v_sk_url text; v_sk_path text; v_pf_url text; v_pf_path text;
  v_site   jsonb;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  if v_mall = '' then raise exception 'Mall is required.'; end if;
  if v_lot  = '' then raise exception 'Lot number is required.'; end if;

  v_type := case when payload->>'jobType' in ('print_install','print_only','install_only')
                 then payload->>'jobType' else 'print_install' end;
  v_date := coalesce(nullif(trim(coalesce(payload->>'requestDate','')),'')::date,
                     (now() at time zone 'Asia/Kuala_Lumpur')::date);

  if v_editing then
    v_id := (payload->>'id')::uuid;
    select * into v_old from vis_jobs where id = v_id;
    if not found then raise exception 'Job not found for edit.'; end if;
    v_job_no := v_old.job_no;
  else
    v_id := gen_random_uuid();
    -- atomic sequential job number VIS-YYYY-#### (lock the table like LockService did)
    lock table vis_jobs in share row exclusive mode;
    select coalesce(max((regexp_match(job_no, '^VIS-'||v_year||'-(\d+)$'))[1]::int), 0) + 1
      into v_next from vis_jobs where job_no like 'VIS-'||v_year||'-%';
    v_job_no := 'VIS-'||v_year||'-'||lpad(v_next::text, 4, '0');
  end if;

  -- job-level rate snapshot; package (all-in) rate only applies to print+install
  v_rate := vis_pick_rate(v_mall, v_material, v_type, v_date);
  v_use_pkg := (v_type = 'print_install' and v_rate.id is not null and coalesce(v_rate.package_rate,0) > 0);

  -- recompute panels server-side (identical maths to the GAS panelSqft_/saveJob)
  for v_panel in select * from jsonb_array_elements(coalesce(payload->'panels','[]'::jsonb)) loop
    v_w := coalesce(nullif(trim(coalesce(v_panel->>'widthVal','')),'')::numeric, 0);
    v_h := coalesce(nullif(trim(coalesce(v_panel->>'heightVal','')),'')::numeric, 0);
    if v_w = 0 and v_h = 0 then continue; end if;
    v_q    := coalesce(nullif(trim(coalesce(v_panel->>'qty','')),'')::numeric, 1);
    if v_q = 0 then v_q := 1; end if;
    v_unit := case when v_panel->>'unit' in ('mm','cm','m','in','ft') then v_panel->>'unit' else 'mm' end;
    v_wft  := case v_unit when 'mm' then v_w/304.8 when 'cm' then v_w/30.48
                          when 'm' then v_w*3.280839895 when 'in' then v_w/12 else v_w end;
    v_hft  := case v_unit when 'mm' then v_h/304.8 when 'cm' then v_h/30.48
                          when 'm' then v_h*3.280839895 when 'in' then v_h/12 else v_h end;
    v_sqft := round(v_wft * v_hft * v_q, 2);
    v_pmat := coalesce(nullif(trim(coalesce(v_panel->>'material','')),''), v_material);
    -- per-panel rate: explicit > install-only (install rate) > package > print rate
    v_prv := coalesce(nullif(trim(coalesce(v_panel->>'ratePerSqft','')),'')::numeric, 0);
    if v_prv = 0 then
      if v_type = 'install_only' then
        v_prate := vis_pick_rate(v_mall, v_pmat, v_type, v_date);
        v_prv := coalesce(v_prate.install_rate, 0);
      elsif v_use_pkg then
        v_prv := v_rate.package_rate;
      else
        v_prate := vis_pick_rate(v_mall, v_pmat, v_type, v_date);
        v_prv := coalesce(v_prate.rate_per_sqft, 0);
      end if;
    end if;
    v_amt := round(v_sqft * v_prv, 2);
    v_total_sqft := round(v_total_sqft + v_sqft, 2);
    v_subtotal   := round(v_subtotal + v_amt, 2);
    v_panels := v_panels || jsonb_build_object(
      'label', coalesce(v_panel->>'label',''), 'width_val', v_w, 'height_val', v_h,
      'unit', v_unit, 'qty', v_q, 'sqft', v_sqft, 'material', v_pmat,
      'rate_per_sqft', v_prv, 'amount', v_amt);
  end loop;

  v_job_rate  := case when v_type = 'install_only' then coalesce(v_rate.install_rate,0)
                      when v_use_pkg then v_rate.package_rate
                      else coalesce(v_rate.rate_per_sqft,0) end;
  v_inst_rate := coalesce(v_rate.install_rate,0);
  -- separate install line only for print+install on the split (non-package) rate
  v_inst_amt  := case when v_type = 'print_install' and not v_use_pkg
                      then round(v_total_sqft * v_inst_rate, 2) else 0 end;
  v_expected  := round(v_subtotal + v_inst_amt, 2);
  if v_rate.id is not null and coalesce(v_rate.min_charge,0) > 0 and v_expected < v_rate.min_charge then
    v_expected := round(v_rate.min_charge, 2);
  end if;

  -- sketch & proof: new upload > pasted link > existing value
  v_sk_url  := case when v_editing then v_old.sketch_url  else '' end;
  v_sk_path := case when v_editing then v_old.sketch_path else '' end;
  if coalesce(payload->>'sketchPath','') <> '' then
    v_sk_path := payload->>'sketchPath'; v_sk_url := '';
  elsif trim(coalesce(payload->>'sketchLink','')) <> '' then
    v_sk_url := trim(payload->>'sketchLink'); v_sk_path := '';
  end if;
  v_pf_url  := case when v_editing then v_old.artwork_proof_url  else '' end;
  v_pf_path := case when v_editing then v_old.artwork_proof_path else '' end;
  if coalesce(payload->>'proofPath','') <> '' then
    v_pf_path := payload->>'proofPath'; v_pf_url := '';
  elsif trim(coalesce(payload->>'proofLink','')) <> '' then
    v_pf_url := trim(payload->>'proofLink'); v_pf_path := '';
  end if;
  -- site photos: append new uploads to the existing set
  v_site := coalesce(case when v_editing then v_old.site_photo_paths end, '[]'::jsonb)
            || coalesce(payload->'sitePhotoPaths','[]'::jsonb);

  v_status := case when payload->>'status' in ('NEW','DRAFT_IN','SENT_CLIENT','ARTWORK_REJECTED',
                        'APPROVED','PRINTING','INSTALLED','COMPLETED','CANCELLED')
                   then payload->>'status'
                   when v_editing then v_old.status else 'NEW' end;

  if v_editing then
    update vis_jobs set
      status = v_status, mall = v_mall, lot_no = v_lot, job_type = v_type,
      client = trim(coalesce(payload->>'client','')),
      requested_by = coalesce(nullif(trim(coalesce(payload->>'requestedBy','')),''), current_email()),
      request_date = v_date,
      install_date = nullif(trim(coalesce(payload->>'installDate','')),'')::date,
      artwork_link = trim(coalesce(payload->>'artworkLink','')),
      artwork_proof_url = v_pf_url, artwork_proof_path = v_pf_path,
      sketch_url = v_sk_url, sketch_path = v_sk_path,
      site_photo_paths = v_site,
      material = v_material, total_sqft = v_total_sqft,
      rate_id = v_rate.id, rate_per_sqft = v_job_rate, install_rate = v_inst_rate,
      subtotal = v_subtotal, expected_amount = v_expected,
      permit_id = nullif(trim(coalesce(payload->>'permitId','')),'')::uuid,
      notes = trim(coalesce(payload->>'notes','')),
      updated_at = now()
    where id = v_id;
    delete from vis_job_panels where job_id = v_id;   -- replace panels
  else
    insert into vis_jobs (id, job_no, status, mall, lot_no, job_type, client, requested_by,
      request_date, install_date, artwork_link, artwork_proof_url, artwork_proof_path,
      sketch_url, sketch_path, site_photo_paths, material, total_sqft, rate_id,
      rate_per_sqft, install_rate, subtotal, expected_amount, permit_id, notes, created_by)
    values (v_id, v_job_no, v_status, v_mall, v_lot, v_type,
      trim(coalesce(payload->>'client','')),
      coalesce(nullif(trim(coalesce(payload->>'requestedBy','')),''), current_email()),
      v_date, nullif(trim(coalesce(payload->>'installDate','')),'')::date,
      trim(coalesce(payload->>'artworkLink','')), v_pf_url, v_pf_path,
      v_sk_url, v_sk_path, v_site, v_material, v_total_sqft, v_rate.id,
      v_job_rate, v_inst_rate, v_subtotal, v_expected,
      nullif(trim(coalesce(payload->>'permitId','')),'')::uuid,
      trim(coalesce(payload->>'notes','')), current_email());
  end if;

  insert into vis_job_panels (job_id, label, width_val, height_val, unit, qty, sqft, material, rate_per_sqft, amount)
  select v_id, p->>'label', (p->>'width_val')::numeric, (p->>'height_val')::numeric,
         p->>'unit', (p->>'qty')::numeric, (p->>'sqft')::numeric, p->>'material',
         (p->>'rate_per_sqft')::numeric, (p->>'amount')::numeric
  from jsonb_array_elements(v_panels) as p;

  -- rememberMall_
  if lower(v_mall) <> 'all' then
    insert into vis_malls (name) values (v_mall) on conflict (name) do nothing;
  end if;

  perform log_audit(case when v_editing then 'vis.job.update' else 'vis.job.create' end,
    v_job_no||' · '||v_mall||' · Lot '||v_lot||' · '||v_total_sqft||' sqft · RM '||v_expected);

  return jsonb_build_object('ok', true, 'id', v_id, 'jobNo', v_job_no,
                            'totalSqft', v_total_sqft, 'expectedAmount', v_expected);
end;
$$;

-- ─── SAVE INVOICE RPC — logs B's invoice + lines, runs the reconciliation ────
-- Tolerance: OK when |claimed − recorded| ≤ RM 5 OR ≤ 1% (same as RECON_TOL_*).
-- payload: { id?, invNo, invDate, period, status?, notes, claimedAmount, sstEnabled,
--            filePath?, fileUrl?, lines:[{jobId, claimedSqft, claimedAmount}] }
create or replace function vis_save_invoice(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_editing boolean := coalesce(payload->>'id','') <> '';
  v_id      uuid;
  v_old     vis_invoices;
  v_line    jsonb;
  v_job     vis_jobs;
  v_malls   text[] := '{}';
  v_csqft numeric; v_camt numeric; v_ramt numeric; v_rsqft numeric;
  v_diff numeric; v_pct numeric; v_flag text;
  v_line_claim numeric := 0; v_line_rec numeric := 0; v_flagged int := 0; v_count int := 0;
  v_links jsonb := '[]'::jsonb;
  v_claimed numeric; v_sst_on boolean; v_sst numeric; v_ctotal numeric;
  v_verdict text; v_note text;
  v_furl text; v_fpath text; v_status text;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  if trim(coalesce(payload->>'invNo','')) = '' then raise exception 'B''s invoice number is required.'; end if;

  if v_editing then
    v_id := (payload->>'id')::uuid;
    select * into v_old from vis_invoices where id = v_id;
    if not found then raise exception 'Invoice not found.'; end if;
  else
    v_id := gen_random_uuid();
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(payload->'lines','[]'::jsonb)) loop
    if coalesce(v_line->>'jobId','') = '' then continue; end if;
    select * into v_job from vis_jobs where id = (v_line->>'jobId')::uuid;
    v_rsqft := coalesce(v_job.total_sqft, 0);
    v_ramt  := coalesce(v_job.expected_amount, 0);
    if v_job.mall is not null and not (v_job.mall = any(v_malls)) then
      v_malls := v_malls || v_job.mall;
    end if;
    v_csqft := round(coalesce(nullif(trim(coalesce(v_line->>'claimedSqft','')),'')::numeric, 0), 2);
    v_camt  := round(coalesce(nullif(trim(coalesce(v_line->>'claimedAmount','')),'')::numeric, 0), 2);
    v_line_claim := round(v_line_claim + v_camt, 2);
    v_line_rec   := round(v_line_rec + v_ramt, 2);
    v_diff := abs(v_camt - v_ramt);
    v_pct  := case when v_ramt <> 0 then v_diff / abs(v_ramt) when v_diff <> 0 then 1 else 0 end;
    v_flag := case when v_diff <= 5.00 or v_pct <= 0.01 then 'OK'
                   when v_camt > v_ramt then 'OVER' else 'UNDER' end;
    if v_flag <> 'OK' then v_flagged := v_flagged + 1; end if;
    v_count := v_count + 1;
    v_links := v_links || jsonb_build_object(
      'job_id', v_line->>'jobId', 'claimed_sqft', v_csqft, 'claimed_amount', v_camt,
      'recorded_sqft', v_rsqft, 'recorded_amount', v_ramt,
      'variance_rm', round(v_camt - v_ramt, 2), 'flag', v_flag);
  end loop;

  v_claimed := coalesce(nullif(trim(coalesce(payload->>'claimedAmount','')),'')::numeric, 0);
  if v_claimed = 0 then v_claimed := v_line_claim; end if;
  v_claimed := round(v_claimed, 2);
  v_sst_on  := coalesce((payload->>'sstEnabled')::boolean, false);
  v_sst     := case when v_sst_on then round(v_claimed * 0.06, 2) else 0 end;
  v_ctotal  := round(v_claimed + v_sst, 2);
  v_verdict := case when v_flagged > 0 then 'CHECK' else 'MATCH' end;
  v_note    := case when v_flagged > 0
    then v_flagged||' of '||v_count||' job(s) differ from HG record · claimed RM '||v_line_claim||' vs recorded RM '||v_line_rec
    else v_count||' job(s) tally with HG record' end;

  -- invoice file: new upload/link replaces; else keep existing
  v_furl  := case when v_editing then v_old.file_url  else '' end;
  v_fpath := case when v_editing then v_old.file_path else '' end;
  if coalesce(payload->>'filePath','') <> '' then
    v_fpath := payload->>'filePath'; v_furl := '';
  elsif coalesce(payload->>'fileUrl','') <> '' then
    v_furl := payload->>'fileUrl';
  end if;

  v_status := coalesce(nullif(trim(coalesce(payload->>'status','')),''),
                       case when v_verdict = 'MATCH' then 'verified' else 'checking' end);

  if v_editing then
    update vis_invoices set
      inv_no = trim(payload->>'invNo'),
      inv_date = coalesce(nullif(trim(coalesce(payload->>'invDate','')),'')::date,
                          (now() at time zone 'Asia/Kuala_Lumpur')::date),
      period = trim(coalesce(payload->>'period','')),
      malls = array_to_string(v_malls, ', '),
      claimed_amount = v_claimed, sst_enabled = v_sst_on, sst_amount = v_sst, claimed_total = v_ctotal,
      file_url = v_furl, file_path = v_fpath, status = v_status,
      recon_verdict = v_verdict, recon_note = v_note,
      notes = trim(coalesce(payload->>'notes','')), updated_at = now()
    where id = v_id;
    delete from vis_invoice_jobs where invoice_id = v_id;
  else
    insert into vis_invoices (id, inv_no, inv_date, period, malls, claimed_amount, sst_enabled,
      sst_amount, claimed_total, file_url, file_path, status, recon_verdict, recon_note, notes, created_by)
    values (v_id, trim(payload->>'invNo'),
      coalesce(nullif(trim(coalesce(payload->>'invDate','')),'')::date,
               (now() at time zone 'Asia/Kuala_Lumpur')::date),
      trim(coalesce(payload->>'period','')), array_to_string(v_malls, ', '),
      v_claimed, v_sst_on, v_sst, v_ctotal, v_furl, v_fpath, v_status,
      v_verdict, v_note, trim(coalesce(payload->>'notes','')), current_email());
  end if;

  insert into vis_invoice_jobs (invoice_id, job_id, claimed_sqft, claimed_amount,
                                recorded_sqft, recorded_amount, variance_rm, flag)
  select v_id, (l->>'job_id')::uuid, (l->>'claimed_sqft')::numeric, (l->>'claimed_amount')::numeric,
         (l->>'recorded_sqft')::numeric, (l->>'recorded_amount')::numeric,
         (l->>'variance_rm')::numeric, l->>'flag'
  from jsonb_array_elements(v_links) as l;

  perform log_audit(case when v_editing then 'vis.invoice.update' else 'vis.invoice.create' end,
    trim(payload->>'invNo')||' · '||v_verdict||' · '||v_count||' job(s) · claimed RM '||v_claimed||' · '||v_note);

  return jsonb_build_object('ok', true, 'id', v_id, 'verdict', v_verdict,
    'flagged', v_flagged, 'claimedTotal', v_ctotal, 'reconNote', v_note);
end;
$$;

-- ─── ALARMS VIEW — for the daily-alarms edge function + the dashboard ────────
-- Permits expiring within 14 days (or expired); worker docs within 30 days.
create or replace view vis_alarms
with (security_invoker = true) as
select 'permit_expiry'::text as alarm_type,
       coalesce(nullif(p.permit_no,''), nullif(p.permit_type,''), 'permit') as ref,
       'Permit · '||p.mall
         || case when coalesce(p.lot_no,'') <> '' then ' · Lot '||p.lot_no else '' end
         || case when coalesce(p.permit_type,'') <> '' then ' · '||p.permit_type else '' end as detail,
       p.valid_to as due_date,
       coalesce((select value from app_settings where key = 'COMPANY_EMAIL'), '') as recipient
from vis_permits p
where p.valid_to is not null
  and p.valid_to <= (now() at time zone 'Asia/Kuala_Lumpur')::date + 14
union all
select 'worker_doc_expiry', w.name, 'Worker doc · '||w.name||' · CIDB Green Card', w.cidb_expiry,
       coalesce((select value from app_settings where key = 'COMPANY_EMAIL'), '')
from vis_workers w
where lower(coalesce(w.status,'')) <> 'inactive' and w.cidb_expiry is not null
  and w.cidb_expiry <= (now() at time zone 'Asia/Kuala_Lumpur')::date + 30
union all
select 'worker_doc_expiry', w.name, 'Worker doc · '||w.name||' · Work at Height (WAH)', w.wah_expiry,
       coalesce((select value from app_settings where key = 'COMPANY_EMAIL'), '')
from vis_workers w
where lower(coalesce(w.status,'')) <> 'inactive' and w.wah_expiry is not null
  and w.wah_expiry <= (now() at time zone 'Asia/Kuala_Lumpur')::date + 30
union all
select 'worker_doc_expiry', w.name,
       'Worker doc · '||w.name||' · '||coalesce(nullif(w.doc_type,''),'Document'), w.doc_expiry,
       coalesce((select value from app_settings where key = 'COMPANY_EMAIL'), '')
from vis_workers w
where lower(coalesce(w.status,'')) <> 'inactive' and w.doc_expiry is not null
  and w.doc_expiry <= (now() at time zone 'Asia/Kuala_Lumpur')::date + 30;

-- Done. Open visual-supabase.html, connect once, sign in with an allowlisted account.
