# MySQL translation conventions (Postgres/Supabase → MySQL 8)

Target: MySQL 8.0 on cPanel. Engine InnoDB, charset `utf8mb4`, collation `utf8mb4_unicode_ci`.
Every module file must be idempotent: `CREATE TABLE IF NOT EXISTS` only, no DROPs.

## Type mapping

| Postgres | MySQL |
|---|---|
| `uuid` PK w/ `gen_random_uuid()` | `CHAR(36) NOT NULL` PK, `DEFAULT (uuid())` |
| other id/text ids (prefixed codes) | `VARCHAR(64)` |
| `text` (names, labels, emails, urls) | `VARCHAR(255)`; genuinely long content (notes, descriptions, json-ish text, base64) → `TEXT`/`MEDIUMTEXT` |
| `timestamptz` | `DATETIME` (store Asia/Kuala_Lumpur local). `created_at DATETIME DEFAULT CURRENT_TIMESTAMP` |
| `date` | `DATE` |
| `numeric` / money | `DECIMAL(14,2)`; rates with more precision `DECIMAL(14,4)`; qty `DECIMAL(12,2)` |
| `integer`/`bigint` | `INT`/`BIGINT` |
| `generated always as identity` | `BIGINT AUTO_INCREMENT` |
| `boolean` | `TINYINT(1)` (0/1) |
| `jsonb` / `json` | `JSON` |
| `text[]` | `JSON` (array of strings) |

## Structural rules

1. **Table + column names: keep EXACTLY as in the Supabase schema** (snake_case, module prefixes `inv_`, `scf_`, `trn_`, …). The frontend tools reference these names via the API — renames break them.
2. **No FOREIGN KEY constraints.** Production data may contain orphans; import must not fail. Add a plain `INDEX` on every column that was an FK (`..._id`, parent-id columns).
3. Keep `UNIQUE` constraints only where the Supabase schema had them AND the data is system-generated (quote numbers, etc.). When in doubt, use a plain index — production data wins.
4. **Drop entirely:** `create extension`, RLS (`alter table ... enable row level security`), `create policy`, `grant`/`revoke`, `storage.buckets` inserts, `auth.*` references, `security definer` bits, `comment on`.
5. **Functions (`create or replace function`) and triggers: DO NOT translate.** They are ported to JS in the Express API (Phase 2). Instead, append a comment block at the END of your output file: `-- RPC-PORT: <function_name>(<args>) — <one-line what it does>` for each function in your source schema, so Phase 2 has a checklist.
6. **Views:** simple `create view` → keep as MySQL views (translate syntax). Functions returning json/table → RPC-PORT comment instead.
7. **Storage buckets:** where the schema created buckets (or the tool uploads to `storage.from('<bucket>')`), append `-- BUCKET: <name>` comment lines at the end of the file.
8. `default now()` → `DEFAULT CURRENT_TIMESTAMP`. `default auth.uid()/current_email()` → drop the default (API supplies it).
9. Postgres `text check (col in (...))` → keep as MySQL 8 `CHECK` when trivial, else drop the check and keep the column.
10. Index syntax: `CREATE INDEX` is not idempotent in MySQL — define indexes INLINE in the CREATE TABLE (`INDEX idx_name (col)`).

## Reconciliation against production xlsx (AUTHORITATIVE)

For your module, find the matching tabs in `mysql/xlsx-headers.md` (real headers + row counts exported 2026-07-16) and the schema notes in the client's handoff (`C:\Users\User\hg-migration-data\AI-HANDOFF.md` §6):

- Production xlsx column that has NO equivalent column in the Supabase table → **ADD it** (mapped to the same style: camelCase headers stay camelCase? NO — convert header to the table's existing naming style; if the table uses snake_case, snake_case it) and add a trailing comment `-- XLSX-ADDED`.
- Supabase column missing from xlsx → keep it (tools use it).
- When the xlsx header is a JSON-string cell (`lineItems`, `attachments`, `stopsJson`, `Files (JSON)`, `*PhotoIds`, `_json`) → column type `JSON`.
- Google Drive URLs/IDs stay `VARCHAR(512)`/`TEXT` — files are not migrating yet.

## File format

Each module = one file `mysql/modules/NN-<module>.sql`:
```sql
-- ============================================================
-- HG hub — <module> (MySQL 8) — translated from supabase/schema-<x>.sql
-- Reconciled against <xlsx file> (2026-07-16)
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS <name> ( ... ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
...
-- RPC-PORT: ...
-- BUCKET: ...
```
No `USE` statement, no `CREATE DATABASE` (phpMyAdmin imports into the selected DB).
