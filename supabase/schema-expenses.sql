-- ============================================================================
-- HG GROUP — EXPENSES RECEIPT SYSTEM · Supabase schema  (prefix: exp_)
-- Converted from apps-script-expenses (Google Apps Script + bound Sheet).
-- Run AFTER the foundation schema (supabase/schema.sql). Safe to re-run:
-- everything is IF NOT EXISTS / ON CONFLICT DO NOTHING / CREATE OR REPLACE.
--
-- What it creates:
--   1. exp_categories          — admin-editable category list ('other' = locked fallback)
--   2. exp_expenses            — one row per receipt (per-user private via RLS)
--   3. category RPCs           — exp_add_category / exp_rename_category / exp_delete_category
--                                (atomic: rename/delete re-tags existing receipts)
--   4. expense-receipts bucket — private storage for receipt images/PDFs,
--                                one folder per user email (private per user, admin sees all)
--   5. RLS                     — staff see ONLY their own rows; admin sees everyone's
--
-- Uses (never redefines) from the foundation: allowed_users, is_allowed(),
-- is_admin(), current_email(), log_audit().
-- ============================================================================

-- ─── 1 · CATEGORIES (was Script Properties CATEGORIES_JSON) ─────────────────
create table if not exists exp_categories (
  name text primary key,
  sort int default 0
);

-- Seed = the GAS CATEGORIES list. 'other' is the locked fallback (sort last).
insert into exp_categories (name, sort) values
  ('food', 1), ('grocery', 2), ('fuel', 3), ('transport', 4),
  ('accommodation', 5), ('parking', 6), ('toll', 7), ('materials', 8),
  ('tools', 9), ('office', 10), ('utilities', 11), ('phone', 12),
  ('other', 999)
on conflict (name) do nothing;

-- ─── 2 · EXPENSES (was the 'Expenses' sheet) ────────────────────────────────
create table if not exists exp_expenses (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz default now(),
  created_by   text default '',                    -- was submittedBy (owner email)
  receipt_date date not null default (now() at time zone 'Asia/Kuala_Lumpur')::date,
  month_key    text default '',                    -- yyyy-MM, kept in sync by trigger
  vendor       text default '',
  description  text default '',
  category     text default 'other',
  currency     text default 'RM',
  amount       numeric default 0,
  type         text default 'business',            -- business / personal
  status       text default 'recorded',
  image_path   text default '',                    -- storage path in expense-receipts bucket
  remarks      text default ''
);
create index if not exists idx_exp_expenses_owner on exp_expenses (created_by);
create index if not exists idx_exp_expenses_month on exp_expenses (month_key);

-- month_key always derived from receipt_date (was monthKeyOf_ in Code.gs)
create or replace function exp_set_month_key() returns trigger
language plpgsql as $$
begin
  new.month_key := to_char(new.receipt_date, 'YYYY-MM');
  return new;
end;
$$;
drop trigger if exists exp_expenses_month_key on exp_expenses;
create trigger exp_expenses_month_key
  before insert or update on exp_expenses
  for each row execute function exp_set_month_key();

-- ─── 3 · CATEGORY RPCs (admin-only, atomic re-tagging like the GAS version) ─
create or replace function exp_add_category(p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare v_name text := lower(trim(regexp_replace(coalesce(p_name,''), '\s+', ' ', 'g')));
begin
  if not is_admin() then raise exception 'Only the admin can manage categories.'; end if;
  if v_name = '' then raise exception 'Enter a category name.'; end if;
  if v_name !~ '^[a-z0-9 &/-]+$' then raise exception 'Use letters, numbers, spaces, & / - only.'; end if;
  if length(v_name) > 24 then raise exception 'Keep it under 24 characters.'; end if;
  if exists (select 1 from exp_categories where name = v_name) then
    raise exception '"%" already exists.', v_name;
  end if;
  insert into exp_categories (name, sort)
  values (v_name, (select coalesce(max(sort), 0) + 1 from exp_categories where sort < 999));
  perform log_audit('EXP category-add', v_name);
end;
$$;

create or replace function exp_rename_category(p_old text, p_new text) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_old text := lower(trim(regexp_replace(coalesce(p_old,''), '\s+', ' ', 'g')));
  v_new text := lower(trim(regexp_replace(coalesce(p_new,''), '\s+', ' ', 'g')));
  v_moved int;
begin
  if not is_admin() then raise exception 'Only the admin can manage categories.'; end if;
  if v_old = '' or v_new = '' then raise exception 'Missing name.'; end if;
  if v_old = 'other' then raise exception '"other" is the fallback category — it cannot be renamed.'; end if;
  if v_new !~ '^[a-z0-9 &/-]+$' then raise exception 'Use letters, numbers, spaces, & / - only.'; end if;
  if length(v_new) > 24 then raise exception 'Keep it under 24 characters.'; end if;
  if not exists (select 1 from exp_categories where name = v_old) then
    raise exception '"%" not found.', v_old;
  end if;
  if v_old <> v_new and exists (select 1 from exp_categories where name = v_new) then
    raise exception '"%" already exists.', v_new;
  end if;
  update exp_categories set name = v_new where name = v_old;
  update exp_expenses set category = v_new where category = v_old;   -- keep receipts consistent
  get diagnostics v_moved = row_count;
  perform log_audit('EXP category-rename', v_old || ' -> ' || v_new || ' (' || v_moved || ' rows)');
  return v_moved;
end;
$$;

create or replace function exp_delete_category(p_name text) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_name text := lower(trim(regexp_replace(coalesce(p_name,''), '\s+', ' ', 'g')));
  v_moved int;
begin
  if not is_admin() then raise exception 'Only the admin can manage categories.'; end if;
  if v_name = 'other' then raise exception '"other" cannot be deleted — it is the fallback.'; end if;
  if not exists (select 1 from exp_categories where name = v_name) then
    raise exception '"%" not found.', v_name;
  end if;
  delete from exp_categories where name = v_name;
  update exp_expenses set category = 'other' where category = v_name;  -- affected receipts -> other
  get diagnostics v_moved = row_count;
  perform log_audit('EXP category-delete', v_name || ' (' || v_moved || ' rows -> other)');
  return v_moved;
end;
$$;

-- ─── 4 · STORAGE — receipt images (was Google Drive per-user folders) ───────
insert into storage.buckets (id, name, public) values ('expense-receipts','expense-receipts', false)
on conflict (id) do nothing;

-- Private per user, like the Drive per-person subfolders: each user may only
-- touch objects under their own email folder; admin may touch everything.
drop policy if exists "expense-receipts_rw" on storage.objects;
create policy "expense-receipts_rw" on storage.objects for all to authenticated
  using (bucket_id = 'expense-receipts' and is_allowed()
         and (is_admin() or (storage.foldername(name))[1] = current_email()))
  with check (bucket_id = 'expense-receipts' and is_allowed()
              and (is_admin() or (storage.foldername(name))[1] = current_email()));

-- ─── 5 · ROW-LEVEL SECURITY ─────────────────────────────────────────────────
-- Per-user privacy exactly like the GAS version: staff see only their own
-- receipts; admin sees everyone's. Enforced by the database, not the screen.
alter table exp_expenses enable row level security;
drop policy if exists exp_expenses_rw on exp_expenses;
create policy exp_expenses_rw on exp_expenses for all to authenticated
  using (is_allowed() and (is_admin() or created_by = current_email()))
  with check (is_allowed() and (is_admin() or created_by = current_email()));

-- Categories: everyone allowlisted may read (dropdowns); writes only via the
-- admin-guarded security definer RPCs above.
alter table exp_categories enable row level security;
drop policy if exists exp_categories_read on exp_categories;
create policy exp_categories_read on exp_categories for select to authenticated
  using (is_allowed());

-- Done. Frontend: expenses-supabase.html · AI reading: 'gemini-receipt' Edge Function.
