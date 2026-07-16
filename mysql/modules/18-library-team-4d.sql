-- ============================================================
-- HG hub — hoarding-library + team-command + 4d-tracker (MySQL 8)
-- NEW tables — these three tools never had a Supabase schema.
-- Designed from production xlsx headers (AUTHORITATIVE):
--   16-hoarding-library.xlsx / 18-team-command.xlsx / 25-4d-tracker.xlsx (2026-07-16)
-- + AI-HANDOFF.md §6 notes (16 / 18 / 25).
-- Original string IDs are preserved as natural keys (VARCHAR(64)).
-- No FOREIGN KEYs by convention — plain INDEX on every *_id column.
-- ============================================================
SET NAMES utf8mb4;

-- ════════════════════════════════════════════════════════════
-- 16 · HOARDING MEASUREMENT LIBRARY  (hlib_)
-- ════════════════════════════════════════════════════════════

-- ─── Records (2,899 rows — measurements + MailBot email-scraped) ─
CREATE TABLE IF NOT EXISTS hlib_records (
  id            VARCHAR(64) NOT NULL,               -- xlsx: ID
  lot           VARCHAR(255) DEFAULT '',
  mall          VARCHAR(255) DEFAULT '',
  tenant        VARCHAR(255) DEFAULT '',
  length_m      DECIMAL(10,2) DEFAULT NULL,         -- xlsx: Length (m)
  height_m      DECIMAL(10,2) DEFAULT NULL,         -- xlsx: Height (m)
  area_m2       DECIMAL(12,2) DEFAULT NULL,         -- xlsx: Area (m2)
  panels        INT DEFAULT NULL,                   -- panel count
  door_type     VARCHAR(64) DEFAULT '',
  door_qty      INT DEFAULT NULL,
  door_size     VARCHAR(64) DEFAULT '',             -- free text (e.g. "1.2m x 2.4m")
  drawing_no    VARCHAR(64) DEFAULT '',
  `date`        DATE DEFAULT NULL,
  notes         TEXT,
  drive_file_id VARCHAR(512) DEFAULT '',            -- Drive ID, files not migrating yet
  file_name     VARCHAR(255) DEFAULT '',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  run           VARCHAR(64) DEFAULT '',             -- MailBot run identifier
  group_id      VARCHAR(64) DEFAULT '',             -- groups multi-file records
  files         JSON DEFAULT NULL,                  -- xlsx: Files (JSON) — array of Drive files
  PRIMARY KEY (id),
  INDEX idx_hlib_records_mall_lot (mall, lot),
  INDEX idx_hlib_records_group (group_id),
  INDEX idx_hlib_records_date (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Rates (MASTER — per-mall rate card) ─────────────────────
CREATE TABLE IF NOT EXISTS hlib_rates (
  id      VARCHAR(64) NOT NULL,                     -- xlsx: ID
  mall    VARCHAR(255) DEFAULT '',
  item    VARCHAR(255) DEFAULT '',
  unit    VARCHAR(32) DEFAULT '',
  rate_rm DECIMAL(14,2) DEFAULT 0,                  -- xlsx: Rate (RM)
  PRIMARY KEY (id),
  INDEX idx_hlib_rates_mall (mall)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── MailBotLog (append-only — Gmail→Gemini bot) ─────────────
-- xlsx has no ID column (At | Kind | Message) → surrogate auto-id added.
CREATE TABLE IF NOT EXISTS hlib_mailbot_log (
  id      BIGINT AUTO_INCREMENT,
  at      DATETIME DEFAULT NULL,                    -- xlsx: At
  kind    VARCHAR(64) DEFAULT '',
  message TEXT,
  PRIMARY KEY (id),
  INDEX idx_hlib_mailbot_at (at),
  INDEX idx_hlib_mailbot_kind (kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ════════════════════════════════════════════════════════════
-- 18 · TEAM COMMAND / HG CLOUD  (tc_)
-- DYNAMIC SCHEMA (per handoff §6-18): columns = union of record
-- keys at write time; nested objects live serialized in `_json`.
-- Design: each ENTITY table gets the xlsx columns present today
-- PLUS `_json` JSON holding the full record. The API must
-- JSON-parse `_json` and merge to recover complete records; new
-- record keys land inside `_json` (no ALTERs needed).
-- Empty tabs (no headers exported) get the minimal id + `_json`.
-- settings (key/value) and _SyncLog are not entities → no `_json`.
-- ════════════════════════════════════════════════════════════

-- ─── jobs (3 rows) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tc_jobs (
  id           VARCHAR(64) NOT NULL,
  `no`         VARCHAR(64) DEFAULT '',              -- job number
  service      VARCHAR(64) DEFAULT '',
  invoice_no   VARCHAR(64) DEFAULT '',
  invoice_date DATE DEFAULT NULL,
  status       VARCHAR(64) DEFAULT '',
  client_name  VARCHAR(255) DEFAULT '',
  `value`      DECIMAL(14,2) DEFAULT 0,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by   VARCHAR(255) DEFAULT '',
  updated_at   DATETIME DEFAULT NULL,
  updated_by   VARCHAR(255) DEFAULT '',
  b2b_exempt   TINYINT(1) DEFAULT 0,
  client_type  VARCHAR(64) DEFAULT '',
  `_json`      JSON DEFAULT NULL,                   -- full record incl. nested objects
  PRIMARY KEY (id),
  INDEX idx_tc_jobs_status (status),
  INDEX idx_tc_jobs_invoice_no (invoice_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── scaffoldMaterials (empty tab — no headers exported) ─────
CREATE TABLE IF NOT EXISTS tc_scaffold_materials (
  id         VARCHAR(64) NOT NULL,
  `_json`    JSON DEFAULT NULL,                     -- full record (dynamic schema)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── greenTagLogs (empty tab — no headers exported) ──────────
CREATE TABLE IF NOT EXISTS tc_green_tag_logs (
  id         VARCHAR(64) NOT NULL,
  `_json`    JSON DEFAULT NULL,                     -- full record (dynamic schema)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── rorobinEvents (empty tab — no headers exported) ─────────
-- NOTE handoff transport note: rorobin ops overlap tool 12 (transport);
-- reconcile at import time — schema stays independent here.
CREATE TABLE IF NOT EXISTS tc_rorobin_events (
  id         VARCHAR(64) NOT NULL,
  `_json`    JSON DEFAULT NULL,                     -- full record (dynamic schema)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── storageReminders (empty tab — no headers exported) ──────
CREATE TABLE IF NOT EXISTS tc_storage_reminders (
  id         VARCHAR(64) NOT NULL,
  `_json`    JSON DEFAULT NULL,                     -- full record (dynamic schema)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── hoardingQuotes (empty tab — no headers exported) ────────
CREATE TABLE IF NOT EXISTS tc_hoarding_quotes (
  id         VARCHAR(64) NOT NULL,
  `_json`    JSON DEFAULT NULL,                     -- full record (dynamic schema)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── expenses (3 rows) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS tc_expenses (
  id            VARCHAR(64) NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  amount        DECIMAL(14,2) DEFAULT 0,
  category      VARCHAR(64) DEFAULT '',
  `date`        DATE DEFAULT NULL,
  description   TEXT,
  linked_job_id VARCHAR(64) DEFAULT '',             -- → tc_jobs.id (no FK by convention)
  paid_via      VARCHAR(64) DEFAULT '',
  `_json`       JSON DEFAULT NULL,                  -- full record (dynamic schema)
  PRIMARY KEY (id),
  INDEX idx_tc_expenses_linked_job (linked_job_id),
  INDEX idx_tc_expenses_date (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── clients (5 rows, MASTER) ────────────────────────────────
CREATE TABLE IF NOT EXISTS tc_clients (
  id            VARCHAR(64) NOT NULL,
  b2b_exempt    TINYINT(1) DEFAULT 0,
  contact_email VARCHAR(255) DEFAULT '',
  contact_name  VARCHAR(255) DEFAULT '',
  contact_tel   VARCHAR(64) DEFAULT '',
  name          VARCHAR(255) DEFAULT '',
  notes         TEXT,
  type          VARCHAR(64) DEFAULT '',
  `_json`       JSON DEFAULT NULL,                  -- full record (dynamic schema)
  PRIMARY KEY (id),
  INDEX idx_tc_clients_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── sites (3 rows, MASTER) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS tc_sites (
  id      VARCHAR(64) NOT NULL,
  address TEXT,
  name    VARCHAR(255) DEFAULT '',
  `_json` JSON DEFAULT NULL,                        -- full record (dynamic schema)
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── team (6 rows, MASTER) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS tc_team (
  id       VARCHAR(64) NOT NULL,
  category VARCHAR(64) DEFAULT '',
  name     VARCHAR(255) DEFAULT '',
  role     VARCHAR(64) DEFAULT '',
  tel      VARCHAR(64) DEFAULT '',
  `_json`  JSON DEFAULT NULL,                       -- full record (dynamic schema)
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── lorries (3 rows, MASTER) ────────────────────────────────
CREATE TABLE IF NOT EXISTS tc_lorries (
  id       VARCHAR(64) NOT NULL,
  capacity VARCHAR(64) DEFAULT '',                  -- free text ("1 ton" etc.)
  category VARCHAR(64) DEFAULT '',
  code     VARCHAR(64) DEFAULT '',
  notes    TEXT,
  plate_no VARCHAR(32) DEFAULT '',
  type     VARCHAR(64) DEFAULT '',
  `_json`  JSON DEFAULT NULL,                       -- full record (dynamic schema)
  PRIMARY KEY (id),
  INDEX idx_tc_lorries_plate (plate_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── settings (key/value — not an entity, no _json) ──────────
CREATE TABLE IF NOT EXISTS tc_settings (
  `key`   VARCHAR(128) NOT NULL,
  `value` TEXT,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── _SyncLog (81 rows, append-only — not an entity, no _json)
-- xlsx has no ID column → surrogate auto-id added.
CREATE TABLE IF NOT EXISTS tc_sync_log (
  id            BIGINT AUTO_INCREMENT,
  `timestamp`   DATETIME DEFAULT NULL,
  `user`        VARCHAR(255) DEFAULT '',
  action        VARCHAR(64) DEFAULT '',
  job_count     INT DEFAULT 0,
  total_records INT DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_tc_sync_log_ts (`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ════════════════════════════════════════════════════════════
-- 25 · 4D TRACKER  (fd_)  — personal, nightly scraper
-- xlsx "Sheet1" is an empty default tab → SKIPPED (per handoff §9-6).
-- ════════════════════════════════════════════════════════════

-- ─── Results (3,578 rows — one draw per row) ─────────────────
-- xlsx has no ID column → surrogate auto-id added.
-- Prize numbers are 4-digit strings — leading zeros matter, and
-- scrapes may contain placeholders ("----") → VARCHAR(8), not INT.
-- No UNIQUE on (date, draw_no): production data wins; scraper
-- re-runs must not fail the import. Plain indexes instead.
CREATE TABLE IF NOT EXISTS fd_results (
  id      BIGINT AUTO_INCREMENT,
  `date`  DATE DEFAULT NULL,
  draw_no VARCHAR(32) DEFAULT '',                   -- e.g. "123/26" — keep as text
  p1      VARCHAR(8) DEFAULT '',                    -- 1st prize
  p2      VARCHAR(8) DEFAULT '',                    -- 2nd prize
  p3      VARCHAR(8) DEFAULT '',                    -- 3rd prize
  s1      VARCHAR(8) DEFAULT '',                    -- special 1..10
  s2      VARCHAR(8) DEFAULT '',
  s3      VARCHAR(8) DEFAULT '',
  s4      VARCHAR(8) DEFAULT '',
  s5      VARCHAR(8) DEFAULT '',
  s6      VARCHAR(8) DEFAULT '',
  s7      VARCHAR(8) DEFAULT '',
  s8      VARCHAR(8) DEFAULT '',
  s9      VARCHAR(8) DEFAULT '',
  s10     VARCHAR(8) DEFAULT '',
  c1      VARCHAR(8) DEFAULT '',                    -- consolation 1..10
  c2      VARCHAR(8) DEFAULT '',
  c3      VARCHAR(8) DEFAULT '',
  c4      VARCHAR(8) DEFAULT '',
  c5      VARCHAR(8) DEFAULT '',
  c6      VARCHAR(8) DEFAULT '',
  c7      VARCHAR(8) DEFAULT '',
  c8      VARCHAR(8) DEFAULT '',
  c9      VARCHAR(8) DEFAULT '',
  c10     VARCHAR(8) DEFAULT '',
  PRIMARY KEY (id),
  INDEX idx_fd_results_date (`date`),
  INDEX idx_fd_results_draw_no (draw_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Phase 2 checklists ──────────────────────────────────────
-- RPC-PORT: (none — these three tools have no Supabase schema; all logic
--            lives in Apps Script Code.gs and is ported directly to Express.)
-- NOTE Phase 2 (team-command API): write path must merge typed columns +
--            `_json` on read, and route unknown record keys into `_json`
--            on write (replaces the Apps Script header-union behavior).
-- NOTE Phase 2 (hoarding-library): MailBot (Gmail→Gemini) writes
--            hlib_records + hlib_mailbot_log — needs a new ingest endpoint.
-- BUCKET: (none — Drive file IDs/URLs kept as-is, files not migrating yet)
