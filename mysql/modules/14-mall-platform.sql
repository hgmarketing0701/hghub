-- ============================================================
-- HG hub — mall-platform (MySQL 8) — translated from supabase/schema-mall-platform.sql
-- Reconciled against 17-mall-platform.xlsx (2026-07-16), 20 tabs.
-- Run AFTER the foundation module (allowed_users, audit_log live there).
-- xlsx AuditLog tab (Timestamp | User | Action | Details) imports into the
-- foundation audit_log table (at, user_email, action, details).
-- xlsx "Measurements" tab mentioned in AI-HANDOFF §6 is NOT in the 2026-07-16
-- export (20 tabs reconciled below) — nothing to create.
-- Supabase seed inserts dropped: production xlsx import supplies the data.
-- ============================================================
SET NAMES utf8mb4;

-- ─── 1 · MALLS MASTER ────────────────────────────────────────
-- xlsx Malls: ID | Name | Code | UOM | Group | Location | Notes | Added By | Added On
-- (Added On → created_at)
CREATE TABLE IF NOT EXISTS mp_malls (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  name       VARCHAR(255) NOT NULL,
  code       VARCHAR(64) DEFAULT '',
  uom        VARCHAR(64) DEFAULT '',                -- XLSX-ADDED
  `group`    VARCHAR(255) DEFAULT '',               -- XLSX-ADDED (mall group / operator)
  location   VARCHAR(255) DEFAULT '',
  notes      TEXT,
  added_by   VARCHAR(255) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Supabase had UNIQUE(name); user-entered mall names → plain index per conventions
  INDEX idx_mp_malls_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 2 · DOOR 1 — SKETCHES (drawing vault) ───────────────────
-- xlsx Sketches: Timestamp | Mall | Code | Lot No | Shop Type | Version |
--   File Name | File URL | File ID | Folder URL | Remarks | Uploaded By
-- (Timestamp → created_at)
CREATE TABLE IF NOT EXISTS mp_sketches (
  id           CHAR(36) NOT NULL DEFAULT (uuid()),
  mall         VARCHAR(255) NOT NULL,
  code         VARCHAR(64) DEFAULT '',
  lot_no       VARCHAR(255) NOT NULL,
  shop_type    VARCHAR(255) DEFAULT '',
  version      INT NOT NULL DEFAULT 1,
  file_name    VARCHAR(255) NOT NULL,
  storage_path VARCHAR(512) NOT NULL DEFAULT '',    -- path inside the 'mall-sketches' bucket
  mime_type    VARCHAR(255) DEFAULT '',
  file_url     VARCHAR(512) DEFAULT '',             -- XLSX-ADDED (legacy Drive URL, files not migrating yet)
  file_id      VARCHAR(512) DEFAULT '',             -- XLSX-ADDED (legacy Drive file ID)
  folder_url   VARCHAR(512) DEFAULT '',             -- XLSX-ADDED (legacy Drive folder URL)
  remarks      TEXT,
  uploaded_by  VARCHAR(255) DEFAULT '',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_mp_sketches_mall_lot (mall, lot_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 3 · DOOR 2 — REFERENCE / RATE BOOK ──────────────────────
-- xlsx Categories: ID | Name | Sort
CREATE TABLE IF NOT EXISTS mp_categories (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  name       VARCHAR(255) NOT NULL,
  sort       INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx Requirements: ID | Mall | Category | Requirement | Type | Value |
--   Shop Type | Notes | Sort | Updated By | Updated On
CREATE TABLE IF NOT EXISTS mp_requirements (
  id          CHAR(36) NOT NULL DEFAULT (uuid()),
  mall        VARCHAR(255) NOT NULL,
  category    VARCHAR(255) DEFAULT '',
  requirement VARCHAR(255) DEFAULT '',
  type        VARCHAR(255) DEFAULT '',
  value       TEXT,
  shop_type   VARCHAR(255) DEFAULT '',
  notes       TEXT,
  sort        INT DEFAULT 0,
  updated_by  VARCHAR(255) DEFAULT '',
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_mp_requirements_mall (mall)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx RequirementTypes: ID | Category | Name | Sort
CREATE TABLE IF NOT EXISTS mp_requirement_types (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  category   VARCHAR(255) DEFAULT '',
  name       VARCHAR(255) NOT NULL,
  sort       INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx Types: ID | Category | Name | Sort (Hoarding/Visual "Type" dropdown)
CREATE TABLE IF NOT EXISTS mp_types (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  category   VARCHAR(255) DEFAULT '',
  name       VARCHAR(255) NOT NULL,
  sort       INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx JobCategories: ID | Name | Sort
CREATE TABLE IF NOT EXISTS mp_job_categories (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  name       VARCHAR(255) NOT NULL,
  sort       INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx Panels: ID | Name | PIC | Phone | Email | Notes | Updated By | Updated On
CREATE TABLE IF NOT EXISTS mp_panels (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  name       VARCHAR(255) NOT NULL,
  pic        VARCHAR(255) DEFAULT '',
  phone      VARCHAR(64) DEFAULT '',
  email      VARCHAR(255) DEFAULT '',
  notes      TEXT,
  updated_by VARCHAR(255) DEFAULT '',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx PanelRates: ID | Panel | Job Category | Mall | Rate Basis | Price From |
--   Price To | Lot Size Ref | Engaged On | Notes | Updated By | Updated On
CREATE TABLE IF NOT EXISTS mp_panel_rates (
  id           CHAR(36) NOT NULL DEFAULT (uuid()),
  panel        VARCHAR(255) NOT NULL,
  job_category VARCHAR(255) DEFAULT '',
  mall         VARCHAR(255) DEFAULT '',
  rate_basis   VARCHAR(255) DEFAULT '',
  price_from   DECIMAL(14,2),
  price_to     DECIMAL(14,2),
  lot_size_ref VARCHAR(255) DEFAULT '',
  engaged_on   VARCHAR(255) DEFAULT '',             -- free text e.g. 'May 2025'
  notes        TEXT,
  updated_by   VARCHAR(255) DEFAULT '',
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_mp_panel_rates_mall (mall)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx ShopTypes: ID | Name | Sort
CREATE TABLE IF NOT EXISTS mp_shop_types (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  name       VARCHAR(255) NOT NULL,
  sort       INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx RateBasis: ID | Name | Sort
CREATE TABLE IF NOT EXISTS mp_rate_basis (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  name       VARCHAR(255) NOT NULL,
  sort       INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 4 · DOOR 3 — HIRARC / MOS (SWMS templates) ──────────────
-- xlsx SwmsServices: ID | Name | Sort
CREATE TABLE IF NOT EXISTS mp_swms_services (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  name       VARCHAR(255) NOT NULL,
  sort       INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx SwmsSteps: ID | Service | Step No | Job Step | Method | Hazards | Impacts |
--   Existing Controls | Impact | Likelihood | Additional Controls | Sort
CREATE TABLE IF NOT EXISTS mp_swms_steps (
  id                  CHAR(36) NOT NULL DEFAULT (uuid()),
  service             VARCHAR(255) NOT NULL,
  step_no             INT DEFAULT 0,
  job_step            TEXT,
  method              TEXT,
  hazards             TEXT,
  impacts             TEXT,
  existing_controls   TEXT,
  impact              INT,
  likelihood          INT,
  additional_controls TEXT,
  sort                INT DEFAULT 0,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_mp_swms_steps_service (service)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx SwmsEquipment: ID | Service | Equipment | Purpose | Sort
CREATE TABLE IF NOT EXISTS mp_swms_equipment (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  service    VARCHAR(255) NOT NULL,
  equipment  VARCHAR(255) DEFAULT '',
  purpose    VARCHAR(255) DEFAULT '',
  sort       INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx SwmsPPE: ID | Service | PPE | Sort
CREATE TABLE IF NOT EXISTS mp_swms_ppe (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  service    VARCHAR(255) NOT NULL,
  ppe        VARCHAR(255) DEFAULT '',
  sort       INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx TeamMembers: ID | Name | Sort
CREATE TABLE IF NOT EXISTS mp_team_members (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  name       VARCHAR(255) NOT NULL,
  sort       INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx MeasureTypes: ID | Name | Sort
CREATE TABLE IF NOT EXISTS mp_measure_types (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  name       VARCHAR(255) NOT NULL,
  sort       INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 5 · DOOR 4 — MEASUREMENT REQUEST TRACKER ────────────────
-- xlsx MeasureRequests: ID | Date | Requestor | Mall | Lot No | Client |
--   Work Type | Assigned To | Remarks | Ref Photos | Purpose | Status |
--   Quote Sent On | Notes | Updated By | Updated On
-- (Date → req_date, Updated On → updated_at; column names kept from Supabase)
CREATE TABLE IF NOT EXISTS mp_measure_requests (
  id            CHAR(36) NOT NULL DEFAULT (uuid()),
  req_date      DATE NULL,  -- production has blank dates
  requestor     VARCHAR(255) DEFAULT '',
  mall          VARCHAR(255) NOT NULL,
  lot_no        VARCHAR(255) NOT NULL,
  client        VARCHAR(255) NOT NULL,
  work_type     VARCHAR(255) DEFAULT '',
  assigned_to   VARCHAR(255) DEFAULT '',
  remarks       TEXT,
  ref_photos    TEXT,                               -- one 'file name|storage path' per line
  purpose       VARCHAR(64) DEFAULT 'Quotation',
  status        VARCHAR(64) DEFAULT 'Requested',    -- Requested / Measured / Quotation Sent / Closed
  quote_sent_on DATE,
  notes         TEXT,
  updated_by    VARCHAR(255) DEFAULT '',
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_mp_measure_requests_mall_lot (mall, lot_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 6 · HOARDING LINES (takeoff, 3-tier pricing) ────────────
-- XLSX-ADDED table — no Supabase equivalent. From xlsx HoardingLines (rows=0):
-- ID | Date | Mall | Lot No | Tenant | Line Type | Cost Type | Description |
-- Size | Length | Height | Qty | UOM | Total Size | Rate Mall | Amount Mall |
-- Rate Contractor | Amount Contractor | Rate Tenant | Amount Tenant |
-- Drawing File ID | Created By | Created On
CREATE TABLE IF NOT EXISTS mp_hoarding_lines (
  id                CHAR(36) NOT NULL DEFAULT (uuid()),
  date              DATE,
  mall              VARCHAR(255) DEFAULT '',
  lot_no            VARCHAR(255) DEFAULT '',
  tenant            VARCHAR(255) DEFAULT '',
  line_type         VARCHAR(255) DEFAULT '',
  cost_type         VARCHAR(255) DEFAULT '',
  description       TEXT,
  size              VARCHAR(255) DEFAULT '',
  length            DECIMAL(12,2),
  height            DECIMAL(12,2),
  qty               DECIMAL(12,2),
  uom               VARCHAR(64) DEFAULT '',
  total_size        DECIMAL(12,2),
  rate_mall         DECIMAL(14,2),
  amount_mall       DECIMAL(14,2),
  rate_contractor   DECIMAL(14,2),
  amount_contractor DECIMAL(14,2),
  rate_tenant       DECIMAL(14,2),
  amount_tenant     DECIMAL(14,2),
  drawing_file_id   VARCHAR(512) DEFAULT '',        -- Drive file ID, files not migrating yet
  created_by        VARCHAR(255) DEFAULT '',
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,  -- 'Created On'
  PRIMARY KEY (id),
  INDEX idx_mp_hoarding_lines_mall_lot (mall, lot_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Phase 2 checklists ──────────────────────────────────────
-- RPC-PORT: mp_next_version(p_mall text, p_lot text) — returns COALESCE(MAX(version),0)+1 from mp_sketches for that Mall+Lot (case-insensitive match), assigned server-side per upload batch; requires is_allowed().
-- BUCKET: mall-sketches
