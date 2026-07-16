-- ============================================================
-- HG hub — workers (MySQL 8) — translated from supabase/schema-workers.sql
-- Reconciled against 07-workers.xlsx (2026-07-16)
-- ============================================================
-- xlsx tab mapping:
--   Divisions→wkr_divisions · Workers→wkr_workers · Documents→wkr_documents
--   WorkPermits→wkr_work_permits · WorkPermitWorkers→wkr_permit_workers
--   WorkPermitAttachments→wkr_permit_attachments · PermitForms→wkr_permit_forms
--   InsurancePolicies→wkr_insurance_policies
--   InsurancePolicyAttachments→wkr_insurance_attachments
--   InsurancePolicyQuotes→wkr_insurance_quotes
--   InsurancePolicyPayments→wkr_insurance_payments
--   ReportHistory→wkr_report_history
--   SwmsServices/SwmsSteps/SwmsEquipment/SwmsPPE → wkr_swms_* (XLSX-ADDED tables,
--     no Supabase equivalent; HIRARC templates with production rows 23/171/150/85)
--   Config → app_settings seed rows below (foundation table)
--   AuditLog → foundation audit log (log_audit RPC-PORT in foundation module) — skip here
-- xlsx driveUrl / photoDriveUrl / insuranceDriveUrl == file_url / photo_url /
-- insurance_file_url (same field, Supabase rename) — no columns added for them.
SET NAMES utf8mb4;

-- ─── 1 · DIVISIONS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wkr_divisions (
  id          CHAR(36) NOT NULL DEFAULT (uuid()),
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  active      TINYINT(1) DEFAULT 1,
  created_by  VARCHAR(255) DEFAULT '',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 2 · WORKERS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wkr_workers (
  id              CHAR(36) NOT NULL DEFAULT (uuid()),
  full_name       VARCHAR(255) NOT NULL,
  ic_number       VARCHAR(255) DEFAULT '',
  passport_number VARCHAR(255) DEFAULT '',
  nationality     VARCHAR(255) DEFAULT '',
  division_id     CHAR(36) DEFAULT NULL,
  `position`      VARCHAR(255) DEFAULT '',
  phone           VARCHAR(255) DEFAULT '',
  photo_url       VARCHAR(512) DEFAULT '',      -- worker-docs path or Drive/external URL
  status          VARCHAR(255) DEFAULT 'active',  -- active / inactive / resigned
  created_by      VARCHAR(255) DEFAULT '',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by      VARCHAR(255) DEFAULT '',
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_wkr_workers_division (division_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 3 · DOCUMENTS (per worker; doc_type is the locked 12-key enum in the UI) ─
CREATE TABLE IF NOT EXISTS wkr_documents (
  id                CHAR(36) NOT NULL DEFAULT (uuid()),
  worker_id         CHAR(36) NOT NULL,
  doc_type          VARCHAR(255) NOT NULL,      -- PASSPORT / IC / WORKING_VISA / … / DRIVING_HEAVY
  doc_subtype       VARCHAR(255) DEFAULT '',    -- e.g. mall name, competency type, vehicle type
  doc_number        VARCHAR(255) DEFAULT '',
  issue_date        DATE DEFAULT NULL,
  expiry_date       DATE DEFAULT NULL,
  issuing_authority VARCHAR(255) DEFAULT '',
  file_url          VARCHAR(512) DEFAULT '',
  notes             TEXT,
  created_by        VARCHAR(255) DEFAULT '',
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by        VARCHAR(255) DEFAULT '',
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_wkr_documents_worker (worker_id),
  INDEX idx_wkr_documents_expiry (expiry_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 4 · INSURANCE POLICIES (HG's own cover-note library) ───
CREATE TABLE IF NOT EXISTS wkr_insurance_policies (
  id                CHAR(36) NOT NULL DEFAULT (uuid()),
  policy_number     VARCHAR(255) NOT NULL,
  provider          VARCHAR(255) NOT NULL,
  coverage_type     VARCHAR(255) DEFAULT '',
  coverage_amount   VARCHAR(255) DEFAULT '',
  valid_from        DATE DEFAULT NULL,
  valid_until       DATE DEFAULT NULL,
  file_url          VARCHAR(512) DEFAULT '',
  notes             TEXT,
  status            VARCHAR(255) DEFAULT 'active',   -- active / expired / cancelled
  invoice_number    VARCHAR(255) DEFAULT '',          -- invoice we sent to client
  premium_amount    DECIMAL(14,2) DEFAULT 0,          -- cost we pay the insurer (RM)
  charged_to_client DECIMAL(14,2) DEFAULT 0,          -- what we bill the client (RM)
  created_by        VARCHAR(255) DEFAULT '',
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by        VARCHAR(255) DEFAULT '',
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wkr_insurance_attachments (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  policy_id  CHAR(36) NOT NULL,
  label      VARCHAR(255) DEFAULT '',
  file_url   VARCHAR(512) DEFAULT '',
  sort_order INT DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_wkr_ins_att_policy (policy_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wkr_insurance_quotes (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  policy_id  CHAR(36) NOT NULL,
  provider   VARCHAR(255) DEFAULT '',
  amount     DECIMAL(14,2) DEFAULT 0,
  notes      TEXT,
  sort_order INT DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_wkr_ins_q_policy (policy_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wkr_insurance_payments (
  id           CHAR(36) NOT NULL DEFAULT (uuid()),
  policy_id    CHAR(36) NOT NULL,
  payment_date DATE DEFAULT NULL,
  amount       DECIMAL(14,2) DEFAULT 0,
  reference    VARCHAR(255) DEFAULT '',
  notes        TEXT,
  sort_order   INT DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_wkr_ins_p_policy (policy_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 5 · WORK PERMITS (issued mall / building permits) ──────
-- Policy-in-use delete guard is enforced in the API (no FKs here).
CREATE TABLE IF NOT EXISTS wkr_work_permits (
  id                      CHAR(36) NOT NULL DEFAULT (uuid()),
  permit_number           VARCHAR(255) DEFAULT '',
  title                   VARCHAR(255) DEFAULT '',
  mall_name               VARCHAR(255) DEFAULT '',
  project_reference       VARCHAR(255) DEFAULT '',
  contractor_client       VARCHAR(255) DEFAULT '',
  work_scope              TEXT,
  work_area               VARCHAR(255) DEFAULT '',
  working_hours           VARCHAR(255) DEFAULT '',
  applied_by              VARCHAR(255) DEFAULT 'own_team',  -- own_team / client / mall
  issued_by               VARCHAR(255) DEFAULT '',
  issue_date              DATE DEFAULT NULL,
  valid_from              DATE DEFAULT NULL,
  valid_until             DATE DEFAULT NULL,
  file_url                VARCHAR(512) DEFAULT '',           -- the approved permit PDF
  status                  VARCHAR(255) DEFAULT 'active',     -- active / cancelled / superseded
  notes                   TEXT,
  duration                VARCHAR(255) DEFAULT 'ad_hoc',     -- yearly / monthly / ad_hoc
  insurance_source        VARCHAR(255) DEFAULT 'none',       -- hg_existing / new / client / none
  insurance_policy_id     CHAR(36) DEFAULT NULL,
  insurance_provider      VARCHAR(255) DEFAULT '',
  insurance_policy_number VARCHAR(255) DEFAULT '',
  insurance_file_url      VARCHAR(512) DEFAULT '',
  insurance_notes         TEXT,
  client_invoice_number   VARCHAR(255) DEFAULT '',
  created_by              VARCHAR(255) DEFAULT '',
  created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by              VARCHAR(255) DEFAULT '',
  updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_wkr_permits_valid_until (valid_until),
  INDEX idx_wkr_permits_policy (insurance_policy_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wkr_permit_workers (
  id        CHAR(36) NOT NULL DEFAULT (uuid()),
  permit_id CHAR(36) NOT NULL,
  worker_id CHAR(36) NOT NULL,
  role      VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id),
  INDEX idx_wkr_pw_permit (permit_id),
  INDEX idx_wkr_pw_worker (worker_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wkr_permit_attachments (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  permit_id  CHAR(36) NOT NULL,
  label      VARCHAR(255) DEFAULT '',
  file_url   VARCHAR(512) DEFAULT '',
  sort_order INT DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_wkr_pa_permit (permit_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 6 · FORM LIBRARY (blank permit forms per mall) ─────────
CREATE TABLE IF NOT EXISTS wkr_permit_forms (
  id                 CHAR(36) NOT NULL DEFAULT (uuid()),
  mall_name          VARCHAR(255) NOT NULL,
  form_name          VARCHAR(255) NOT NULL,
  form_type          VARCHAR(255) DEFAULT '',
  version            VARCHAR(255) DEFAULT '',
  file_url           VARCHAR(512) DEFAULT '',
  contact_info       VARCHAR(255) DEFAULT '',
  lead_time          VARCHAR(255) DEFAULT '',
  requirements       TEXT,
  notes              TEXT,
  last_verified_date DATE DEFAULT NULL,
  created_by         VARCHAR(255) DEFAULT '',
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by         VARCHAR(255) DEFAULT '',
  updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 7 · REPORT HISTORY (compliance-report wizard runs) ─────
CREATE TABLE IF NOT EXISTS wkr_report_history (
  id             CHAR(36) NOT NULL DEFAULT (uuid()),
  generated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  generated_by   VARCHAR(255) DEFAULT '',
  format         VARCHAR(255) DEFAULT '',     -- checklist / fullpack / combined
  mall_name      VARCHAR(255) DEFAULT '',
  project_name   VARCHAR(255) DEFAULT '',
  contractor_ref VARCHAR(255) DEFAULT '',
  report_date    DATE DEFAULT NULL,
  division_ids   TEXT,                        -- CSV, same shape as the GAS version
  worker_ids     TEXT,
  doc_types      TEXT,
  worker_count   INT DEFAULT 0,
  doc_type_count INT DEFAULT 0,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 8 · SWMS / HIRARC TEMPLATE LIBRARY ─────────────────────
-- Tabs exist in 07-workers.xlsx with production rows but have no table in
-- schema-workers.sql — added for the data import.
CREATE TABLE IF NOT EXISTS wkr_swms_services (          -- XLSX-ADDED
  id         VARCHAR(64) NOT NULL,                      -- XLSX-ADDED
  name       VARCHAR(255) NOT NULL DEFAULT '',          -- XLSX-ADDED
  sort_order INT DEFAULT 0,                             -- XLSX-ADDED
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wkr_swms_steps (             -- XLSX-ADDED
  id                  VARCHAR(64) NOT NULL,             -- XLSX-ADDED
  service             VARCHAR(255) DEFAULT '',          -- XLSX-ADDED
  step_no             VARCHAR(32) DEFAULT '',           -- XLSX-ADDED
  job_step            TEXT,                             -- XLSX-ADDED
  method              TEXT,                             -- XLSX-ADDED
  hazards             TEXT,                             -- XLSX-ADDED
  impacts             TEXT,                             -- XLSX-ADDED
  existing_controls   TEXT,                             -- XLSX-ADDED
  impact              VARCHAR(64) DEFAULT '',           -- XLSX-ADDED
  likelihood          VARCHAR(64) DEFAULT '',           -- XLSX-ADDED
  additional_controls TEXT,                             -- XLSX-ADDED
  sort_order          INT DEFAULT 0,                    -- XLSX-ADDED
  PRIMARY KEY (id),
  INDEX idx_wkr_swms_steps_service (service)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wkr_swms_equipment (         -- XLSX-ADDED
  id         VARCHAR(64) NOT NULL,                      -- XLSX-ADDED
  service    VARCHAR(255) DEFAULT '',                   -- XLSX-ADDED
  equipment  VARCHAR(255) DEFAULT '',                   -- XLSX-ADDED
  purpose    TEXT,                                      -- XLSX-ADDED
  sort_order INT DEFAULT 0,                             -- XLSX-ADDED
  PRIMARY KEY (id),
  INDEX idx_wkr_swms_eq_service (service)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wkr_swms_ppe (               -- XLSX-ADDED
  id         VARCHAR(64) NOT NULL,                      -- XLSX-ADDED
  service    VARCHAR(255) DEFAULT '',                   -- XLSX-ADDED
  ppe        VARCHAR(255) DEFAULT '',                   -- XLSX-ADDED
  sort_order INT DEFAULT 0,                             -- XLSX-ADDED
  PRIMARY KEY (id),
  INDEX idx_wkr_swms_ppe_service (service)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 9 · SETTINGS (was the Config sheet) ────────────────────
INSERT IGNORE INTO app_settings (`key`, `value`) VALUES
  ('WKR_EXPIRING_SOON_DAYS', '30'),
  ('WKR_EXPIRING_WARN_DAYS', '90');

-- ─── 10 · ALARMS VIEW — read by the daily alarms job + the UI ─
-- Worker documents (active workers only) and active work permits expired or
-- expiring within WKR_EXPIRING_SOON_DAYS (default 30). DATETIMEs are stored
-- Asia/Kuala_Lumpur local, so CURDATE() replaces the Postgres tz conversion.
CREATE OR REPLACE VIEW wkr_alarms AS
SELECT 'worker_doc_expiry' AS alarm_type,
       w.full_name AS ref,
       CONCAT('Worker doc · ', w.full_name, ' · ', d.doc_type,
              CASE WHEN COALESCE(d.doc_subtype,'') <> '' THEN CONCAT(' · ', d.doc_subtype) ELSE '' END,
              CASE WHEN COALESCE(d.doc_number,'')  <> '' THEN CONCAT(' · #', d.doc_number) ELSE '' END) AS detail,
       d.expiry_date AS due_date,
       COALESCE((SELECT `value` FROM app_settings WHERE `key` = 'COMPANY_EMAIL'), '') AS recipient
FROM wkr_documents d
JOIN wkr_workers w ON w.id = d.worker_id
WHERE w.status = 'active'
  AND d.expiry_date IS NOT NULL
  AND d.expiry_date <= DATE_ADD(CURDATE(), INTERVAL COALESCE(
        (SELECT CAST(NULLIF(`value`,'') AS UNSIGNED) FROM app_settings
          WHERE `key` = 'WKR_EXPIRING_SOON_DAYS'), 30) DAY)
UNION ALL
SELECT 'permit_expiry' AS alarm_type,
       COALESCE(NULLIF(p.permit_number,''), NULLIF(p.title,''), p.mall_name) AS ref,
       CONCAT('Work permit · ', COALESCE(NULLIF(p.title,''), '(untitled)'),
              CASE WHEN COALESCE(p.mall_name,'') <> '' THEN CONCAT(' · ', p.mall_name) ELSE '' END,
              CASE WHEN COALESCE(p.contractor_client,'') <> '' THEN CONCAT(' · ', p.contractor_client) ELSE '' END) AS detail,
       p.valid_until AS due_date,
       COALESCE((SELECT `value` FROM app_settings WHERE `key` = 'COMPANY_EMAIL'), '') AS recipient
FROM wkr_work_permits p
WHERE COALESCE(p.status,'active') = 'active'
  AND p.valid_until IS NOT NULL
  AND p.valid_until <= DATE_ADD(CURDATE(), INTERVAL COALESCE(
        (SELECT CAST(NULLIF(`value`,'') AS UNSIGNED) FROM app_settings
          WHERE `key` = 'WKR_EXPIRING_SOON_DAYS'), 30) DAY);

-- ─── Phase 2 checklist ──────────────────────────────────────
-- RPC-PORT: wkr_save_permit(payload jsonb) — atomic upsert of a work permit, then replaces its wkr_permit_workers links (deduped workerIds) and wkr_permit_attachments (payload order → sort_order, empty rows dropped) from the payload; blanks insurance_policy_id unless insuranceSource='hg_existing'; requires mall/permitNumber/title; audit-logs wkr.permit.create|update.
-- RPC-PORT: wkr_save_insurance(payload jsonb) — atomic upsert of an insurance policy (policyNumber+provider required), then replaces its wkr_insurance_attachments, wkr_insurance_quotes and wkr_insurance_payments from the payload (order → sort_order, empty rows dropped); audit-logs wkr.insurance.create|update.
-- RPC-PORT: wkr_delete_division(p_id uuid) — deletes a division; blocked if any non-resigned worker is still assigned; detaches resigned workers (division_id=NULL) first; audit-logs wkr.division.delete.
-- BUCKET: worker-docs
