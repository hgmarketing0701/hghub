-- ============================================================================
-- HG GROUP — BLOG & LINKEDIN POSTING · Supabase schema (prefix: blg_)
-- Run AFTER the foundation schema (supabase/schema.sql).
-- Additive + idempotent — safe to re-run.
--
-- Replaces the Apps Script backend (blog-linkedin.gs):
--   Google Sheet "Posts"            → blg_posts
--   Drive folder (post images)      → storage bucket 'blog-images' (private)
--   ?action=pending JSON API        → blg_pending view
--   ?action=mark JSON API           → blg_mark() RPC
-- ============================================================================

-- ─── 1 · POSTS ──────────────────────────────────────────────────────────────
create table if not exists blg_posts (
  id              uuid primary key default gen_random_uuid(),
  ref             text not null unique,              -- human ref, e.g. P1719912345678
  job_scope       text default '',
  mall            text default '',
  brand           text default '',
  job_date        date,
  caption         text default '',
  target          text not null default 'Both',     -- Both / Wix / LinkedIn
  wix_status      text not null default 'Pending',  -- Pending / Drafted / Posted / N/A
  linkedin_status text not null default 'Pending',  -- Pending / Drafted / Posted / N/A
  wix_link        text default '',
  linkedin_link   text default '',
  image_paths     text[] not null default '{}',     -- storage paths, first = cover
  pushed_at       timestamptz,
  created_by      text default '',
  created_at      timestamptz default now()
);
create index if not exists idx_blg_posts_created on blg_posts (created_at desc);

alter table blg_posts enable row level security;
drop policy if exists blg_posts_rw on blg_posts;
create policy blg_posts_rw on blg_posts for all to authenticated
  using (is_allowed()) with check (is_allowed());

-- ─── 2 · IMAGE BUCKET (replaces the Drive folder) ───────────────────────────
insert into storage.buckets (id, name, public) values ('blog-images','blog-images', false)
on conflict (id) do nothing;
drop policy if exists "blog-images_rw" on storage.objects;
create policy "blog-images_rw" on storage.objects for all to authenticated
  using (bucket_id = 'blog-images' and is_allowed())
  with check (bucket_id = 'blog-images' and is_allowed());

-- ─── 3 · PENDING QUEUE (was ?action=pending — what Claude pushes to drafts) ─
drop view if exists blg_pending;
create view blg_pending with (security_invoker = true) as
select id, ref, job_scope, mall, brand, job_date, caption, target,
       wix_status, linkedin_status, image_paths, created_at
from blg_posts
where wix_status = 'Pending' or linkedin_status = 'Pending';

-- ─── 4 · MARK RPC (was ?action=mark — write draft status + link back) ───────
-- blg_mark('P1719912345678', 'wix', 'Drafted', 'https://...') → also stamps pushed_at
create or replace function blg_mark(p_ref text, p_channel text, p_status text, p_link text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_allowed() then raise exception 'Not authorised.'; end if;
  select id into v_id from blg_posts where ref = p_ref;
  if v_id is null then return jsonb_build_object('error', 'ref not found: ' || p_ref); end if;
  if p_channel = 'wix' then
    update blg_posts set
      wix_status = coalesce(nullif(p_status,''), wix_status),
      wix_link   = coalesce(nullif(p_link,''),   wix_link),
      pushed_at  = now()
    where id = v_id;
  elsif p_channel = 'linkedin' then
    update blg_posts set
      linkedin_status = coalesce(nullif(p_status,''), linkedin_status),
      linkedin_link   = coalesce(nullif(p_link,''),   linkedin_link),
      pushed_at       = now()
    where id = v_id;
  else
    return jsonb_build_object('error', 'unknown channel: ' || coalesce(p_channel,''));
  end if;
  perform log_audit('MARK POST', p_ref || ' · ' || p_channel || ' → ' || coalesce(p_status,''));
  return jsonb_build_object('ok', true, 'ref', p_ref);
end;
$$;

-- Done. The tool UI is blog-supabase.html (project root).
