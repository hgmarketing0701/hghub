-- ============================================================
-- HG hub — Project P&L (MySQL 8) — translated from supabase/schema-project-pl.sql
-- Reconciled against 09-project-pl.xlsx (2026-07-16) — all 22 tabs
-- Prefix: pl_ · App file: project-pl-supabase.html
-- ============================================================
SET NAMES utf8mb4;

-- ─── 0 · SHARED clients TABLE ────────────────────────────────────────────────
-- Supabase extends the shared foundation `clients` table via ALTER (contact_person,
-- contact_number, address, updated_at, updated_by). MySQL has no idempotent
-- ALTER ... ADD COLUMN, so this module defines the FULL merged column set.
-- If the foundation module already created `clients` WITHOUT these columns,
-- apply once manually:
--   ALTER TABLE clients
--     ADD COLUMN contact_person VARCHAR(255) DEFAULT '',
--     ADD COLUMN contact_number VARCHAR(64)  DEFAULT '',
--     ADD COLUMN address        VARCHAR(255) DEFAULT '',
--     ADD COLUMN updated_at     DATETIME NULL,
--     ADD COLUMN updated_by     VARCHAR(255) DEFAULT '';
-- xlsx tab: Clients (rows=47) — all headers covered by this merged definition.
CREATE TABLE IF NOT EXISTS clients (
  id             CHAR(36) NOT NULL DEFAULT (uuid()),
  name           VARCHAR(255) NOT NULL,
  type           VARCHAR(64)  DEFAULT 'Contractor',   -- Mall / Contractor / Tenant
  phone          VARCHAR(64)  DEFAULT '',
  email          VARCHAR(255) DEFAULT '',
  notes          TEXT,
  created_by     VARCHAR(255) DEFAULT '',
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  contact_person VARCHAR(255) DEFAULT '',
  contact_number VARCHAR(64)  DEFAULT '',
  address        VARCHAR(255) DEFAULT '',
  updated_at     DATETIME NULL,
  updated_by     VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 1 · RBAC — pl_user_roles ───────────────────────────────────────────────
-- xlsx tab: UserRoles (rows=8)
CREATE TABLE IF NOT EXISTS pl_user_roles (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  email      VARCHAR(255) NOT NULL,
  role       VARCHAR(32) NOT NULL CHECK (role IN ('Admin','Manager','Editor','Viewer')),
  notes      TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(255) DEFAULT '',
  updated_at DATETIME NULL,
  updated_by VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY uq_pl_user_roles_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bootstrap admins (idempotent via UNIQUE email + INSERT IGNORE)
INSERT IGNORE INTO pl_user_roles (email, role, notes) VALUES
  ('lee@hggroup.com.my',       'Admin', 'bootstrap admin'),
  ('marketing@hggroup.com.my', 'Admin', 'bootstrap admin · Finance UI/UX administration'),
  ('znerationmedia@gmail.com', 'Admin', 'bootstrap admin');

-- ─── 2 · MASTER LISTS ───────────────────────────────────────────────────────
-- xlsx tab: Buildings (rows=39)
CREATE TABLE IF NOT EXISTS pl_buildings (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  name       VARCHAR(255) NOT NULL,
  address    VARCHAR(255) DEFAULT '',
  notes      TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(255) DEFAULT '',
  updated_at DATETIME NULL,
  updated_by VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx tab: Subcons (rows=36)
CREATE TABLE IF NOT EXISTS pl_subcons (
  id             CHAR(36) NOT NULL DEFAULT (uuid()),
  name           VARCHAR(255) NOT NULL,
  trade          VARCHAR(255) DEFAULT '',
  contact_person VARCHAR(255) DEFAULT '',
  contact_number VARCHAR(64)  DEFAULT '',
  notes          TEXT,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by     VARCHAR(255) DEFAULT '',
  updated_at     DATETIME NULL,
  updated_by     VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx tab: Suppliers (rows=8)
CREATE TABLE IF NOT EXISTS pl_suppliers (
  id             CHAR(36) NOT NULL DEFAULT (uuid()),
  name           VARCHAR(255) NOT NULL,
  category       VARCHAR(255) DEFAULT '',
  contact_person VARCHAR(255) DEFAULT '',
  contact_number VARCHAR(64)  DEFAULT '',
  address        VARCHAR(255) DEFAULT '',
  notes          TEXT,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by     VARCHAR(255) DEFAULT '',
  updated_at     DATETIME NULL,
  updated_by     VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx tab: MaterialItems (rows=8)
CREATE TABLE IF NOT EXISTS pl_material_items (
  id           CHAR(36) NOT NULL DEFAULT (uuid()),
  name         VARCHAR(255) NOT NULL,
  default_unit VARCHAR(32) DEFAULT '',
  notes        TEXT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by   VARCHAR(255) DEFAULT '',
  updated_at   DATETIME NULL,
  updated_by   VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx tab: Divisions (rows=4)
CREATE TABLE IF NOT EXISTS pl_divisions (
  id             CHAR(36) NOT NULL DEFAULT (uuid()),
  name           VARCHAR(255) NOT NULL,
  head           VARCHAR(255) DEFAULT '',
  contact_number VARCHAR(64)  DEFAULT '',
  notes          TEXT,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by     VARCHAR(255) DEFAULT '',
  updated_at     DATETIME NULL,
  updated_by     VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx tab: Workers (rows=3)
CREATE TABLE IF NOT EXISTS pl_workers (
  id             CHAR(36) NOT NULL DEFAULT (uuid()),
  name           VARCHAR(255) NOT NULL,
  role           VARCHAR(255) DEFAULT '',
  contact_number VARCHAR(64)  DEFAULT '',
  notes          TEXT,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by     VARCHAR(255) DEFAULT '',
  updated_at     DATETIME NULL,
  updated_by     VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx tab: Supervisors (rows=6)
CREATE TABLE IF NOT EXISTS pl_supervisors (
  id             CHAR(36) NOT NULL DEFAULT (uuid()),
  name           VARCHAR(255) NOT NULL,
  role           VARCHAR(255) DEFAULT '',
  contact_number VARCHAR(64)  DEFAULT '',
  notes          TEXT,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by     VARCHAR(255) DEFAULT '',
  updated_at     DATETIME NULL,
  updated_by     VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx tab: Lookups (rows=51)
CREATE TABLE IF NOT EXISTS pl_lookups (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  type       VARCHAR(64) NOT NULL,   -- Category / SubCategory / ProjectStatus / JobStatus /
                                     -- ClientPaymentStatus / JobScopeUnit / MaterialUnit
  value      VARCHAR(255) NOT NULL,
  sort_order DECIMAL(10,2) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(255) DEFAULT '',
  updated_at DATETIME NULL,
  updated_by VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id),
  INDEX idx_pl_lookups_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 3 · PROJECTS + TRANSACTIONS ────────────────────────────────────────────
-- xlsx tab: Projects (rows=58)
CREATE TABLE IF NOT EXISTS pl_projects (
  id                 CHAR(36) NOT NULL DEFAULT (uuid()),
  code               VARCHAR(64)  DEFAULT '',
  category           VARCHAR(255) DEFAULT '',
  sub_category       VARCHAR(255) DEFAULT '',
  client_id          CHAR(36) NULL,
  client_name        VARCHAR(255) DEFAULT '',
  building_id        CHAR(36) NULL,
  building_name      VARCHAR(255) DEFAULT '',
  address            VARCHAR(255) DEFAULT '',
  lot_number         VARCHAR(64)  DEFAULT '',
  supervisor_ids     TEXT,                          -- pipe-joined uuid list (as in GAS)
  supervisor_name    VARCHAR(255) DEFAULT '',
  po_number          VARCHAR(64)  DEFAULT '',
  invoice_number     VARCHAR(64)  DEFAULT '',
  invoice_date       DATE NULL,
  invoice_amount     DECIMAL(14,2) DEFAULT 0,
  client_invoice_url VARCHAR(512) DEFAULT '',
  discount           DECIMAL(14,2) DEFAULT 0,
  adjustment         DECIMAL(14,2) DEFAULT 0,
  sst_applicable     TINYINT(1) DEFAULT 0,
  sst_rate           DECIMAL(5,2) DEFAULT 0,
  parent_project_id  CHAR(36) NULL,
  is_in_house        TINYINT(1) DEFAULT 0,          -- XLSX-ADDED
  start_date         DATE NULL,
  end_date           DATE NULL,
  duration_days      DECIMAL(12,2) NULL,
  status             VARCHAR(64) DEFAULT '',
  notes              TEXT,
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by         VARCHAR(255) DEFAULT '',
  updated_at         DATETIME NULL,
  updated_by         VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id),
  INDEX idx_pl_projects_code (code),
  INDEX idx_pl_projects_client (client_id),
  INDEX idx_pl_projects_building (building_id),
  INDEX idx_pl_projects_parent (parent_project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx tab: JobScopes (rows=285)
CREATE TABLE IF NOT EXISTS pl_job_scopes (
  id                    CHAR(36) NOT NULL DEFAULT (uuid()),
  project_id            CHAR(36) NOT NULL,
  description           TEXT,
  qty                   DECIMAL(12,2) DEFAULT 0,
  unit                  VARCHAR(32) DEFAULT '',
  client_rate           DECIMAL(14,2) DEFAULT 0,
  client_amount         DECIMAL(14,2) DEFAULT 0,
  performed_by          VARCHAR(32) DEFAULT 'Subcon',    -- Subcon / InHouseTeam / OtherDivision
  subcon_id             CHAR(36) NULL,
  subcon_name           VARCHAR(255) DEFAULT '',
  subcon_rate           DECIMAL(14,2) DEFAULT 0,
  subcon_amount         DECIMAL(14,2) DEFAULT 0,
  division_id           CHAR(36) NULL,
  division_name         VARCHAR(255) DEFAULT '',
  internal_cost         DECIMAL(14,2) DEFAULT 0,
  cost_confirmation     VARCHAR(32) DEFAULT 'Confirmed', -- Confirmed / Estimated / Absorbed / None
  subcon_invoice_number VARCHAR(64) DEFAULT '',
  subcon_invoice_date   DATE NULL,
  subcon_invoice_url    VARCHAR(512) DEFAULT '',
  completion_report_url VARCHAR(512) DEFAULT '',
  supporting_docs_url   VARCHAR(512) DEFAULT '',
  job_status            VARCHAR(64) DEFAULT '',
  client_payment_status VARCHAR(64) DEFAULT '',
  notes                 TEXT,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by            VARCHAR(255) DEFAULT '',
  updated_at            DATETIME NULL,
  updated_by            VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id),
  INDEX idx_pl_job_scopes_project (project_id),
  INDEX idx_pl_job_scopes_subcon (subcon_id),
  INDEX idx_pl_job_scopes_division (division_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx tab: Materials (rows=9)
CREATE TABLE IF NOT EXISTS pl_materials (
  id                     CHAR(36) NOT NULL DEFAULT (uuid()),
  project_id             CHAR(36) NOT NULL,
  job_scope_id           CHAR(36) NULL,
  item_id                CHAR(36) NULL,
  item_name              VARCHAR(255) DEFAULT '',
  qty                    DECIMAL(12,2) DEFAULT 0,
  unit                   VARCHAR(32) DEFAULT '',
  unit_cost              DECIMAL(14,2) DEFAULT 0,
  total_cost             DECIMAL(14,2) DEFAULT 0,
  supplier_id            CHAR(36) NULL,
  supplier_name          VARCHAR(255) DEFAULT '',
  po_number              VARCHAR(64) DEFAULT '',
  invoice_number         VARCHAR(64) DEFAULT '',
  invoice_date           DATE NULL,
  invoice_url            VARCHAR(512) DEFAULT '',
  delivery_order_url     VARCHAR(512) DEFAULT '',
  material_photos_url    VARCHAR(512) DEFAULT '',
  notes                  TEXT,
  material_source        VARCHAR(32) DEFAULT 'Supplier',  -- Supplier / InHouseSubcon
  charged_to_subcon_id   CHAR(36) NULL,
  charged_to_subcon_name VARCHAR(255) DEFAULT '',
  created_at             DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by             VARCHAR(255) DEFAULT '',
  updated_at             DATETIME NULL,
  updated_by             VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id),
  INDEX idx_pl_materials_project (project_id),
  INDEX idx_pl_materials_job_scope (job_scope_id),
  INDEX idx_pl_materials_item (item_id),
  INDEX idx_pl_materials_supplier (supplier_id),
  INDEX idx_pl_materials_charged_subcon (charged_to_subcon_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx tab: ClientPayments (rows=42)
CREATE TABLE IF NOT EXISTS pl_client_payments (
  id           CHAR(36) NOT NULL DEFAULT (uuid()),
  project_id   CHAR(36) NOT NULL,
  payment_date DATE NULL,
  amount       DECIMAL(14,2) DEFAULT 0,
  reference    VARCHAR(255) DEFAULT '',
  slip_url     VARCHAR(512) DEFAULT '',
  notes        TEXT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by   VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id),
  INDEX idx_pl_client_payments_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx tab: SubconPayments (rows=52)
CREATE TABLE IF NOT EXISTS pl_subcon_payments (
  id           CHAR(36) NOT NULL DEFAULT (uuid()),
  project_id   CHAR(36) NOT NULL,
  job_scope_id CHAR(36) NULL,
  subcon_id    CHAR(36) NULL,
  subcon_name  VARCHAR(255) DEFAULT '',
  payment_date DATE NULL,
  amount       DECIMAL(14,2) DEFAULT 0,
  reference    VARCHAR(255) DEFAULT '',
  slip_url     VARCHAR(512) DEFAULT '',
  notes        TEXT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by   VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id),
  INDEX idx_pl_subcon_payments_project (project_id),
  INDEX idx_pl_subcon_payments_job_scope (job_scope_id),
  INDEX idx_pl_subcon_payments_subcon (subcon_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx tab: SupplierPayments (rows=0)
CREATE TABLE IF NOT EXISTS pl_supplier_payments (
  id            CHAR(36) NOT NULL DEFAULT (uuid()),
  project_id    CHAR(36) NOT NULL,
  material_id   CHAR(36) NULL,
  supplier_id   CHAR(36) NULL,
  supplier_name VARCHAR(255) DEFAULT '',
  payment_date  DATE NULL,
  amount        DECIMAL(14,2) DEFAULT 0,
  reference     VARCHAR(255) DEFAULT '',
  slip_url      VARCHAR(512) DEFAULT '',
  notes         TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by    VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id),
  INDEX idx_pl_supplier_payments_project (project_id),
  INDEX idx_pl_supplier_payments_material (material_id),
  INDEX idx_pl_supplier_payments_supplier (supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx tab: SubconCharges (rows=33)
CREATE TABLE IF NOT EXISTS pl_subcon_charges (
  id                    CHAR(36) NOT NULL DEFAULT (uuid()),
  project_id            CHAR(36) NOT NULL,
  subcon_id             CHAR(36) NULL,
  subcon_name           VARCHAR(255) DEFAULT '',
  lump_amount           DECIMAL(14,2) DEFAULT 0,
  job_scope_ids         TEXT,                       -- pipe-joined scope-id list (as in GAS)
  invoice_number        VARCHAR(64) DEFAULT '',
  invoice_date          DATE NULL,
  invoice_url           VARCHAR(512) DEFAULT '',
  completion_report_url VARCHAR(512) DEFAULT '',
  supporting_docs_url   VARCHAR(512) DEFAULT '',
  notes                 TEXT,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by            VARCHAR(255) DEFAULT '',
  updated_at            DATETIME NULL,
  updated_by            VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id),
  INDEX idx_pl_subcon_charges_project (project_id),
  INDEX idx_pl_subcon_charges_subcon (subcon_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx tab: DailyReports (rows=0)
CREATE TABLE IF NOT EXISTS pl_daily_reports (
  id          CHAR(36) NOT NULL DEFAULT (uuid()),
  project_id  CHAR(36) NOT NULL,
  report_date DATE NULL,
  title       VARCHAR(255) DEFAULT '',
  report_url  VARCHAR(512) DEFAULT '',
  notes       TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by  VARCHAR(255) DEFAULT '',
  updated_at  DATETIME NULL,
  updated_by  VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id),
  INDEX idx_pl_daily_reports_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx tab: Manpower (rows=0)
CREATE TABLE IF NOT EXISTS pl_manpower (
  id            CHAR(36) NOT NULL DEFAULT (uuid()),
  project_id    CHAR(36) NOT NULL,
  job_scope_id  CHAR(36) NULL,
  worker_type   VARCHAR(32) DEFAULT 'inhouse',   -- inhouse / subcon
  worker_id     CHAR(36) NULL,                   -- pl_workers.id OR pl_subcons.id (per worker_type)
  worker_name   VARCHAR(255) DEFAULT '',
  work_date     DATE NULL,
  duration_days DECIMAL(12,2) DEFAULT 0,
  rate          DECIMAL(14,2) DEFAULT 0,
  total_cost    DECIMAL(14,2) DEFAULT 0,
  notes         TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by    VARCHAR(255) DEFAULT '',
  updated_at    DATETIME NULL,
  updated_by    VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id),
  INDEX idx_pl_manpower_project (project_id),
  INDEX idx_pl_manpower_job_scope (job_scope_id),
  INDEX idx_pl_manpower_worker (worker_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx tab: ProjectPhotos (rows=19)
CREATE TABLE IF NOT EXISTS pl_project_photos (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  project_id CHAR(36) NOT NULL,
  kind       VARCHAR(32) DEFAULT 'before',       -- before / after
  photo_url  VARCHAR(512) DEFAULT '',
  caption    VARCHAR(255) DEFAULT '',
  taken_date DATE NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(255) DEFAULT '',
  updated_at DATETIME NULL,
  updated_by VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id),
  INDEX idx_pl_project_photos_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- xlsx tab: CreditNotes (rows=0)
CREATE TABLE IF NOT EXISTS pl_credit_notes (
  id                  CHAR(36) NOT NULL DEFAULT (uuid()),
  project_id          CHAR(36) NOT NULL,
  type                VARCHAR(32) DEFAULT 'credit',   -- credit / refund
  credit_note_number  VARCHAR(64) DEFAULT '',
  credit_note_date    DATE NULL,
  amount              DECIMAL(14,2) DEFAULT 0,
  reason              TEXT,
  status              VARCHAR(64) DEFAULT '',
  bank_name           VARCHAR(255) DEFAULT '',
  bank_account_name   VARCHAR(255) DEFAULT '',
  bank_account_number VARCHAR(64)  DEFAULT '',
  refund_paid_date    DATE NULL,
  credit_note_url     VARCHAR(512) DEFAULT '',
  notes               TEXT,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by          VARCHAR(255) DEFAULT '',
  updated_at          DATETIME NULL,
  updated_by          VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id),
  INDEX idx_pl_credit_notes_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 4 · APP AUDIT LOG ──────────────────────────────────────────────────────
-- xlsx tab: AuditLog (rows=1857) — headers: timestamp|userEmail|action|recordType|recordId|details
-- (xlsx `timestamp` column imports into `at`; `id` is generated on import)
CREATE TABLE IF NOT EXISTS pl_audit_log (
  id          BIGINT AUTO_INCREMENT,
  at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  user_email  VARCHAR(255) DEFAULT '',
  action      VARCHAR(255) NOT NULL,
  record_type VARCHAR(64)  DEFAULT '',
  record_id   VARCHAR(512) DEFAULT '',
  details     TEXT,
  PRIMARY KEY (id),
  INDEX idx_pl_audit_record (record_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 5 · SEED LOOKUPS (same defaults as GAS seedLookupsIfEmpty_) ────────────
-- Guarded: seeds ONLY when pl_lookups is completely empty.
-- NOTE: production 09-project-pl.xlsx Lookups tab has 51 rows — import that
-- FIRST (or skip this block) so seed rows don't duplicate production values.
INSERT INTO pl_lookups (type, value, sort_order, created_by)
SELECT v.type, v.value, v.sort_order, v.created_by FROM (
  SELECT 'Category' AS type, 'Hoarding' AS value, 1 AS sort_order, 'seed' AS created_by
  UNION ALL SELECT 'Category','Visual Print & Install',2,'seed'
  UNION ALL SELECT 'Category','Scaffold',3,'seed'
  UNION ALL SELECT 'Category','Temporary Storage Rental',4,'seed'
  UNION ALL SELECT 'Category','Reinstatement',5,'seed'
  UNION ALL SELECT 'Category','Fit-Out',6,'seed'
  UNION ALL SELECT 'Category','In-House Building Maintenance',7,'seed'
  UNION ALL SELECT 'SubCategory','Upgrading',1,'seed'
  UNION ALL SELECT 'SubCategory','Repair',2,'seed'
  UNION ALL SELECT 'SubCategory','Replacement',3,'seed'
  UNION ALL SELECT 'SubCategory','New',4,'seed'
  UNION ALL SELECT 'ProjectStatus','Quoted',1,'seed'
  UNION ALL SELECT 'ProjectStatus','Active',2,'seed'
  UNION ALL SELECT 'ProjectStatus','Completed',3,'seed'
  UNION ALL SELECT 'ProjectStatus','On Hold',4,'seed'
  UNION ALL SELECT 'ProjectStatus','Cancelled',5,'seed'
  UNION ALL SELECT 'JobStatus','Not Started',1,'seed'
  UNION ALL SELECT 'JobStatus','In Progress',2,'seed'
  UNION ALL SELECT 'JobStatus','Completed',3,'seed'
  UNION ALL SELECT 'JobStatus','On Hold',4,'seed'
  UNION ALL SELECT 'JobStatus','Cancelled',5,'seed'
  UNION ALL SELECT 'ClientPaymentStatus','Unbilled',1,'seed'
  UNION ALL SELECT 'ClientPaymentStatus','Invoiced',2,'seed'
  UNION ALL SELECT 'ClientPaymentStatus','Partially Paid',3,'seed'
  UNION ALL SELECT 'ClientPaymentStatus','Fully Paid',4,'seed'
  UNION ALL SELECT 'ClientPaymentStatus','Overdue',5,'seed'
  UNION ALL SELECT 'JobScopeUnit','lm',1,'seed'
  UNION ALL SELECT 'JobScopeUnit','sqm',2,'seed'
  UNION ALL SELECT 'JobScopeUnit','lot',3,'seed'
  UNION ALL SELECT 'JobScopeUnit','pc',4,'seed'
  UNION ALL SELECT 'JobScopeUnit','nos',5,'seed'
  UNION ALL SELECT 'JobScopeUnit','cum',6,'seed'
  UNION ALL SELECT 'JobScopeUnit','set',7,'seed'
  UNION ALL SELECT 'JobScopeUnit','day',8,'seed'
  UNION ALL SELECT 'MaterialUnit','pcs',1,'seed'
  UNION ALL SELECT 'MaterialUnit','sqm',2,'seed'
  UNION ALL SELECT 'MaterialUnit','kg',3,'seed'
  UNION ALL SELECT 'MaterialUnit','m',4,'seed'
  UNION ALL SELECT 'MaterialUnit','lm',5,'seed'
  UNION ALL SELECT 'MaterialUnit','box',6,'seed'
  UNION ALL SELECT 'MaterialUnit','roll',7,'seed'
  UNION ALL SELECT 'MaterialUnit','litre',8,'seed'
  UNION ALL SELECT 'MaterialUnit','bag',9,'seed'
) v
WHERE NOT EXISTS (SELECT 1 FROM pl_lookups LIMIT 1);

-- ─── RPC-PORT checklist (Phase 2 — port to JS in the Express API) ───────────
-- RPC-PORT: pl_role() — effective role of the signed-in user: foundation admins are always 'Admin', else pl_user_roles lookup by email, default 'Viewer'
-- RPC-PORT: pl_my_role() — exposes pl_role() to the app so it can gate the UI
-- RPC-PORT: pl_role_in(roles text[]) — true when user is_allowed() AND pl_role() is one of the given roles (RBAC gate used by all policies)
-- RPC-PORT: pl_log_audit(p_action text, p_record_type text, p_record_id text, p_details text) — inserts into pl_audit_log (details truncated to 300 chars) AND mirrors into the shared foundation audit_log with '[P&L] ' prefix
-- RPC-PORT: pl_next_project_code(p_parent_code text default null) — sequential project codes PRJ-YYYYMM-### (Asia/Kuala_Lumpur month, zero-padded); with a parent code, returns next add-on letter suffix (PARENT-A, -B, ...); Editor+ only
-- (RLS role model to enforce in the API: Admin=all incl. user mgmt; Manager=all except user mgmt;
--  Editor=projects+operations, NO payments/credit notes, no masters; Viewer=read-only, no money.
--  Project delete = Manager+. Money tables (pl_client_payments/pl_subcon_payments/
--  pl_supplier_payments/pl_credit_notes) = Admin/Manager only. pl_user_roles = Admin only.
--  pl_audit_log read = Admin/Manager.)

-- ─── BUCKETS ────────────────────────────────────────────────────────────────
-- BUCKET: pl-files
