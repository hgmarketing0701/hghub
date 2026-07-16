-- ============================================================
-- HG hub — visual works control (MySQL 8) — translated from supabase/schema-visual.sql
-- Reconciled against 20-visual-works.xlsx (2026-07-16)
-- Requires the foundation module (app_settings — used by the vis_alarms view;
-- AuditLog xlsx rows import into the foundation audit table, not this module).
-- ============================================================
SET NAMES utf8mb4;

-- ─── MASTERS ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vis_malls (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  name       VARCHAR(255) NOT NULL,
  notes      TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vis_malls_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vis_materials (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  name       VARCHAR(255) NOT NULL,
  notes      TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vis_materials_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed materials (same as GAS setupConfig → seedMaterials_); idempotent via UNIQUE(name)
INSERT IGNORE INTO vis_materials (name) VALUES
  ('Tarpaulin'), ('Sticker'), ('Fabric'), ('Vinyl'), ('Forex Board');

-- ─── RATE CARD — B's rates per mall / material / job type ───

CREATE TABLE IF NOT EXISTS vis_rates (
  id             CHAR(36) NOT NULL DEFAULT (uuid()),
  mall           VARCHAR(255) DEFAULT 'ALL',
  material       VARCHAR(255) DEFAULT 'ALL',
  job_type       VARCHAR(64) DEFAULT 'ALL',        -- print_install / print_only / install_only / ALL
  rate_per_sqft  DECIMAL(14,4) DEFAULT 0,          -- print rate
  install_rate   DECIMAL(14,4) DEFAULT 0,
  package_rate   DECIMAL(14,4) DEFAULT 0,          -- all-in supply+install (overrides split)
  min_charge     DECIMAL(14,2) DEFAULT 0,
  effective_from DATE,
  notes          TEXT,
  updated_by     VARCHAR(255) DEFAULT '',
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── PERMITS ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vis_permits (
  id          CHAR(36) NOT NULL DEFAULT (uuid()),
  mall        VARCHAR(255) NOT NULL,
  lot_no      VARCHAR(255) DEFAULT '',
  permit_type VARCHAR(64) DEFAULT '',              -- monthly / yearly / one-off
  permit_no   VARCHAR(255) DEFAULT '',
  valid_from  DATE,
  valid_to    DATE,
  file_url    VARCHAR(512) DEFAULT '',             -- pasted link (if any)
  file_path   VARCHAR(512) DEFAULT '',             -- storage path in bucket 'visual'
  file_id     VARCHAR(255) DEFAULT '',             -- XLSX-ADDED (Google Drive file ID)
  notes       TEXT,
  created_by  VARCHAR(255) DEFAULT '',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── JOBS + PANELS ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vis_jobs (
  id                 CHAR(36) NOT NULL DEFAULT (uuid()),
  job_no             VARCHAR(64) NOT NULL,         -- VIS-YYYY-####
  status             VARCHAR(64) NOT NULL DEFAULT 'NEW',
  mall               VARCHAR(255) NOT NULL,
  lot_no             VARCHAR(255) NOT NULL,
  job_type           VARCHAR(64) NOT NULL DEFAULT 'print_install',
  client             VARCHAR(255) DEFAULT '',
  requested_by       VARCHAR(255) DEFAULT '',
  request_date       DATE,
  install_date       DATE,
  completed_date     DATE,
  artwork_link       VARCHAR(512) DEFAULT '',      -- WeTransfer / Drive link (URL kept as-is)
  artwork_proof_url  VARCHAR(512) DEFAULT '',      -- pasted proof link
  artwork_proof_path VARCHAR(512) DEFAULT '',      -- uploaded proof (storage path)
  sketch_url         VARCHAR(512) DEFAULT '',      -- pasted sketch link
  sketch_path        VARCHAR(512) DEFAULT '',      -- uploaded sketch (storage path)
  site_photo_paths   JSON DEFAULT (JSON_ARRAY()),  -- site reference photos (storage paths)
  photo_paths        JSON DEFAULT (JSON_ARRAY()),  -- completion photos (storage paths)
  site_photos_url    VARCHAR(512) DEFAULT '',      -- XLSX-ADDED (Drive folder/link from GAS era)
  photos_url         VARCHAR(512) DEFAULT '',      -- XLSX-ADDED (Drive folder/link from GAS era)
  folder_url         VARCHAR(512) DEFAULT '',      -- XLSX-ADDED (job Drive folder URL)
  material           VARCHAR(255) DEFAULT '',
  total_sqft         DECIMAL(12,2) DEFAULT 0,
  rate_id            CHAR(36),
  rate_per_sqft      DECIMAL(14,4) DEFAULT 0,
  install_rate       DECIMAL(14,4) DEFAULT 0,
  subtotal           DECIMAL(14,2) DEFAULT 0,
  expected_amount    DECIMAL(14,2) DEFAULT 0,
  permit_id          CHAR(36),                     -- was FK → vis_permits(id)
  proceed_by         VARCHAR(255) DEFAULT '',
  proceed_at         DATETIME,
  notes              TEXT,
  created_by         VARCHAR(255) DEFAULT '',
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vis_jobs_job_no (job_no),
  INDEX idx_vis_jobs_status (status),
  INDEX idx_vis_jobs_mall (mall),
  INDEX idx_vis_jobs_rate (rate_id),
  INDEX idx_vis_jobs_permit (permit_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vis_job_panels (
  id            CHAR(36) NOT NULL DEFAULT (uuid()),
  job_id        CHAR(36) NOT NULL,                 -- was FK → vis_jobs(id)
  label         VARCHAR(255) DEFAULT '',
  width_val     DECIMAL(12,2) DEFAULT 0,
  height_val    DECIMAL(12,2) DEFAULT 0,
  unit          VARCHAR(8) DEFAULT 'mm',           -- mm / cm / m / in / ft
  qty           DECIMAL(12,2) DEFAULT 1,
  sqft          DECIMAL(12,2) DEFAULT 0,
  material      VARCHAR(255) DEFAULT '',
  rate_per_sqft DECIMAL(14,4) DEFAULT 0,
  amount        DECIMAL(14,2) DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_vis_panels_job (job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── B's WORKERS (IC / CIDB / WAH / other doc slots) ────────

CREATE TABLE IF NOT EXISTS vis_workers (
  id             CHAR(36) NOT NULL DEFAULT (uuid()),
  name           VARCHAR(255) NOT NULL,
  role           VARCHAR(255) DEFAULT '',
  phone          VARCHAR(64) DEFAULT '',
  ic_no          VARCHAR(64) DEFAULT '',
  ic_file_url    VARCHAR(512) DEFAULT '',
  ic_file_path   VARCHAR(512) DEFAULT '',
  ic_file_id     VARCHAR(255) DEFAULT '',          -- XLSX-ADDED (Google Drive file ID)
  cidb_no        VARCHAR(64) DEFAULT '',
  cidb_expiry    DATE,
  cidb_file_url  VARCHAR(512) DEFAULT '',
  cidb_file_path VARCHAR(512) DEFAULT '',
  cidb_file_id   VARCHAR(255) DEFAULT '',          -- XLSX-ADDED (Google Drive file ID)
  wah_no         VARCHAR(64) DEFAULT '',
  wah_expiry     DATE,
  wah_file_url   VARCHAR(512) DEFAULT '',
  wah_file_path  VARCHAR(512) DEFAULT '',
  wah_file_id    VARCHAR(255) DEFAULT '',          -- XLSX-ADDED (Google Drive file ID)
  doc_type       VARCHAR(255) DEFAULT '',
  doc_no         VARCHAR(255) DEFAULT '',
  doc_expiry     DATE,
  doc_url        VARCHAR(512) DEFAULT '',
  doc_file_path  VARCHAR(512) DEFAULT '',
  doc_file_id    VARCHAR(255) DEFAULT '',          -- XLSX-ADDED (Google Drive file ID)
  status         VARCHAR(32) DEFAULT 'active',     -- active / inactive
  notes          TEXT,
  updated_by     VARCHAR(255) DEFAULT '',
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── B's INVOICES + RECONCILIATION ──────────────────────────

CREATE TABLE IF NOT EXISTS vis_invoices (
  id             CHAR(36) NOT NULL DEFAULT (uuid()),
  inv_no         VARCHAR(64) NOT NULL,
  inv_date       DATE,
  period         VARCHAR(255) DEFAULT '',
  malls          VARCHAR(255) DEFAULT '',
  claimed_amount DECIMAL(14,2) DEFAULT 0,
  sst_enabled    TINYINT(1) DEFAULT 0,
  sst_amount     DECIMAL(14,2) DEFAULT 0,
  claimed_total  DECIMAL(14,2) DEFAULT 0,
  file_url       VARCHAR(512) DEFAULT '',
  file_path      VARCHAR(512) DEFAULT '',
  file_id        VARCHAR(255) DEFAULT '',          -- XLSX-ADDED (Google Drive file ID)
  status         VARCHAR(32) DEFAULT 'checking',   -- checking / verified / disputed / paid
  recon_verdict  VARCHAR(16) DEFAULT '',           -- MATCH / CHECK
  recon_note     TEXT,
  notes          TEXT,
  created_by     VARCHAR(255) DEFAULT '',
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_vis_invoices_inv_no (inv_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- job_id intentionally NOT a foreign key: like the GAS original, deleting a job
-- keeps the invoice line (shown as "(deleted)").
CREATE TABLE IF NOT EXISTS vis_invoice_jobs (
  id              CHAR(36) NOT NULL DEFAULT (uuid()),
  invoice_id      CHAR(36) NOT NULL,               -- was FK → vis_invoices(id)
  job_id          CHAR(36) NOT NULL,
  claimed_sqft    DECIMAL(12,2) DEFAULT 0,
  claimed_amount  DECIMAL(14,2) DEFAULT 0,
  recorded_sqft   DECIMAL(12,2) DEFAULT 0,
  recorded_amount DECIMAL(14,2) DEFAULT 0,
  variance_rm     DECIMAL(14,2) DEFAULT 0,
  flag            VARCHAR(16) DEFAULT '',          -- OK / OVER / UNDER
  PRIMARY KEY (id),
  INDEX idx_vis_invjobs_inv (invoice_id),
  INDEX idx_vis_invjobs_job (job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── ALARMS VIEW — permit + worker-doc expiry (daily alarms) ─
-- Permits expiring within 14 days (or expired); worker docs within 30 days.
-- DATETIME/DATE stored Asia/Kuala_Lumpur local, so CURDATE() = KL "today"
-- provided the MySQL server/session time zone is set accordingly.

CREATE OR REPLACE VIEW vis_alarms AS
SELECT 'permit_expiry' AS alarm_type,
       COALESCE(NULLIF(p.permit_no,''), NULLIF(p.permit_type,''), 'permit') AS ref,
       CONCAT('Permit · ', p.mall,
              CASE WHEN COALESCE(p.lot_no,'') <> '' THEN CONCAT(' · Lot ', p.lot_no) ELSE '' END,
              CASE WHEN COALESCE(p.permit_type,'') <> '' THEN CONCAT(' · ', p.permit_type) ELSE '' END) AS detail,
       p.valid_to AS due_date,
       COALESCE((SELECT s.value FROM app_settings s WHERE s.`key` = 'COMPANY_EMAIL' LIMIT 1), '') AS recipient
FROM vis_permits p
WHERE p.valid_to IS NOT NULL
  AND p.valid_to <= DATE_ADD(CURDATE(), INTERVAL 14 DAY)
UNION ALL
SELECT 'worker_doc_expiry', w.name,
       CONCAT('Worker doc · ', w.name, ' · CIDB Green Card'), w.cidb_expiry,
       COALESCE((SELECT s.value FROM app_settings s WHERE s.`key` = 'COMPANY_EMAIL' LIMIT 1), '')
FROM vis_workers w
WHERE LOWER(COALESCE(w.status,'')) <> 'inactive' AND w.cidb_expiry IS NOT NULL
  AND w.cidb_expiry <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
UNION ALL
SELECT 'worker_doc_expiry', w.name,
       CONCAT('Worker doc · ', w.name, ' · Work at Height (WAH)'), w.wah_expiry,
       COALESCE((SELECT s.value FROM app_settings s WHERE s.`key` = 'COMPANY_EMAIL' LIMIT 1), '')
FROM vis_workers w
WHERE LOWER(COALESCE(w.status,'')) <> 'inactive' AND w.wah_expiry IS NOT NULL
  AND w.wah_expiry <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
UNION ALL
SELECT 'worker_doc_expiry', w.name,
       CONCAT('Worker doc · ', w.name, ' · ', COALESCE(NULLIF(w.doc_type,''),'Document')), w.doc_expiry,
       COALESCE((SELECT s.value FROM app_settings s WHERE s.`key` = 'COMPANY_EMAIL' LIMIT 1), '')
FROM vis_workers w
WHERE LOWER(COALESCE(w.status,'')) <> 'inactive' AND w.doc_expiry IS NOT NULL
  AND w.doc_expiry <= DATE_ADD(CURDATE(), INTERVAL 30 DAY);

-- ─── PHASE 2 CHECKLIST ──────────────────────────────────────
-- RPC-PORT: vis_pick_rate(p_mall text, p_material text, p_job_type text, p_date date) — most-specific rate-card match (mall+material+jobType > mall+material > mall+jobType > mall > material(+type) > jobType > ALL); only rates effective on/before the job date; tie-break most recent effective_from; NULL when no match.
-- RPC-PORT: vis_save_job(payload jsonb) — create/update a job: server recomputes every panel sqft + amount (unit conversion mm/cm/m/in/ft, package vs split rate, min charge), assigns atomic sequential job_no VIS-YYYY-#### (lock-guarded), replaces vis_job_panels, remembers new malls into vis_malls, audit-logs vis.job.create/update.
-- RPC-PORT: vis_save_invoice(payload jsonb) — save B's invoice header + vis_invoice_jobs lines, run reconciliation per job vs recorded totals (tolerance RM 5 or 1% → OK/OVER/UNDER, verdict MATCH/CHECK), computes SST 6% when enabled, audit-logs vis.invoice.create/update.

-- BUCKET: visual
