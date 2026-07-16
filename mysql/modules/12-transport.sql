-- ============================================================
-- HG hub — transport / mover / rorobin (MySQL 8) — translated from supabase/schema-transport.sql
-- Reconciled against 12-transport.xlsx (2026-07-16)
-- Prefix trn_. Audit log lives in the foundation module (audit_log), not here.
-- ============================================================
SET NAMES utf8mb4;

-- ─── trn_clients (xlsx tab: Clients) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trn_clients (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  company    VARCHAR(255) NOT NULL,
  reg_no     VARCHAR(255) DEFAULT '',
  pic        VARCHAR(255) DEFAULT '',
  contact    VARCHAR(255) DEFAULT '',
  email      VARCHAR(255) DEFAULT '',
  address    VARCHAR(255) DEFAULT '',
  notes      TEXT,
  created_by VARCHAR(255) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── trn_engagements (xlsx tab: Engagements) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS trn_engagements (
  id             CHAR(36) NOT NULL DEFAULT (uuid()),
  ref            VARCHAR(64) NOT NULL,                -- ENG-0001 (system-generated)
  client_id      CHAR(36),
  client_company VARCHAR(255) DEFAULT '',
  reason         VARCHAR(64) DEFAULT 'Ad-hoc',        -- Reinstatement / Ad-hoc / Mover / Rorobin / Transport / Other
  site_name      VARCHAR(255) DEFAULT '',
  site_address   VARCHAR(255) DEFAULT '',
  status         VARCHAR(32) DEFAULT 'Open',          -- Open / Cancelled (live status is computed)
  handled_by     VARCHAR(255) DEFAULT '',
  remarks        TEXT,
  created_by     VARCHAR(255) DEFAULT '',
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by     VARCHAR(255) DEFAULT '',
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_trn_engagements_ref (ref),
  INDEX idx_trn_engagements_client (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── trn_bins (xlsx tab: Bins) ───────────────────────────────────────────────
-- PG had UNIQUE lower(bin_no); user-entered master → plain index (production wins).
CREATE TABLE IF NOT EXISTS trn_bins (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  bin_no     VARCHAR(64) NOT NULL,
  swcorp_reg VARCHAR(255) DEFAULT '',
  size       VARCHAR(64) DEFAULT '',
  status     VARCHAR(32) DEFAULT 'Available',         -- Available / Maintenance
  notes      TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_trn_bins_no (bin_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── trn_rates (xlsx tab: Rates) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trn_rates (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  service    VARCHAR(32) NOT NULL,                    -- Lorry / Mover / Rorobin
  code       VARCHAR(64) NOT NULL,
  label      VARCHAR(255) NOT NULL,
  unit       VARCHAR(64) DEFAULT 'per unit',
  rate       DECIMAL(14,2) DEFAULT 0,
  active     TINYINT(1) DEFAULT 1,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_trn_rates_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── trn_workers (xlsx tab: Workers) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trn_workers (
  id             CHAR(36) NOT NULL DEFAULT (uuid()),
  name           VARCHAR(255) NOT NULL,
  phone          VARCHAR(64) DEFAULT '',
  role           VARCHAR(32) DEFAULT 'Mover',         -- Mover / Driver / Both
  pay_type       VARCHAR(32) DEFAULT 'Per-shift',     -- Per-shift / Monthly
  day_rate       DECIMAL(14,2) DEFAULT 0,
  night_rate     DECIMAL(14,2) DEFAULT 0,
  monthly_salary DECIMAL(14,2) DEFAULT 0,
  active         TINYINT(1) DEFAULT 1,
  notes          TEXT,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_trn_workers_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── trn_lorries (xlsx tab: Lorries) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trn_lorries (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  plate_no   VARCHAR(64) NOT NULL,
  code       VARCHAR(64) DEFAULT '',
  type       VARCHAR(255) DEFAULT '',
  capacity   VARCHAR(64) DEFAULT '',
  category   VARCHAR(32) DEFAULT 'in-house',          -- in-house / outsource
  active     TINYINT(1) DEFAULT 1,
  notes      TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_trn_lorries_plate (plate_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── trn_trips (xlsx tab: Trips; crewJson → crew JSON) ───────────────────────
CREATE TABLE IF NOT EXISTS trn_trips (
  id          CHAR(36) NOT NULL DEFAULT (uuid()),
  ref         VARCHAR(64) NOT NULL,                   -- RUN-0001 (system-generated)
  trip_date   VARCHAR(32) DEFAULT '',                 -- YYYY-MM-DD
  shift       VARCHAR(16) DEFAULT 'Day',              -- Day / Night
  lorry_plate VARCHAR(64) DEFAULT '',
  driver      VARCHAR(255) DEFAULT '',
  driver_id   CHAR(36),
  driver_cost DECIMAL(14,2) DEFAULT 0,
  lorry_cost  DECIMAL(14,2) DEFAULT 0,
  crew        JSON,                                   -- [{workerId,name,shift,rate,payType}] (xlsx crewJson)
  status      VARCHAR(32) DEFAULT 'Planned',          -- Planned / Dispatched / Completed / Cancelled
  notes       TEXT,
  created_by  VARCHAR(255) DEFAULT '',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by  VARCHAR(255) DEFAULT '',
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_trn_trips_ref (ref),
  INDEX idx_trn_trips_driver (driver_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── trn_invoices (xlsx tab: Invoices) ───────────────────────────────────────
-- PG had UNIQUE lower(inv_no); user-keyed → plain index (uniqueness enforced by API).
CREATE TABLE IF NOT EXISTS trn_invoices (
  id             CHAR(36) NOT NULL DEFAULT (uuid()),
  inv_no         VARCHAR(64) NOT NULL,
  engagement_id  CHAR(36),
  engagement_ref VARCHAR(64) DEFAULT '',
  client_id      CHAR(36),
  client_company VARCHAR(255) DEFAULT '',
  inv_date       VARCHAR(32) DEFAULT '',              -- YYYY-MM-DD
  due_date       VARCHAR(32) DEFAULT '',
  description    TEXT,
  amount         DECIMAL(14,2) DEFAULT 0,
  sst_enabled    TINYINT(1) DEFAULT 0,
  sst_amount     DECIMAL(14,2) DEFAULT 0,
  total          DECIMAL(14,2) DEFAULT 0,
  status         VARCHAR(32) DEFAULT '',              -- '' / Void  (pay status is computed)
  file_path      VARCHAR(512) DEFAULT '',             -- storage path in transport-photos
  file_url       VARCHAR(512) DEFAULT '',             -- XLSX-ADDED (Google Drive URL, files not migrating yet)
  file_id        VARCHAR(255) DEFAULT '',             -- XLSX-ADDED (Google Drive file ID)
  notes          TEXT,
  created_by     VARCHAR(255) DEFAULT '',
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_trn_invoices_no (inv_no),
  INDEX idx_trn_invoices_eng (engagement_id),
  INDEX idx_trn_invoices_client (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── trn_jobs (xlsx tab: Jobs; stopsJson → stops JSON) ───────────────────────
CREATE TABLE IF NOT EXISTS trn_jobs (
  id                   CHAR(36) NOT NULL DEFAULT (uuid()),
  engagement_id        CHAR(36) NOT NULL,
  engagement_ref       VARCHAR(64) DEFAULT '',
  client_id            CHAR(36),
  client_company       VARCHAR(255) DEFAULT '',
  service              VARCHAR(32) NOT NULL,          -- Lorry / Mover / Rorobin
  status               VARCHAR(32) DEFAULT 'Scheduled',
  start_datetime       VARCHAR(32) DEFAULT '',        -- YYYY-MM-DD HH:MM
  end_datetime         VARCHAR(32) DEFAULT '',
  from_location        VARCHAR(255) DEFAULT '',
  to_location          VARCHAR(255) DEFAULT '',
  lorry_type           VARCHAR(255) DEFAULT '',
  lorry_plate          VARCHAR(64) DEFAULT '',
  driver               VARCHAR(255) DEFAULT '',
  trips                DECIMAL(12,2) DEFAULT 0,
  collection_mover_by  VARCHAR(255) DEFAULT '',
  delivery_mover_by    VARCHAR(255) DEFAULT '',
  movers               DECIMAL(12,2) DEFAULT 0,
  shifts               DECIMAL(12,2) DEFAULT 0,
  items_description    TEXT,
  bin_id               CHAR(36),
  bin_no               VARCHAR(64) DEFAULT '',
  placement_type       VARCHAR(64) DEFAULT '',        -- Mall / Office Tower / Shop Lot / Roadside
  place_datetime       VARCHAR(32) DEFAULT '',
  collect_datetime     VARCHAR(32) DEFAULT '',
  permit_no            VARCHAR(64) DEFAULT '',
  swcorp_ref           VARCHAR(64) DEFAULT '',
  max_days             DECIMAL(12,2) DEFAULT 0,
  rate_code            VARCHAR(64) DEFAULT '',
  rate_label           VARCHAR(255) DEFAULT '',
  unit_rate            DECIMAL(14,2) DEFAULT 0,
  quantity             DECIMAL(12,2) DEFAULT 0,
  amount               DECIMAL(14,2) DEFAULT 0,
  invoice_id           CHAR(36),
  handled_by           VARCHAR(255) DEFAULT '',
  remarks              TEXT,
  trip_id              CHAR(36),
  stop_seq             INT,
  internal_use         TINYINT(1) DEFAULT 0,
  landfill             VARCHAR(255) DEFAULT '',
  weight_tons          DECIMAL(12,2) DEFAULT 0,
  tip_fee              DECIMAL(14,2) DEFAULT 0,
  tipping_date         VARCHAR(32) DEFAULT '',
  tipping_receipt_path VARCHAR(512) DEFAULT '',       -- storage path
  tipping_receipt_url  VARCHAR(512) DEFAULT '',       -- XLSX-ADDED (Google Drive URL, files not migrating yet)
  stops                JSON,                          -- multi-stop legs (xlsx stopsJson)
  created_by           VARCHAR(255) DEFAULT '',
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by           VARCHAR(255) DEFAULT '',
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_trn_jobs_eng    (engagement_id),
  INDEX idx_trn_jobs_client (client_id),
  INDEX idx_trn_jobs_bin    (bin_id),
  INDEX idx_trn_jobs_trip   (trip_id),
  INDEX idx_trn_jobs_inv    (invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── trn_payments (xlsx tab: Payments) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS trn_payments (
  id          CHAR(36) NOT NULL DEFAULT (uuid()),
  invoice_id  CHAR(36) NOT NULL,
  pay_date    VARCHAR(32) DEFAULT '',
  amount      DECIMAL(14,2) DEFAULT 0,
  method      VARCHAR(64) DEFAULT '',
  reference   VARCHAR(255) DEFAULT '',
  received_by VARCHAR(255) DEFAULT '',
  notes       TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_trn_payments_inv (invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── trn_photos (xlsx tab: Photos) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trn_photos (
  id            CHAR(36) NOT NULL DEFAULT (uuid()),
  job_id        CHAR(36) NOT NULL,
  engagement_id CHAR(36),
  service       VARCHAR(32) DEFAULT '',
  stage         VARCHAR(64) DEFAULT '',
  storage_path  VARCHAR(512) DEFAULT '',              -- path inside bucket transport-photos
  url           VARCHAR(512) DEFAULT '',              -- XLSX-ADDED (Google Drive URL, files not migrating yet)
  file_id       VARCHAR(255) DEFAULT '',              -- XLSX-ADDED (Google Drive file ID)
  caption       VARCHAR(255) DEFAULT '',
  taken_by      VARCHAR(255) DEFAULT '',
  taken_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_trn_photos_job (job_id),
  INDEX idx_trn_photos_eng (engagement_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── trn_settings (xlsx tab: Config) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trn_settings (
  `key` VARCHAR(191) NOT NULL,
  value VARCHAR(255) DEFAULT '',
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SEED: Supabase seed inserts (trn_settings defaults, sample rates/bins/lorries)
-- intentionally NOT translated — production rows come from the 12-transport.xlsx
-- import (Config=11, Rates=9, Bins=4, Lorries=3 rows). Seeding here would duplicate.

-- ─── trn_alarms view (rorobin overstays + overdue invoices) ──────────────────
-- Assumes MySQL server time = Asia/Kuala_Lumpur local (per conventions, DATETIMEs
-- are stored KL-local). Requires MySQL >= 8.0.14 (derived table inside a view).
CREATE OR REPLACE VIEW trn_alarms AS
SELECT 'BIN_OVERSTAY' AS alarm_type,
       CONCAT(COALESCE(j.engagement_ref, ''), '/Bin ', COALESCE(j.bin_no, '?')) AS ref,
       CONCAT('OVERSTAY — Bin ', COALESCE(j.bin_no, '?'), ' · ', COALESCE(j.client_company, ''),
              ', placed ', j.place_datetime,
              ', collect by ', DATE_FORMAT(j.deadline, '%Y-%m-%d %H:%i')) AS detail,
       DATE(j.deadline) AS due_date,
       COALESCE((SELECT NULLIF(value, '') FROM trn_settings WHERE `key` = 'REMINDER_TO'), '') AS recipient
FROM (
  SELECT b.engagement_ref, b.bin_no, b.client_company, b.place_datetime,
         CASE WHEN b.placement_type IN ('Mall', 'Office Tower')
              THEN DATE_ADD(DATE(STR_TO_DATE(b.place_datetime, '%Y-%m-%d %H:%i')), INTERVAL 30 HOUR)  -- next day 06:00
              ELSE DATE_ADD(STR_TO_DATE(b.place_datetime, '%Y-%m-%d %H:%i'),
                            INTERVAL GREATEST(1, COALESCE(NULLIF(b.max_days, 0),
                              (SELECT CAST(NULLIF(value, '') AS DECIMAL(10,0))
                                 FROM trn_settings WHERE `key` = 'ROROBIN_MAX_DAYS'), 3)) DAY)
         END AS deadline
  FROM trn_jobs b
  WHERE b.service = 'Rorobin'
    AND COALESCE(b.place_datetime, '') <> ''
    AND COALESCE(b.collect_datetime, '') = ''
    AND b.status NOT IN ('Completed', 'Cancelled')
) j
WHERE NOW() > j.deadline
UNION ALL
SELECT 'INVOICE_OVERDUE' AS alarm_type,
       i.inv_no AS ref,
       CONCAT('OVERDUE invoice ', i.inv_no, ' · ', COALESCE(i.client_company, ''),
              ' — balance RM ', ROUND(i.total - COALESCE(p.paid, 0), 2)) AS detail,
       STR_TO_DATE(i.due_date, '%Y-%m-%d') AS due_date,
       COALESCE((SELECT NULLIF(value, '') FROM trn_settings WHERE `key` = 'REMINDER_TO'), '') AS recipient
FROM trn_invoices i
LEFT JOIN (SELECT invoice_id, SUM(amount) AS paid FROM trn_payments GROUP BY invoice_id) p
       ON p.invoice_id = i.id
WHERE COALESCE(i.status, '') <> 'Void'
  AND COALESCE(i.due_date, '') <> ''
  AND STR_TO_DATE(i.due_date, '%Y-%m-%d') < CURDATE()
  AND (i.total - COALESCE(p.paid, 0)) > 0.005;

-- ─── Phase 2 checklist ───────────────────────────────────────────────────────
-- RPC-PORT: trn_save_engagement(payload jsonb) — upsert engagement with atomic sequential ENG-#### ref (ENG_PREFIX setting); syncs denormalised client fields into trn_jobs on update; audit-logs.
-- RPC-PORT: trn_save_job(payload jsonb) — upsert service job; server-side recompute of qty per service (trips / movers×shifts / quantity) and amount (rate×qty, manual, or 0 if internal); rorobin bin clash check; derives summary from/to/start/end from stops[] for Lorry; blocks edits on invoiced jobs; audit-logs.
-- RPC-PORT: trn_save_trip(payload jsonb) — upsert dispatch run with atomic sequential RUN-#### ref (TRIP_PREFIX setting); defaults trip_date to KL today; audit-logs.
-- RPC-PORT: trn_assign_jobs_to_trip(p_trip_id uuid, p_job_ids uuid[]) — appends jobs as stops after current max stop_seq; rejects jobs already on another run; audit-logs.
-- RPC-PORT: trn_add_run_stop(payload jsonb) — run-first billable stop: finds/auto-creates the client's 'Transport' engagement (sequential ENG ref), inserts a Lorry and/or Mover job stamped with trip_id + next stop_seq; audit-logs.
-- RPC-PORT: trn_save_invoice(payload jsonb) — sums selected jobs, optional 6% SST, invoice-number uniqueness check, cross-engagement/job-already-invoiced guards, re-stamps trn_jobs.invoice_id; audit-logs.

-- BUCKET: transport-photos
