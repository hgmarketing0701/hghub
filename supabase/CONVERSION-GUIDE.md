# HG Apps Script → Supabase Conversion Guide (for conversion agents)

You are converting ONE Google Apps Script web app into a local single-file HTML app
backed by Supabase. **Faithful conversion — do not change what the tool does, do not
invent features, do not drop features** (except the two server-only cases in §6).

## 0 · Read these two files FIRST — they are the canonical pattern
1. `quotation-supabase.html` (project root) — the finished example conversion. Copy its:
   - CSS design tokens & component styles (HG dark theme, amber `#f59e0b` accent)
   - **Gate flow**: `gateConfig` (Supabase URL/key connect screen) → `gateLogin`
     (Google sign-in) → `gateDenied` (not on allowlist) → app
   - Config storage: `localStorage` keys **`hg_supabase_url`** / **`hg_supabase_key`**
     (SAME keys in every tool — user connects/signs in once per browser for ALL tools)
   - Key validation: accepts `eyJ…` OR `sb_publishable_…` keys
   - **Iframe-safe `signIn()`** (skipBrowserRedirect + `window.top.location` when embedded) — copy it verbatim
   - `route()` allowlist check against `allowed_users`
   - Excel export via SheetJS CDN, PDF via print-window
2. `supabase/schema.sql` — the FOUNDATION already deployed. You may **use** (never redefine):
   `allowed_users`, `is_allowed()`, `is_admin()`, `current_email()`, `log_audit(action, details)`,
   `clients`, `app_settings`, `audit_log`.

## 1 · Study your assigned app
Read its `Code.gs` fully (data model = the `ensureSheet(...)` headers + seed functions;
business logic = every public function the UI calls) and its `Index.html`
(every `google.script.run.<fn>` call + every tab/modal/feature). Read `DEPLOY*.md` for intent.

## 2 · Output files (create ONLY these two — never edit existing files, NEVER touch hub.html)
1. `supabase/schema-<slug>.sql` — additive, idempotent (`create table if not exists`,
   `on conflict do nothing`), runnable AFTER the foundation schema.
2. `<slug>-supabase.html` — the converted app, single self-contained file at project root.

## 3 · Schema conventions
- **Prefix every table** with your assigned prefix (e.g. `lry_vehicles`) — 14 tools share one database.
- snake_case columns; `id uuid primary key default gen_random_uuid()`;
  `created_by text default ''`, `created_at timestamptz default now()` on transaction tables.
- Money `numeric`; currency is RM; timezone `Asia/Kuala_Lumpur`.
- **RLS on EVERY table**:
  ```sql
  alter table <t> enable row level security;
  drop policy if exists <t>_rw on <t>;
  create policy <t>_rw on <t> for all to authenticated
    using (is_allowed()) with check (is_allowed());
  ```
  If the original had per-user privacy (e.g. staff see only their own rows, admin sees all),
  reproduce it: `using (is_admin() or created_by = current_email())`.
- Reproduce the GAS `setup()` seed rows (guard with `on conflict` / `where not exists`).
- Sequential document numbers (invoice/quote style `PREFIX-YYYY-###`): use a
  `security definer` plpgsql RPC like `save_quote` in the foundation schema.
- Complex multi-row saves the GAS server recomputed: implement as a `security definer` RPC
  that recomputes server-side (copy the `save_quote` style, and `raise exception` unless `is_allowed()`).

## 4 · File / photo storage (replaces Google Drive)
If the app stores photos/PDFs, add to your schema:
```sql
insert into storage.buckets (id, name, public) values ('<bucket>','<bucket>', false)
on conflict (id) do nothing;
drop policy if exists "<bucket>_rw" on storage.objects;
create policy "<bucket>_rw" on storage.objects for all to authenticated
  using (bucket_id = '<bucket>' and is_allowed())
  with check (bucket_id = '<bucket>' and is_allowed());
```
Frontend: `sb.storage.from('<bucket>').upload(path, file)` and `.createSignedUrl(path, 3600)`
for viewing (buckets are private). Store the storage path in the row.

## 5 · Frontend conventions
- Vanilla JS + `@supabase/supabase-js@2` UMD CDN + `xlsx@0.18.5` CDN (only if exporting).
- Reproduce ALL tabs, forms, lists, filters, modals and calculations of the original UI.
  Where the original `Index.html` logic is client-side already, port it near-verbatim.
- Replace every `google.script.run.fnName(args)` with the equivalent supabase query/RPC.
- Audit every write: `await sb.rpc('log_audit', { p_action:'…', p_details:'…' })`.
- Add **⬇ Export Excel** on every main list view (SheetJS) and keep any print/PDF output
  the original had (print-window pattern).
- Keep the topbar (HG logo block, tool name, user pill + sign out) like `quotation-supabase.html`.

## 6 · Server-only features — do NOT try to run these in the browser
1. **Gemini receipt/photo AI**: call the shared Edge Function instead:
   ```js
   const r = await sb.functions.invoke('gemini-receipt', { body: { imageBase64, mimeType } });
   // r.data = { vendor, date, total, category, ... }
   ```
   If it errors with "Function not found", show a friendly message
   ("AI reading not deployed yet — fill in manually") and let the user type the fields.
2. **Scheduled email alarms/digests** (permit expiry, doc expiry, collection reminders,
   renewal notices): the `daily-alarms` Edge Function handles sending. Your job:
   create a SQL **view** named `<prefix>_alarms` in your schema that SELECTs the rows
   due for alerting (columns: `alarm_type text, ref text, detail text, due_date date, recipient text`).
   In the UI, show the same alarm list the emails would contain (query the view) so nothing is lost.

## 7 · Report back (your final message)
- Files created (both paths)
- Tables/views/RPCs/buckets created
- Feature map: original feature → where it lives now (one line each)
- Anything you could NOT convert faithfully and why
Keep it compact.
