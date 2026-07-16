-- ============================================================
-- HG hub — lorry + fleet (MySQL 8) — translated from supabase/schema-lorry.sql
-- Reconciled against 24-lorry.xlsx (master fleet dataset: lorry-era + fleet-v2 tabs)
-- and 15-fleet-command-center.xlsx (older secondary sheet, flt_ prefix) — 2026-07-16
-- ============================================================
SET NAMES utf8mb4;

-- ─── 1 · VEHICLES (Supabase lry_vehicles ⇐ xlsx tabs "Lorries" + fleet-v2 "Vehicles")
-- The fleet-v2 "Vehicles" tab (rows=0) binds to the same sheet; its extra columns
-- are merged here rather than creating a duplicate lry_vehicles table.
-- xlsx "Type"→vehicle_type, "Lorry Code"→vehicle_code, "Notes"/"notes"→notes.
CREATE TABLE IF NOT EXISTS lry_vehicles (
  id                 CHAR(36) NOT NULL DEFAULT (uuid()),
  plate              VARCHAR(255) NOT NULL,
  vehicle_code       VARCHAR(64) DEFAULT '',
  model              VARCHAR(255) DEFAULT '',
  year               INT,
  active             TINYINT(1) DEFAULT 1,
  notes              TEXT,
  vehicle_card_path  VARCHAR(512) DEFAULT '',          -- storage path of geran photo/PDF
  vehicle_type       VARCHAR(64) DEFAULT 'lorry',      -- lorry/van/car/pickup/motorcycle/bus/machinery/other
  keyed_by           VARCHAR(255) DEFAULT '',          -- XLSX-ADDED (fleet-v2 Vehicles tab "Keyed By")
  doc_link           VARCHAR(512) DEFAULT '',          -- XLSX-ADDED (fleet-v2 Vehicles tab "Doc Link")
  reg_date           DATE,                             -- XLSX-ADDED (fleet-v2 Vehicles tab "regDate")
  status             VARCHAR(64) DEFAULT '',           -- XLSX-ADDED (fleet-v2 Vehicles tab "status")
  driver             VARCHAR(255) DEFAULT '',          -- XLSX-ADDED (fleet-v2 Vehicles tab "driver")
  reg_card_url       VARCHAR(512) DEFAULT '',          -- XLSX-ADDED (fleet-v2 Vehicles tab "regCardUrl")
  created_by         VARCHAR(255) DEFAULT '',
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by         VARCHAR(255) DEFAULT '',
  updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_lry_vehicles_plate (plate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 2 · FUEL LOGS (⇐ xlsx "FuelLogs") ──────────────────────
CREATE TABLE IF NOT EXISTS lry_fuel_logs (
  id                  CHAR(36) NOT NULL DEFAULT (uuid()),
  date                DATE NOT NULL,
  plate               VARCHAR(255) NOT NULL,
  odometer            DECIMAL(12,2),
  litres              DECIMAL(12,2),
  amount_rm           DECIMAL(14,2) NOT NULL DEFAULT 0,
  station             VARCHAR(255) DEFAULT '',
  paid_by             VARCHAR(255) DEFAULT '',          -- company-card/cash/driver-reimburse/fleet-card
  driver              VARCHAR(255) DEFAULT '',
  notes               TEXT,
  pump_photo_path     VARCHAR(512) DEFAULT '',
  receipt_photo_path  VARCHAR(512) DEFAULT '',
  time                VARCHAR(64) DEFAULT '',           -- XLSX-ADDED
  card                VARCHAR(255) DEFAULT '',          -- XLSX-ADDED (fleet/fuel-card statement import)
  site                VARCHAR(255) DEFAULT '',          -- XLSX-ADDED
  product             VARCHAR(255) DEFAULT '',          -- XLSX-ADDED
  ppl                 DECIMAL(14,4),                    -- XLSX-ADDED (price per litre)
  amount              DECIMAL(14,2),                    -- XLSX-ADDED (statement amount, distinct from amount_rm)
  odo                 DECIMAL(12,2),                    -- XLSX-ADDED (statement odometer, distinct from odometer)
  is_subsidy          TINYINT(1),                       -- XLSX-ADDED
  source              VARCHAR(255) DEFAULT '',          -- XLSX-ADDED
  uploaded_by         VARCHAR(255) DEFAULT '',          -- XLSX-ADDED
  uploaded_at         DATETIME,                         -- XLSX-ADDED
  created_by          VARCHAR(255) DEFAULT '',
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by          VARCHAR(255) DEFAULT '',
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_lry_fuel_plate_date (plate, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 3 · TOLL & PARKING LOGS (⇐ xlsx "TollParkLogs") ────────
CREATE TABLE IF NOT EXISTS lry_toll_park_logs (
  id                  CHAR(36) NOT NULL DEFAULT (uuid()),
  date                DATE NOT NULL,
  plate               VARCHAR(255) NOT NULL,
  type                VARCHAR(64) NOT NULL DEFAULT 'toll',   -- toll | parking
  amount_rm           DECIMAL(14,2) NOT NULL DEFAULT 0,
  location            VARCHAR(255) DEFAULT '',
  paid_by             VARCHAR(255) DEFAULT '',
  driver              VARCHAR(255) DEFAULT '',
  job_ref             VARCHAR(255) DEFAULT '',
  duration            VARCHAR(255) DEFAULT '',
  notes               TEXT,
  receipt_photo_path  VARCHAR(512) DEFAULT '',
  time                VARCHAR(64) DEFAULT '',           -- XLSX-ADDED
  card                VARCHAR(255) DEFAULT '',          -- XLSX-ADDED (TnG/toll-card statement import)
  category            VARCHAR(255) DEFAULT '',          -- XLSX-ADDED
  entry               VARCHAR(255) DEFAULT '',          -- XLSX-ADDED (toll entry point)
  `exit`              VARCHAR(255) DEFAULT '',          -- XLSX-ADDED (toll exit point; reserved word, backticked)
  amount              DECIMAL(14,2),                    -- XLSX-ADDED (statement amount, distinct from amount_rm)
  source              VARCHAR(255) DEFAULT '',          -- XLSX-ADDED
  uploaded_by         VARCHAR(255) DEFAULT '',          -- XLSX-ADDED
  uploaded_at         DATETIME,                         -- XLSX-ADDED
  created_by          VARCHAR(255) DEFAULT '',
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by          VARCHAR(255) DEFAULT '',
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_lry_toll_plate_date (plate, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 4 · MAINTENANCE LOGS (⇐ xlsx "MaintLogs") ──────────────
CREATE TABLE IF NOT EXISTS lry_maint_logs (
  id                    CHAR(36) NOT NULL DEFAULT (uuid()),
  date                  DATE NOT NULL,
  plate                 VARCHAR(255) NOT NULL,
  odometer              DECIMAL(12,2),
  type                  VARCHAR(64) DEFAULT 'service',   -- service/repair/tyre/battery/other
  items_replaced        TEXT,                            -- flat searchable text (derived)
  workshop              VARCHAR(255) DEFAULT '',
  cost_rm               DECIMAL(14,2) DEFAULT 0,         -- grand total (server recomputed)
  next_service_km       DECIMAL(12,2),
  next_service_date     DATE,
  notes                 TEXT,
  receipt_photo_id      VARCHAR(512) DEFAULT '',         -- XLSX-ADDED (legacy singular "receiptPhotoId")
  receipt_photo_paths   JSON DEFAULT (JSON_ARRAY()),
  line_items            JSON DEFAULT (JSON_ARRAY()),     -- [{desc,qty,rate,tax}]
  sub_total             DECIMAL(14,2),
  taxable               TINYINT(1),
  tax_rate              DECIMAL(14,4),                   -- legacy invoice-level rate (fraction)
  tax_amount            DECIMAL(14,2),
  discount_amount       DECIMAL(14,2),
  before_photo_paths    JSON DEFAULT (JSON_ARRAY()),
  after_photo_paths     JSON DEFAULT (JSON_ARRAY()),
  payment_slip_paths    JSON DEFAULT (JSON_ARRAY()),
  payment_ref           VARCHAR(255) DEFAULT '',
  paid_date             DATE,
  invoice_number        VARCHAR(255) DEFAULT '',
  paid_rm               DECIMAL(14,2),
  created_by            VARCHAR(255) DEFAULT '',
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by            VARCHAR(255) DEFAULT '',
  updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_lry_maint_plate_date (plate, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 5 · COMPLIANCE LOGS (⇐ xlsx "ComplianceLogs") ──────────
CREATE TABLE IF NOT EXISTS lry_compliance_logs (
  id                    CHAR(36) NOT NULL DEFAULT (uuid()),
  plate                 VARCHAR(255) NOT NULL,
  type                  VARCHAR(64) NOT NULL,            -- roadtax | insurance | puspakom
  status                VARCHAR(64) DEFAULT 'active',    -- active/renewed/cancelled/lost/archived
  issued_date           DATE,
  expiry_date           DATE,
  amount_rm             DECIMAL(14,2) DEFAULT 0,
  coverage_rm           DECIMAL(14,2),
  insurer               VARCHAR(255) DEFAULT '',
  policy_number         VARCHAR(255) DEFAULT '',
  agency_name           VARCHAR(255) DEFAULT '',
  agency_charges_rm     DECIMAL(14,2),
  notes                 TEXT,
  main_doc_paths        JSON DEFAULT (JSON_ARRAY()),
  receipt_paths         JSON DEFAULT (JSON_ARRAY()),
  agent_invoice_paths   JSON DEFAULT (JSON_ARRAY()),
  payment_slip_paths    JSON DEFAULT (JSON_ARRAY()),
  renewed_by_id         VARCHAR(64) DEFAULT '',          -- id of the entry that replaced this one
  prev_id               VARCHAR(64) DEFAULT '',          -- id of the entry this renews
  payment_ref           VARCHAR(255) DEFAULT '',
  paid_date             DATE,
  ref_no                VARCHAR(255) DEFAULT '',         -- XLSX-ADDED (legacy "refNo")
  issue_date            DATE,                            -- XLSX-ADDED (legacy "issueDate", distinct from issued_date)
  doc_url               VARCHAR(512) DEFAULT '',         -- XLSX-ADDED (legacy "docUrl", Drive URL)
  created_by            VARCHAR(255) DEFAULT '',
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by            VARCHAR(255) DEFAULT '',
  updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_lry_comp_plate_type (plate, type),
  INDEX idx_lry_comp_expiry (expiry_date),
  INDEX idx_lry_comp_renewed_by (renewed_by_id),
  INDEX idx_lry_comp_prev (prev_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 6 · INCIDENT LOGS (⇐ xlsx "IncidentLogs") ──────────────
CREATE TABLE IF NOT EXISTS lry_incident_logs (
  id                          CHAR(36) NOT NULL DEFAULT (uuid()),
  date                        DATE NOT NULL,
  time                        VARCHAR(64) DEFAULT '',
  plate                       VARCHAR(255) NOT NULL,
  driver_name                 VARCHAR(255) DEFAULT '',
  location                    VARCHAR(255) DEFAULT '',
  location_gps                VARCHAR(255) DEFAULT '',
  type                        VARCHAR(64) NOT NULL DEFAULT 'other',
  collision_type              VARCHAR(64) DEFAULT 'none',
  collision_other             VARCHAR(255) DEFAULT '',
  third_party_plates          VARCHAR(255) DEFAULT '',
  third_party_name            VARCHAR(255) DEFAULT '',
  third_party_contact         VARCHAR(255) DEFAULT '',
  third_party_insurer         VARCHAR(255) DEFAULT '',
  fault_party                 VARCHAR(64) DEFAULT 'n-a',
  details                     TEXT,
  damaged_asset               VARCHAR(255) DEFAULT '',
  witnesses                   VARCHAR(255) DEFAULT '',
  towed                       VARCHAR(64) DEFAULT 'none',
  tow_company                 VARCHAR(255) DEFAULT '',
  tow_cost_rm                 DECIMAL(14,2),
  injury_any                  TINYINT(1) DEFAULT 0,
  injury_action               VARCHAR(64) DEFAULT 'none',
  injured_person_name         VARCHAR(255) DEFAULT '',
  hospital_name               VARCHAR(255) DEFAULT '',
  injury_details              TEXT,
  police_report_status        VARCHAR(64) DEFAULT 'not-filed',
  police_report_number        VARCHAR(255) DEFAULT '',
  police_station              VARCHAR(255) DEFAULT '',
  follow_up_needed            TINYINT(1) DEFAULT 0,
  follow_up_notes             TEXT,
  incident_photo_paths        JSON DEFAULT (JSON_ARRAY()),
  police_report_paths         JSON DEFAULT (JSON_ARRAY()),
  quotation_paths             JSON DEFAULT (JSON_ARRAY()),
  compensation_paid_rm        DECIMAL(14,2),
  compensation_paid_to        VARCHAR(255) DEFAULT '',
  compensation_paid_paths     JSON DEFAULT (JSON_ARRAY()),
  compensation_received_rm    DECIMAL(14,2),
  compensation_received_from  VARCHAR(255) DEFAULT '',
  compensation_received_paths JSON DEFAULT (JSON_ARRAY()),
  insurance_claim_filed       TINYINT(1) DEFAULT 0,
  insurance_company           VARCHAR(255) DEFAULT '',
  claim_number                VARCHAR(255) DEFAULT '',
  claim_amount_rm             DECIMAL(14,2),
  claim_status                VARCHAR(64) DEFAULT 'none',
  repair_action               VARCHAR(64) DEFAULT 'not-required',
  linked_maint_id             VARCHAR(64) DEFAULT '',
  status                      VARCHAR(64) DEFAULT 'open',
  notes                       TEXT,
  driver                      VARCHAR(255) DEFAULT '',   -- XLSX-ADDED (legacy "driver", distinct from driver_name)
  description                 TEXT,                      -- XLSX-ADDED (legacy "description")
  damage_rm                   DECIMAL(14,2),             -- XLSX-ADDED (legacy "damageRM")
  doc_url                     VARCHAR(512) DEFAULT '',   -- XLSX-ADDED (legacy "docUrl", Drive URL)
  created_by                  VARCHAR(255) DEFAULT '',
  created_at                  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by                  VARCHAR(255) DEFAULT '',
  updated_at                  DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_lry_inc_plate_date (plate, date),
  INDEX idx_lry_inc_linked_maint (linked_maint_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 7 · DRIVERS (⇐ xlsx "Drivers": camelCase = lorry-era → Supabase columns;
--        Title-Case = legacy fleet-era columns → XLSX-ADDED) ──────────────────
CREATE TABLE IF NOT EXISTS lry_drivers (
  id                        CHAR(36) NOT NULL DEFAULT (uuid()),
  name                      VARCHAR(255) NOT NULL,
  ic_number                 VARCHAR(64) DEFAULT '',       -- xlsx "ic"
  staff_id                  VARCHAR(64) DEFAULT '',
  phone                     VARCHAR(64) DEFAULT '',
  email                     VARCHAR(255) DEFAULT '',
  active                    TINYINT(1) DEFAULT 1,
  license_class             VARCHAR(64) DEFAULT '',
  license_number            VARCHAR(64) DEFAULT '',       -- xlsx "licenseNo"
  license_issue_date        DATE,
  license_expiry_date       DATE,                         -- xlsx "licenseExpiry"
  gdl_expiry_date           DATE,                         -- xlsx "gdlExpiry"
  address                   VARCHAR(255) DEFAULT '',
  emergency_contact_name    VARCHAR(255) DEFAULT '',
  emergency_contact_phone   VARCHAR(64) DEFAULT '',
  hire_date                 DATE,
  assigned_plate            VARCHAR(255) DEFAULT '',
  status                    VARCHAR(64) DEFAULT 'active', -- active/on-leave/resigned/terminated
  notes                     TEXT,
  photo_path                VARCHAR(512) DEFAULT '',      -- xlsx "photoId"
  license_doc_paths         JSON DEFAULT (JSON_ARRAY()),  -- xlsx "licenseDocIds"
  ic_doc_paths              JSON DEFAULT (JSON_ARRAY()),  -- xlsx "icDocIds"
  category                  VARCHAR(64) DEFAULT 'in-house', -- in-house/outsourced/relief/contract
  ic                        VARCHAR(64) DEFAULT '',       -- XLSX-ADDED (legacy "IC", distinct from ic_number)
  license_expiry            DATE,                         -- XLSX-ADDED (legacy "License Expiry")
  gdl_expiry                DATE,                         -- XLSX-ADDED (legacy "GDL Expiry")
  assigned_vehicle          VARCHAR(255) DEFAULT '',      -- XLSX-ADDED (legacy "Assigned Vehicle")
  notes_legacy              TEXT,                         -- XLSX-ADDED (legacy "Notes"; renamed to avoid collision with notes)
  keyed_by                  VARCHAR(255) DEFAULT '',      -- XLSX-ADDED (legacy "Keyed By")
  license_doc               VARCHAR(512) DEFAULT '',      -- XLSX-ADDED (legacy "License Doc", Drive link)
  passport_photo            VARCHAR(512) DEFAULT '',      -- XLSX-ADDED (legacy "Passport Photo", Drive link)
  ic_doc                    VARCHAR(512) DEFAULT '',      -- XLSX-ADDED (legacy "IC Doc", Drive link)
  license_renewal_doc       VARCHAR(512) DEFAULT '',      -- XLSX-ADDED (legacy "License Renewal Doc", Drive link)
  license_url               VARCHAR(512) DEFAULT '',      -- XLSX-ADDED ("licenseUrl", Drive URL)
  ic_url                    VARCHAR(512) DEFAULT '',      -- XLSX-ADDED ("icUrl", Drive URL)
  created_by                VARCHAR(255) DEFAULT '',
  created_at                DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by                VARCHAR(255) DEFAULT '',
  updated_at                DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_lry_drivers_staff (staff_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 8 · SUMMONS (⇐ xlsx "SummonLogs") ──────────────────────
CREATE TABLE IF NOT EXISTS lry_summon_logs (
  id                    CHAR(36) NOT NULL DEFAULT (uuid()),
  summon_number         VARCHAR(255) NOT NULL,
  issued_date           DATE NOT NULL,
  issued_by             VARCHAR(255) DEFAULT '',          -- PDRM/JPJ/AES/MBPJ/DBKL/…
  plate                 VARCHAR(255) DEFAULT '',
  driver_name           VARCHAR(255) DEFAULT '',
  driver_id             VARCHAR(64) DEFAULT '',
  location              VARCHAR(255) DEFAULT '',
  offence_type          VARCHAR(255) DEFAULT '',
  offence_details       TEXT,
  fine_rm               DECIMAL(14,2),
  discount_rm           DECIMAL(14,2),
  discount_deadline     DATE,
  payment_deadline      DATE,
  status                VARCHAR(64) DEFAULT 'outstanding', -- outstanding/paid/partially-paid/disputed/court/cancelled/blacklisted
  paid_rm               DECIMAL(14,2),
  paid_date             DATE,
  payment_ref           VARCHAR(255) DEFAULT '',
  payment_proof_paths   JSON DEFAULT (JSON_ARRAY()),
  court_date            DATE,
  responsible_party     VARCHAR(64) DEFAULT 'company',    -- company/driver/shared
  notes                 TEXT,
  summon_copy_paths     JSON DEFAULT (JSON_ARRAY()),
  offence_no            VARCHAR(255) DEFAULT '',          -- XLSX-ADDED (legacy "offenceNo")
  offence_date          DATE,                             -- XLSX-ADDED (legacy "offenceDate")
  offence               VARCHAR(255) DEFAULT '',          -- XLSX-ADDED (legacy "offence")
  amount_rm             DECIMAL(14,2),                    -- XLSX-ADDED (legacy "amountRM")
  deadline              DATE,                             -- XLSX-ADDED (legacy "deadline")
  doc_url               VARCHAR(512) DEFAULT '',          -- XLSX-ADDED (legacy "docUrl", Drive URL)
  created_by            VARCHAR(255) DEFAULT '',
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by            VARCHAR(255) DEFAULT '',
  updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_lry_summon_plate (plate),
  INDEX idx_lry_summon_deadline (payment_deadline),
  INDEX idx_lry_summon_driver (driver_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- FLEET v2 tabs in 24-lorry.xlsx — no Supabase equivalent.
-- CREATEd from xlsx headers. -- XLSX-ADDED (whole tables)
-- (fleet-v2 "Vehicles" tab is merged into lry_vehicles above)
-- ============================================================

-- ─── 9 · INVOICES (⇐ xlsx "Invoices") — XLSX-ADDED ──────────
CREATE TABLE IF NOT EXISTS lry_invoices (
  id               VARCHAR(64) NOT NULL,
  category         VARCHAR(255) DEFAULT '',
  vendor           VARCHAR(255) DEFAULT '',
  invoice_no       VARCHAR(255) DEFAULT '',
  invoice_date     DATE,
  plate            VARCHAR(255) DEFAULT '',
  description      TEXT,
  subtotal_rm      DECIMAL(14,2),
  tax_rm           DECIMAL(14,2),
  total_rm         DECIMAL(14,2),
  mileage_km       DECIMAL(12,2),
  weight_tonnes    DECIMAL(12,2),
  coverage_period  VARCHAR(255) DEFAULT '',
  warranty         VARCHAR(255) DEFAULT '',
  drive_file_id    VARCHAR(512) DEFAULT '',
  drive_url        VARCHAR(512) DEFAULT '',
  status           VARCHAR(64) DEFAULT '',
  notes            TEXT,
  created_by       VARCHAR(255) DEFAULT '',
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by       VARCHAR(255) DEFAULT '',
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_lry_invoices_plate (plate),
  INDEX idx_lry_invoices_no (invoice_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 10 · INVOICE LINE ITEMS (⇐ xlsx "InvoiceLineItems") — XLSX-ADDED ─
CREATE TABLE IF NOT EXISTS lry_invoice_line_items (
  id             VARCHAR(64) NOT NULL,
  invoice_id     VARCHAR(64) DEFAULT '',
  line_no        INT,
  description    TEXT,
  qty            DECIMAL(12,2),
  unit_price_rm  DECIMAL(14,2),
  tax_rate_str   VARCHAR(64) DEFAULT '',
  amount_rm      DECIMAL(14,2),
  PRIMARY KEY (id),
  INDEX idx_lry_ili_invoice (invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 11 · CARTRACK TRIPS (⇐ xlsx "CartrackTrips") — XLSX-ADDED ─
CREATE TABLE IF NOT EXISTS lry_cartrack_trips (
  id              VARCHAR(64) NOT NULL,
  plate           VARCHAR(255) DEFAULT '',
  start_time      DATETIME,
  end_time        DATETIME,
  start_location  VARCHAR(255) DEFAULT '',
  end_location    VARCHAR(255) DEFAULT '',
  distance_km     DECIMAL(12,2),
  duration_hms    VARCHAR(64) DEFAULT '',
  speeding        DECIMAL(12,2),
  braking         DECIMAL(12,2),
  acceleration    DECIMAL(12,2),
  cornering       DECIMAL(12,2),
  idling          DECIMAL(12,2),
  source          VARCHAR(255) DEFAULT '',
  uploaded_by     VARCHAR(255) DEFAULT '',
  uploaded_at     DATETIME,
  PRIMARY KEY (id),
  INDEX idx_lry_cartrack_plate (plate, start_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 12 · SHELL SUBSIDY SUMMARY (⇐ xlsx "ShellSubsidySummary") — XLSX-ADDED ─
CREATE TABLE IF NOT EXISTS lry_shell_subsidy_summary (
  id             VARCHAR(64) NOT NULL,
  invoice_no     VARCHAR(255) DEFAULT '',
  invoice_date   DATE,
  account_no     VARCHAR(255) DEFAULT '',
  gross_fuel_rm  DECIMAL(14,2),
  subsidy_rm     DECIMAL(14,2),
  net_rm         DECIMAL(14,2),
  uploaded_by    VARCHAR(255) DEFAULT '',
  uploaded_at    DATETIME,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 13 · IMPORT LOG (⇐ xlsx "ImportLog") — XLSX-ADDED ──────
CREATE TABLE IF NOT EXISTS lry_import_log (
  id           VARCHAR(64) NOT NULL,
  file         VARCHAR(255) DEFAULT '',
  type         VARCHAR(64) DEFAULT '',
  `rows`       INT,                                      -- reserved word, backticked
  info         TEXT,
  imported_at  DATETIME,
  keyed_by     VARCHAR(255) DEFAULT '',
  notes        TEXT,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 15-fleet-command-center.xlsx — older secondary fleet sheet.
-- Imported as flt_* for merge into the lry_* master. -- XLSX-ADDED (whole tables)
-- ============================================================

-- ─── 14 · FLT VEHICLES (⇐ 15-fleet "Vehicles") — XLSX-ADDED ─
CREATE TABLE IF NOT EXISTS flt_vehicles (
  id          VARCHAR(64) NOT NULL,
  plate       VARCHAR(255) DEFAULT '',
  model       VARCHAR(255) DEFAULT '',
  type        VARCHAR(64) DEFAULT '',
  year        INT,
  notes       TEXT,
  keyed_by    VARCHAR(255) DEFAULT '',
  doc_link    VARCHAR(512) DEFAULT '',
  lorry_code  VARCHAR(64) DEFAULT '',
  PRIMARY KEY (id),
  INDEX idx_flt_vehicles_plate (plate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 15 · FLT DRIVERS (⇐ 15-fleet "Drivers") — XLSX-ADDED ───
CREATE TABLE IF NOT EXISTS flt_drivers (
  id                   VARCHAR(64) NOT NULL,
  name                 VARCHAR(255) DEFAULT '',
  ic                   VARCHAR(64) DEFAULT '',
  phone                VARCHAR(64) DEFAULT '',
  license_class        VARCHAR(64) DEFAULT '',
  license_expiry       DATE,
  gdl_expiry           DATE,
  assigned_vehicle     VARCHAR(255) DEFAULT '',
  notes                TEXT,
  keyed_by             VARCHAR(255) DEFAULT '',
  license_doc          VARCHAR(512) DEFAULT '',
  passport_photo       VARCHAR(512) DEFAULT '',
  ic_doc               VARCHAR(512) DEFAULT '',
  license_renewal_doc  VARCHAR(512) DEFAULT '',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 16 · FLT EXPIRIES (⇐ 15-fleet "Expiries") — XLSX-ADDED ─
CREATE TABLE IF NOT EXISTS flt_expiries (
  id        VARCHAR(64) NOT NULL,
  subject   VARCHAR(255) DEFAULT '',
  type      VARCHAR(64) DEFAULT '',
  due_date  DATE,
  notes     TEXT,
  keyed_by  VARCHAR(255) DEFAULT '',
  doc_link  VARCHAR(512) DEFAULT '',
  PRIMARY KEY (id),
  INDEX idx_flt_expiries_due (due_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 17 · FLT EXPENSES (⇐ 15-fleet "Expenses") — XLSX-ADDED ─
CREATE TABLE IF NOT EXISTS flt_expenses (
  id               VARCHAR(64) NOT NULL,
  date             DATE,
  vehicle          VARCHAR(255) DEFAULT '',
  category         VARCHAR(255) DEFAULT '',
  amount           DECIMAL(14,2),
  qty              DECIMAL(12,2),
  vendor           VARCHAR(255) DEFAULT '',
  ref              VARCHAR(255) DEFAULT '',
  notes            TEXT,
  source           VARCHAR(255) DEFAULT '',
  keyed_by         VARCHAR(255) DEFAULT '',
  doc_link         VARCHAR(512) DEFAULT '',
  before_pics      TEXT,                                 -- multi Drive links
  after_pics       TEXT,                                 -- multi Drive links
  delivery_order   VARCHAR(512) DEFAULT '',
  tipping_receipt  VARCHAR(512) DEFAULT '',
  payment_receipt  VARCHAR(512) DEFAULT '',
  tipping_ticket   VARCHAR(512) DEFAULT '',
  other_docs       TEXT,                                 -- multi Drive links
  PRIMARY KEY (id),
  INDEX idx_flt_expenses_vehicle_date (vehicle, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 18 · FLT TRIPS (⇐ 15-fleet "Trips") — XLSX-ADDED ───────
CREATE TABLE IF NOT EXISTS flt_trips (
  id         VARCHAR(64) NOT NULL,
  period     VARCHAR(64) DEFAULT '',
  vehicle    VARCHAR(255) DEFAULT '',
  km         DECIMAL(12,2),
  trips      INT,
  speeding   DECIMAL(12,2),
  braking    DECIMAL(12,2),
  accel      DECIMAL(12,2),
  cornering  DECIMAL(12,2),
  idling     DECIMAL(12,2),
  source     VARCHAR(255) DEFAULT '',
  keyed_by   VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id),
  INDEX idx_flt_trips_vehicle (vehicle)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 19 · FLT IMPORT LOG (⇐ 15-fleet "ImportLog") — XLSX-ADDED ─
CREATE TABLE IF NOT EXISTS flt_import_log (
  id           VARCHAR(64) NOT NULL,
  file         VARCHAR(255) DEFAULT '',
  type         VARCHAR(64) DEFAULT '',
  `rows`       INT,                                      -- reserved word, backticked
  info         TEXT,
  imported_at  DATETIME,
  keyed_by     VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 20 · ALARMS VIEW — consumed by the daily-alarms job ─────
-- Columns: alarm_type, ref, detail, due_date, recipient
-- (references app_settings from the foundation module)
CREATE OR REPLACE VIEW lry_alarms AS
-- Compliance (road tax / insurance / puspakom) expiring within 30 days or expired
SELECT
  CONCAT('lorry-compliance-', c.type)                                   AS alarm_type,
  c.plate                                                               AS ref,
  CONCAT(
    CASE c.type WHEN 'roadtax' THEN 'Road Tax' WHEN 'insurance' THEN 'Insurance' ELSE 'Puspakom' END,
    ' expires ', DATE_FORMAT(c.expiry_date, '%d %b %Y'),
    CASE WHEN c.expiry_date < CURDATE() THEN ' (EXPIRED)' ELSE '' END
  )                                                                     AS detail,
  c.expiry_date                                                         AS due_date,
  COALESCE((SELECT value FROM app_settings WHERE `key` = 'COMPANY_EMAIL'), '') AS recipient
FROM lry_compliance_logs c
WHERE LOWER(COALESCE(c.status, 'active')) IN ('', 'active')
  AND c.expiry_date IS NOT NULL
  AND c.expiry_date <= CURDATE() + INTERVAL 30 DAY
UNION ALL
-- Proposed service date within 30 days
SELECT
  'lorry-service-due',
  m.plate,
  CONCAT('Proposed service date ', DATE_FORMAT(m.next_service_date, '%d %b %Y'),
         ' (', COALESCE(m.workshop, ''), ')'),
  m.next_service_date,
  COALESCE((SELECT value FROM app_settings WHERE `key` = 'COMPANY_EMAIL'), '')
FROM lry_maint_logs m
WHERE m.next_service_date IS NOT NULL
  AND m.next_service_date <= CURDATE() + INTERVAL 30 DAY
UNION ALL
-- Driver licence / GDL expiring within 30 days (active drivers)
SELECT
  'lorry-driver-licence',
  d.name,
  CONCAT('Licence',
         CASE WHEN COALESCE(d.license_class, '') <> '' THEN CONCAT(' (', d.license_class, ')') ELSE '' END,
         ' expires ', DATE_FORMAT(d.license_expiry_date, '%d %b %Y')),
  d.license_expiry_date,
  COALESCE((SELECT value FROM app_settings WHERE `key` = 'COMPANY_EMAIL'), '')
FROM lry_drivers d
WHERE d.status IN ('active', 'on-leave')
  AND d.license_expiry_date IS NOT NULL
  AND d.license_expiry_date <= CURDATE() + INTERVAL 30 DAY
UNION ALL
SELECT
  'lorry-driver-gdl',
  d.name,
  CONCAT('GDL expires ', DATE_FORMAT(d.gdl_expiry_date, '%d %b %Y')),
  d.gdl_expiry_date,
  COALESCE((SELECT value FROM app_settings WHERE `key` = 'COMPANY_EMAIL'), '')
FROM lry_drivers d
WHERE d.status IN ('active', 'on-leave')
  AND d.gdl_expiry_date IS NOT NULL
  AND d.gdl_expiry_date <= CURDATE() + INTERVAL 30 DAY
UNION ALL
-- Outstanding summonses with payment deadline within 14 days or overdue
SELECT
  'lorry-summon-deadline',
  CONCAT(s.plate, ' · ', s.summon_number),
  CONCAT('Summon RM ', ROUND(COALESCE(s.fine_rm, 0) - COALESCE(s.paid_rm, 0), 2),
         ' pay by ', DATE_FORMAT(s.payment_deadline, '%d %b %Y'),
         CASE WHEN s.payment_deadline < CURDATE() THEN ' (OVERDUE)' ELSE '' END),
  s.payment_deadline,
  COALESCE((SELECT value FROM app_settings WHERE `key` = 'COMPANY_EMAIL'), '')
FROM lry_summon_logs s
WHERE s.status IN ('outstanding', 'partially-paid')
  AND s.payment_deadline IS NOT NULL
  AND s.payment_deadline <= CURDATE() + INTERVAL 14 DAY;

-- ============================================================
-- Phase 2 checklist
-- ============================================================
-- RPC-PORT: lry_save_maint(payload jsonb) — server-side recompute of maintenance totals (normalise line items, per-line tax vs legacy 6% invoice-level tax, discount, derived items_replaced text, preserve bulk-pay metadata on update, audit log)
-- RPC-PORT: lry_bulk_mark_paid(payload jsonb) — one payment slip clears N bills across compliance/maint/summon (merge slip paths de-duplicated, settle maint outstanding, summon discount-deadline pricing, audit log)
-- BUCKET: lorry-files
