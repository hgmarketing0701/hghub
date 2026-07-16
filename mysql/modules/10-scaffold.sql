-- ============================================================
-- HG hub — scaffold & green tag (MySQL 8) — translated from supabase/schema-scaffold.sql
-- Reconciled against 11-scaffold-greentag.xlsx (2026-07-16)
-- Run AFTER the foundation module (allowed_users, audit_log live there).
-- xlsx AuditLog tab imports into the foundation audit_log table ('[scaffold]' details).
-- ============================================================
SET NAMES utf8mb4;

-- ─── 1 · ENGAGEMENTS (jobs) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS scf_engagements (
  id                    CHAR(36) NOT NULL DEFAULT (uuid()),
  job_no                VARCHAR(64) NOT NULL,
  service_type          VARCHAR(64) NOT NULL DEFAULT 'Aluminium', -- Aluminium / Customized / GreenTag
  scope                 VARCHAR(64) NOT NULL DEFAULT 'Full',      -- Full / RentalOnly / EndorseOnly
  status                VARCHAR(64) NOT NULL DEFAULT 'Active',    -- Quote / Active / Extension / OnHold / Completed / Cancelled
  client_company        VARCHAR(255) NOT NULL,
  client_pic            VARCHAR(255) DEFAULT '',
  client_contact        VARCHAR(255) DEFAULT '',
  client_email          VARCHAR(255) DEFAULT '',
  client_address        VARCHAR(255) DEFAULT '',
  site_name             VARCHAR(255) DEFAULT '',
  site_address          VARCHAR(255) DEFAULT '',
  scaffold_desc         TEXT,
  third_party           VARCHAR(255) DEFAULT '',
  pe_no                 VARCHAR(64) DEFAULT '',
  pe_endorsed_by        VARCHAR(255) DEFAULT '',
  pe_endorsed_date      DATE,
  start_date            DATE,
  expected_end_date     DATE,
  actual_return_date    DATE,
  green_tag             VARCHAR(8) DEFAULT 'No',                  -- Yes / No
  inspect_interval_days INT DEFAULT 7,
  assigned_inspector    VARCHAR(255) DEFAULT '',
  delivery_sign_name    VARCHAR(255) DEFAULT '',
  delivery_sign_date    DATE,
  delivery_sign_url     VARCHAR(512) DEFAULT '',                  -- storage path in bucket 'scaffold'
  return_sign_name      VARCHAR(255) DEFAULT '',
  return_sign_date      DATE,
  return_sign_url       VARCHAR(512) DEFAULT '',
  photos_site           TEXT,                                     -- comma-joined storage paths
  photos_before         TEXT,
  photos_after          TEXT,
  photos_collection     TEXT,
  photos_defect         TEXT,
  handled_by            VARCHAR(255) DEFAULT '',
  remarks               TEXT,
  created_by            VARCHAR(255) DEFAULT '',
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by            VARCHAR(255) DEFAULT '',
  updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_scf_engagements_job_no (job_no)                   -- system-generated JOB-####
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 2 · CHARGES ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scf_charges (
  id            CHAR(36) NOT NULL DEFAULT (uuid()),
  engagement_id CHAR(36) NOT NULL,                 -- was FK → scf_engagements(id); no FK by convention
  type          VARCHAR(64) NOT NULL DEFAULT 'Other', -- PE/Rental/Install/Transport/Dismantle/GreenTag/ThirdParty/Other
  description   TEXT,
  qty           DECIMAL(12,2) DEFAULT 1,
  unit          VARCHAR(64) DEFAULT '',
  rate          DECIMAL(14,2) DEFAULT 0,
  basis         VARCHAR(64) DEFAULT '',            -- Day/Week/Month/Trip/Visit/Lump sum
  amount        DECIMAL(14,2) DEFAULT 0,
  invoice_id    CHAR(36),                          -- set when billed (scf_invoices.id); no FK by convention
  created_by    VARCHAR(255) DEFAULT '',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_scf_charges_eng (engagement_id),
  INDEX idx_scf_charges_inv (invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 3 · MATERIALS (checkout / return) ───────────────────────
CREATE TABLE IF NOT EXISTS scf_materials (
  id            CHAR(36) NOT NULL DEFAULT (uuid()),
  engagement_id CHAR(36) NOT NULL,                 -- was FK → scf_engagements(id); no FK by convention
  code          VARCHAR(64) DEFAULT '',
  item          VARCHAR(255) NOT NULL,
  spec          VARCHAR(255) DEFAULT '',
  category      VARCHAR(64) DEFAULT '',
  unit          VARCHAR(64) DEFAULT 'pcs',
  qty_out       DECIMAL(12,2) DEFAULT 0,
  qty_returned  DECIMAL(12,2) DEFAULT 0,
  damage_qty    DECIMAL(12,2) DEFAULT 0,
  damage_charge DECIMAL(14,2) DEFAULT 0,
  remarks       TEXT,
  updated_by    VARCHAR(255) DEFAULT '',
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_scf_materials_eng (engagement_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 4 · INSPECTIONS (green tag) ─────────────────────────────
CREATE TABLE IF NOT EXISTS scf_inspections (
  id                CHAR(36) NOT NULL DEFAULT (uuid()),
  engagement_id     CHAR(36) NOT NULL,             -- was FK → scf_engagements(id); no FK by convention
  inspect_date      DATE NOT NULL,
  inspector         VARCHAR(255) NOT NULL,
  inspector_cert_no VARCHAR(64) DEFAULT '',
  result            VARCHAR(64) NOT NULL DEFAULT 'Green', -- Green / Red / Hold
  tag_no            VARCHAR(64) DEFAULT '',
  next_due_date     DATE,
  findings          TEXT,
  photos_url        TEXT,                          -- comma-joined storage paths
  cert_url          VARCHAR(512) DEFAULT '',       -- storage path
  created_by        VARCHAR(255) DEFAULT '',
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_scf_inspections_eng (engagement_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 5 · INVOICES & PAYMENTS ─────────────────────────────────
CREATE TABLE IF NOT EXISTS scf_invoices (
  id             CHAR(36) NOT NULL DEFAULT (uuid()),
  inv_no         VARCHAR(64) NOT NULL,
  engagement_id  CHAR(36),                         -- was FK → scf_engagements(id); no FK by convention
  client_company VARCHAR(255) NOT NULL,
  inv_date       DATE NOT NULL,
  due_date       DATE,
  description    TEXT,
  amount         DECIMAL(14,2) NOT NULL DEFAULT 0,
  sst_enabled    TINYINT(1) DEFAULT 1,
  sst_amount     DECIMAL(14,2) NOT NULL DEFAULT 0,
  total          DECIMAL(14,2) NOT NULL DEFAULT 0,
  status         VARCHAR(64) DEFAULT '',           -- '' or 'Void'
  file_url       VARCHAR(512) DEFAULT '',          -- storage path (attached PDF)
  file_id        VARCHAR(512) DEFAULT '',          -- XLSX-ADDED (legacy Drive file ID, files not migrating yet)
  notes          TEXT,
  created_by     VARCHAR(255) DEFAULT '',
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_scf_invoices_inv_no (inv_no),          -- production has duplicate inv_nos; app-level dup check in scf_invoice_from_charges
  INDEX idx_scf_invoices_eng (engagement_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scf_payments (
  id          CHAR(36) NOT NULL DEFAULT (uuid()),
  invoice_id  CHAR(36) NOT NULL,                   -- was FK → scf_invoices(id); no FK by convention
  pay_date    DATE NOT NULL,
  amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
  method      VARCHAR(64) DEFAULT '',
  reference   VARCHAR(255) DEFAULT '',
  received_by VARCHAR(255) DEFAULT '',
  notes       TEXT,
  created_by  VARCHAR(255) DEFAULT '',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_scf_payments_inv (invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 6 · PERSONNEL / CERTS ───────────────────────────────────
CREATE TABLE IF NOT EXISTS scf_personnel (
  id          CHAR(36) NOT NULL DEFAULT (uuid()),
  name        VARCHAR(255) NOT NULL,
  role        VARCHAR(64) DEFAULT '',
  cert_type   VARCHAR(64) NOT NULL,                -- WAH / ScaffoldErector / ScaffoldInspector / OSHCoordinator
  cert_no     VARCHAR(64) DEFAULT '',
  issued_date DATE,
  expiry_date DATE,
  contact     VARCHAR(255) DEFAULT '',
  remarks     TEXT,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 7 · CATALOGUE (HG aluminium scaffold material) ──────────
CREATE TABLE IF NOT EXISTS scf_catalogue (
  id       CHAR(36) NOT NULL DEFAULT (uuid()),
  code     VARCHAR(64) DEFAULT '',
  item     VARCHAR(255) NOT NULL,
  spec     VARCHAR(255) DEFAULT '',
  category VARCHAR(64) DEFAULT '',
  unit     VARCHAR(64) DEFAULT 'pcs',
  sort     INT DEFAULT 0,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- seed — codes + specs from the hardcopy delivery/return form (same as GAS
-- seedCatalogue_). Only fires when the table is completely empty — skip this
-- (or truncate first) if you import the xlsx Catalogue tab instead.
INSERT INTO scf_catalogue (code, item, spec, category, unit, sort)
SELECT * FROM (
  SELECT 'AFS05/AFD05'    AS code, '5 Rung Frame'     AS item, '0.75m x 2.5m / 1.35m x 2.5m' AS spec, 'Aluminium mobile' AS category, 'pcs' AS unit, 1  AS sort UNION ALL
  SELECT 'AFS04/AFD04',           '4 Rung Frame',            '0.75m x 2m / 1.35m x 2m',            'Aluminium mobile', 'pcs', 2  UNION ALL
  SELECT 'AFS03/AFD03',           '3 Rung Frame',            '0.75m x 1.5m / 1.35m x 1.5m',        'Aluminium mobile', 'pcs', 3  UNION ALL
  SELECT 'AFS02/AFD02',           'Guardrail',               '0.75m x 1m / 1.35m x 1m',            'Aluminium mobile', 'pcs', 4  UNION ALL
  SELECT 'AHB01/AHB02',           'Horizontal Brace',        '1.8m / 2.4m',                        'Aluminium mobile', 'pcs', 5  UNION ALL
  SELECT 'ADB01/ADB02',           'Diagonal Brace',          '2.4m / 3m',                          'Aluminium mobile', 'pcs', 6  UNION ALL
  SELECT 'DP01/DP02/DP03',        'Door Platform',           '1.8m / 1.9m / 2.4m',                 'Aluminium mobile', 'pcs', 7  UNION ALL
  SELECT 'P01/P02/P03',           'Platform',                '1.8m / 1.9m / 2.4m',                 'Aluminium mobile', 'pcs', 8  UNION ALL
  SELECT 'S01',                   'Stabilizer',              '3.5m',                               'Aluminium mobile', 'pcs', 9  UNION ALL
  SELECT 'TB01',                  'Toe Board',               '—',                                  'Aluminium mobile', 'pcs', 10 UNION ALL
  SELECT 'L01',                   'Ladder',                  '2.4m',                               'Aluminium mobile', 'pcs', 11 UNION ALL
  SELECT 'LH01',                  'Ladder Handrail',         '2.15m',                              'Aluminium mobile', 'pcs', 12 UNION ALL
  SELECT 'CW01',                  '8" Castor Wheel',         '—',                                  'Aluminium mobile', 'pcs', 13
) AS v
WHERE NOT EXISTS (SELECT 1 FROM scf_catalogue LIMIT 1);

-- ─── 8 · SETTINGS (was Config sheet — same keys as GAS DEFAULTS) ──
CREATE TABLE IF NOT EXISTS scf_settings (
  `key`   VARCHAR(64) NOT NULL,
  `value` TEXT,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO scf_settings (`key`, `value`) VALUES
  ('GREENTAG_INTERVAL_DAYS',   '7'),
  ('GREENTAG_DUE_SOON_DAYS',   '2'),
  ('COLLECTION_DUE_SOON_DAYS', '7'),
  ('CERT_EXPIRY_WARN_DAYS',    '45'),
  ('INVOICE_DUE_SOON_DAYS',    '5'),
  ('SST_RATE_PCT',             '6'),
  ('REMINDER_TO',              ''),
  ('COMPANY_NAME',             'HG Services (M) Sdn Bhd'),
  ('COMPANY_REG',              '958510-M · CIDB 0120170412-WP1187072 (G7)'),
  ('COMPANY_ADDRESS',          'Lot 12 & 13, Jalan BK 1/11, Taman Perindustrian Bandar Kinrara, Bandar Kinrara 1, 47180 Puchong, Selangor'),
  ('COMPANY_PHONE',            '03-8082 3388 / 012-6273 3524'),
  ('SST_NO',                   ''),
  ('INVOICE_PREFIX',           'HG-INV'),
  ('INVOICE_TERMS_DAYS',       '30'),
  ('JOB_PREFIX',               'JOB-');

-- ─── Phase 2 checklists ──────────────────────────────────────
-- RPC-PORT: scf_next_job_no() — next sequential job number: JOB_PREFIX (scf_settings, default 'JOB-') + 4-digit zero-padded max+1 over numeric suffixes of existing scf_engagements.job_no, skipping manually typed numbers already in use.
-- RPC-PORT: scf_next_invoice_no() — same algorithm for invoices: INVOICE_PREFIX (default 'HG-INV') + 4-digit seq over scf_invoices.inv_no.
-- RPC-PORT: scf_invoice_from_charges(payload jsonb) — payload {engagementId, sstEnabled?=true, invNo?, invDate?, dueDate?}: collects ALL uninvoiced charges on the job (error if none), recomputes amount/SST (SST_RATE_PCT, default 6%)/total server-side, due date = inv date + INVOICE_TERMS_DAYS (default 30), builds a per-charge description block (type label + description + RM amount, newline-joined, ordered by created_at), inv_no from payload or scf_next_invoice_no() with case-insensitive duplicate check, inserts scf_invoices atomically, stamps those scf_charges.invoice_id, audit-logs 'SCF CREATE Invoice', returns the new invoice id. Must be transactional.
-- RPC-PORT: scf_alarms() — was a Postgres VIEW (too complex for a portable MySQL view; read by the daily-alarms job). Returns rows (alarm_type, ref, detail, due_date, recipient) for: green-tag inspections due/overdue on Active/Extension jobs where green_tag='Yes' or service_type='GreenTag' (due = last inspection (else start_date, else today) + inspect_interval_days, warn within GREENTAG_DUE_SOON_DAYS); scaffold collection due (material qty_out - qty_returned > 0 onsite, expected_end_date within COLLECTION_DUE_SOON_DAYS); unpaid non-Void invoices (total - payments > 0.005) due within INVOICE_DUE_SOON_DAYS; personnel cert expiry within CERT_EXPIRY_WARN_DAYS. Recipient = REMINDER_TO setting, else engagement handled_by when it is an email, else ''.
-- BUCKET: scaffold
