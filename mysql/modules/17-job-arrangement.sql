-- ============================================================
-- HG hub — Daily Job Arrangement (MySQL 8) — prefix ja_
-- NEW tables — this tool never had a Supabase schema.
-- Designed from production 13-job-arrangement.xlsx headers
-- (AUTHORITATIVE, exported 2026-07-16) + AI-HANDOFF.md §6 (#13)
-- + source-code/13-dispatch/apps-script.gs column semantics.
-- Original string IDs preserved as natural keys (VARCHAR(64)).
-- No FOREIGN KEYs by convention — plain INDEX on every *_id column.
-- JSON columns hold JSON-string cells from the sheet
-- (supervisorIds / workerIds / lorryIds / workerTimes / lineItems
--  are JSON.stringify'd by the Apps Script backend) — the import
-- script must pass valid JSON or NULL, never ''.
-- SKIPPED TAB: "Monthly Summary" (222 rows) — computed pivot,
-- rebuilt by the app from ja_jobs; do not import.
-- ============================================================
SET NAMES utf8mb4;

-- ════════════════════════════════════════════════════════════
-- Jobs (TXN — 1,680 rows, 61 columns in production xlsx)
-- Schedule + charges + invoice + wage/incentive/allowance payment
-- status + CIDB submission, all on one row per job/shift.
-- (Handoff says "58 cols"; the authoritative xlsx export has 61.)
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ja_jobs (
  id                   VARCHAR(64) NOT NULL,           -- xlsx: id
  title                VARCHAR(255) DEFAULT '',
  client               VARCHAR(255) DEFAULT '',
  mall                 VARCHAR(255) DEFAULT '',
  lot                  VARCHAR(255) DEFAULT '',
  shift                VARCHAR(32) DEFAULT '',         -- day / night
  scope                VARCHAR(255) DEFAULT '',        -- from ScopeFactory / ScopeOnsite lists
  `date`               DATE DEFAULT NULL,              -- job date
  `time`               VARCHAR(64) DEFAULT '',         -- free text in sheet (e.g. "21:00" / ranges)
  notes                TEXT,
  supervisor_ids       JSON DEFAULT NULL,              -- xlsx: supervisorIds — JSON array of ja_supervisors.id
  worker_ids           JSON DEFAULT NULL,              -- xlsx: workerIds — JSON array of ja_workers.id
  lorry_ids            JSON DEFAULT NULL,              -- xlsx: lorryIds — JSON array of ja_lorries.id
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,  -- xlsx: createdAt
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, -- xlsx: updatedAt
  supervisor_names     VARCHAR(512) DEFAULT '',        -- xlsx: supervisorNames — denormalized, comma-joined
  worker_names         TEXT,                           -- xlsx: workerNames — denormalized, comma-joined
  lorry_details        VARCHAR(512) DEFAULT '',        -- xlsx: lorryDetails — "id - plate", comma-joined
  state                VARCHAR(64) DEFAULT '',         -- Malaysian state, keys into ja_states.state
  incentive_status     VARCHAR(32) DEFAULT '',         -- xlsx: incentiveStatus
  incentive_paid_date  DATE DEFAULT NULL,              -- xlsx: incentivePaidDate
  incentive_notes      TEXT,                           -- xlsx: incentiveNotes
  wage_status          VARCHAR(32) DEFAULT '',         -- xlsx: wageStatus
  wage_paid_date       DATE DEFAULT NULL,              -- xlsx: wagePaidDate
  wage_notes           TEXT,                           -- xlsx: wageNotes
  allow_status         VARCHAR(32) DEFAULT '',         -- xlsx: allowStatus (allowance)
  allow_paid_date      DATE DEFAULT NULL,              -- xlsx: allowPaidDate
  allow_notes          TEXT,                           -- xlsx: allowNotes
  remarks              TEXT,
  po                   VARCHAR(64) DEFAULT '',
  invoice_no           VARCHAR(64) DEFAULT '',         -- xlsx: invoiceNo — upsert key for PDF invoice import
  invoice_date         DATE DEFAULT NULL,              -- xlsx: invoiceDate
  invoice_amount       DECIMAL(14,2) DEFAULT NULL,     -- xlsx: invoiceAmount
  invoice_status       VARCHAR(32) DEFAULT '',         -- xlsx: invoiceStatus
  invoice_notes        TEXT,                           -- xlsx: invoiceNotes
  charge_hoarding      DECIMAL(14,2) DEFAULT NULL,     -- xlsx: chargeHoarding
  charge_visual        DECIMAL(14,2) DEFAULT NULL,     -- xlsx: chargeVisual
  charge_dismantling   DECIMAL(14,2) DEFAULT NULL,     -- xlsx: chargeDismantling
  discount             DECIMAL(14,2) DEFAULT NULL,
  has_tax              TINYINT(1) DEFAULT 0,           -- xlsx: hasTax
  hoarding_size        VARCHAR(255) DEFAULT '',        -- xlsx: hoardingSize — free text
  worker_times         JSON DEFAULT NULL,              -- xlsx: workerTimes — JSON object {workerId: time-info}
  charge_preliminaries DECIMAL(14,2) DEFAULT NULL,     -- xlsx: chargePreliminaries
  charge_insurance     DECIMAL(14,2) DEFAULT NULL,     -- xlsx: chargeInsurance
  charge_outstation    DECIMAL(14,2) DEFAULT NULL,     -- xlsx: chargeOutstation
  charge_scaffold      DECIMAL(14,2) DEFAULT NULL,     -- xlsx: chargeScaffold
  charge_door          DECIMAL(14,2) DEFAULT NULL,     -- xlsx: chargeDoor
  charge_counterweight DECIMAL(14,2) DEFAULT NULL,     -- xlsx: chargeCounterweight
  charge_fabric        DECIMAL(14,2) DEFAULT NULL,     -- xlsx: chargeFabric
  charge_peeping_hole  DECIMAL(14,2) DEFAULT NULL,     -- xlsx: chargePeepingHole
  charge_others        DECIMAL(14,2) DEFAULT NULL,     -- xlsx: chargeOthers
  charge_skirting      DECIMAL(14,2) DEFAULT NULL,     -- xlsx: chargeSkirting
  cidb_status          VARCHAR(32) DEFAULT '',         -- xlsx: cidbStatus
  cidb_submitted_date  DATE DEFAULT NULL,              -- xlsx: cidbSubmittedDate
  cidb_reference       VARCHAR(255) DEFAULT '',        -- xlsx: cidbReference
  cidb_submitted_by    VARCHAR(255) DEFAULT '',        -- xlsx: cidbSubmittedBy
  quotation_no         VARCHAR(64) DEFAULT '',         -- xlsx: quotationNo
  project_remarks      TEXT,                           -- xlsx: projectRemarks
  client_address       TEXT,                           -- xlsx: clientAddress
  client_reg_no        VARCHAR(64) DEFAULT '',         -- xlsx: clientRegNo (SSM company reg no)
  line_items           JSON DEFAULT NULL,              -- xlsx: lineItems — JSON array of invoice line items
  PRIMARY KEY (id),
  INDEX idx_ja_jobs_date (`date`),
  INDEX idx_ja_jobs_client (client),
  INDEX idx_ja_jobs_mall_lot (mall, lot),
  INDEX idx_ja_jobs_invoice_no (invoice_no),
  INDEX idx_ja_jobs_state (state),
  INDEX idx_ja_jobs_wage_status (wage_status),
  INDEX idx_ja_jobs_invoice_status (invoice_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ════════════════════════════════════════════════════════════
-- Workers (MASTER — 55 rows)
-- SENSITIVE: bank columns admin-only at API layer
-- (bank_name / account_name / account_no must never reach
--  non-admin responses — enforce in the Express API.)
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ja_workers (
  id          VARCHAR(64) NOT NULL,                    -- xlsx: id (e.g. wk02)
  name        VARCHAR(255) DEFAULT '',
  rate        DECIMAL(14,2) DEFAULT NULL,              -- per-shift/day wage rate
  team        VARCHAR(64) DEFAULT '',
  monthly_pay DECIMAL(14,2) DEFAULT NULL,              -- xlsx: monthlyPay
  bank_name    VARCHAR(255) DEFAULT '',                -- SENSITIVE
  account_name VARCHAR(255) DEFAULT '',                -- SENSITIVE
  account_no   VARCHAR(64) DEFAULT '',                 -- SENSITIVE
  PRIMARY KEY (id),
  INDEX idx_ja_workers_team (team)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Supervisors (MASTER — 13 rows) ─────────────────────────
CREATE TABLE IF NOT EXISTS ja_supervisors (
  id   VARCHAR(64) NOT NULL,                           -- xlsx: id
  name VARCHAR(255) DEFAULT '',
  type VARCHAR(64) DEFAULT '',                         -- inhouse / outsource
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Lorries (MASTER — 18 rows) ──────────────────────────────
CREATE TABLE IF NOT EXISTS ja_lorries (
  id    VARCHAR(64) NOT NULL,                          -- xlsx: id (lorry code)
  plate VARCHAR(32) DEFAULT '',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ════════════════════════════════════════════════════════════
-- Lookups (MASTER) — ONE table for the four single-column tabs:
--   Malls (198) · Clients (122) · ScopeFactory (16) · ScopeOnsite (18)
-- Each tab is literally one `value` column read by the same
-- readListSimple() helper, so a typed key/value table maps
-- cleanest. type ∈ ('mall','client','scope_factory','scope_onsite').
-- Plain index (not UNIQUE) — production lists may contain dupes.
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ja_lookups (
  id    BIGINT AUTO_INCREMENT,
  type  VARCHAR(32) NOT NULL,                          -- source tab, snake_cased
  value VARCHAR(255) NOT NULL,                         -- xlsx: value
  PRIMARY KEY (id),
  INDEX idx_ja_lookups_type_value (type, value)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── States (MASTER — 11 rows, per-state wage multipliers) ───
CREATE TABLE IF NOT EXISTS ja_states (
  state          VARCHAR(64) NOT NULL,                 -- natural key (Malaysian state name)
  wk_mult        DECIMAL(8,4) DEFAULT NULL,            -- xlsx: wkMult — worker wage multiplier
  wk_allow       DECIMAL(14,2) DEFAULT NULL,           -- xlsx: wkAllow — worker allowance (RM)
  inhouse_inc    DECIMAL(14,2) DEFAULT NULL,           -- xlsx: inhouseInc — in-house supervisor incentive (RM)
  outsource_rate DECIMAL(14,2) DEFAULT NULL,           -- xlsx: outsourceRate — outsource supervisor rate (RM)
  PRIMARY KEY (state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── MallStates (MASTER — 201 rows, mall → state mapping) ────
-- Surrogate id: mall names are not guaranteed unique in production.
CREATE TABLE IF NOT EXISTS ja_mall_states (
  id    BIGINT AUTO_INCREMENT,
  mall  VARCHAR(255) NOT NULL,
  state VARCHAR(64) DEFAULT '',
  PRIMARY KEY (id),
  INDEX idx_ja_mall_states_mall (mall)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ════════════════════════════════════════════════════════════
-- AttendanceLog (TXN — 3,344 rows)
-- Face-recognition clock-in/out — priority source for factory shifts.
-- Deterministic id: at_<workerId>_<date>_<category> (upsert key).
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ja_attendance_log (
  id           VARCHAR(128) NOT NULL,                  -- xlsx: id (composite string, can exceed 64)
  worker_id    VARCHAR(64) DEFAULT '',                 -- xlsx: workerId
  worker_name  VARCHAR(255) DEFAULT '',                -- xlsx: workerName
  `date`       DATE DEFAULT NULL,
  category     VARCHAR(32) DEFAULT 'day',              -- day / night ('day' for legacy rows)
  clock_in     VARCHAR(16) DEFAULT '',                 -- xlsx: clockIn — "HH:mm" string
  clock_out    VARCHAR(16) DEFAULT '',                 -- xlsx: clockOut — "HH:mm" string
  next_day_out TINYINT(1) DEFAULT 0,                   -- xlsx: nextDayOut
  raw_events   JSON DEFAULT NULL,                      -- xlsx: rawEvents — machine event dump
  source       VARCHAR(32) DEFAULT 'manual',           -- manual / import / face
  notes        TEXT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,     -- xlsx: createdAt
  created_by   VARCHAR(255) DEFAULT '',                -- xlsx: createdBy
  PRIMARY KEY (id),
  INDEX idx_ja_attendance_worker (worker_id),
  INDEX idx_ja_attendance_date (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ════════════════════════════════════════════════════════════
-- VehicleLog (TXN — 530 rows) — Cartrack depart/return timings
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ja_vehicle_log (
  id              VARCHAR(64) NOT NULL,                -- xlsx: id
  `date`          DATE DEFAULT NULL,
  lorry_id        VARCHAR(64) DEFAULT '',              -- xlsx: lorryId
  shift           VARCHAR(32) DEFAULT '',
  depart_hg       VARCHAR(16) DEFAULT '',              -- xlsx: departHG — "HH:mm" string
  return_hg       VARCHAR(16) DEFAULT '',              -- xlsx: returnHG — "HH:mm" string
  next_day_return TINYINT(1) DEFAULT 0,                -- xlsx: nextDayReturn
  notes           TEXT,
  trip_details    TEXT,                                -- xlsx: tripDetails — Cartrack trip text (format
                                                       -- unverified in source; kept TEXT so import never
                                                       -- fails; parse to JSON in Phase 2 if structured)
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,  -- xlsx: createdAt
  created_by      VARCHAR(255) DEFAULT '',             -- xlsx: createdBy
  PRIMARY KEY (id),
  INDEX idx_ja_vehicle_log_lorry (lorry_id),
  INDEX idx_ja_vehicle_log_date (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ════════════════════════════════════════════════════════════
-- WageAdjustments (TXN — tab absent from the 2026-07-16 xlsx
-- export, but live in apps-script.gs WAGE_ADJUSTMENT_HEADERS;
-- created on first save. Columns from the Apps Script.)
-- Deterministic id: wa_<workerId>_<date>_<category>.
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ja_wage_adjustments (
  id              VARCHAR(128) NOT NULL,               -- gs: id (composite string)
  worker_id       VARCHAR(64) DEFAULT '',              -- gs: workerId
  worker_name     VARCHAR(255) DEFAULT '',             -- gs: workerName
  `date`          DATE DEFAULT NULL,
  category        VARCHAR(32) DEFAULT 'day',
  original_amount DECIMAL(14,2) DEFAULT 0,             -- gs: originalAmount
  adjusted_amount DECIMAL(14,2) DEFAULT 0,             -- gs: adjustedAmount
  delta           DECIMAL(14,2) DEFAULT 0,             -- adjusted - original
  reason          TEXT,
  adjusted_by     VARCHAR(255) DEFAULT '',             -- gs: adjustedBy
  adjusted_at     DATETIME DEFAULT NULL,               -- gs: adjustedAt
  PRIMARY KEY (id),
  INDEX idx_ja_wage_adj_worker (worker_id),
  INDEX idx_ja_wage_adj_date (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ════════════════════════════════════════════════════════════
-- Disputes (TXN — 113 rows) — worker wage-claim form + admin review
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ja_disputes (
  id               VARCHAR(64) NOT NULL,               -- xlsx: id (dsp_<ts>_<rand>)
  submitted_at     DATETIME DEFAULT NULL,              -- xlsx: submittedAt
  worker_id        VARCHAR(64) DEFAULT '',             -- xlsx: workerId
  worker_name      VARCHAR(255) DEFAULT '',            -- xlsx: workerName
  `date`           DATE DEFAULT NULL,                  -- disputed shift date
  claimed_in       VARCHAR(16) DEFAULT '',             -- xlsx: claimedIn — "HH:mm" string
  claimed_out      VARCHAR(16) DEFAULT '',             -- xlsx: claimedOut — "HH:mm" string
  claimed_next_day TINYINT(1) DEFAULT 0,               -- xlsx: claimedNextDay
  claimed_amount   DECIMAL(14,2) DEFAULT NULL,         -- xlsx: claimedAmount
  worker_note      TEXT,                               -- xlsx: workerNote
  status           VARCHAR(32) DEFAULT 'Pending',
  reviewer_note    TEXT,                               -- xlsx: reviewerNote
  reviewed_by      VARCHAR(255) DEFAULT '',            -- xlsx: reviewedBy
  reviewed_at      DATETIME DEFAULT NULL,              -- xlsx: reviewedAt
  photos           JSON DEFAULT NULL,                  -- xlsx: photos — array of Drive photo objects
                                                       -- ({id, viewUrl, thumbUrl}); files stay in Drive
  PRIMARY KEY (id),
  INDEX idx_ja_disputes_worker (worker_id),
  INDEX idx_ja_disputes_date (`date`),
  INDEX idx_ja_disputes_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ════════════════════════════════════════════════════════════
-- ShiftConflictReviews (TXN — 4 rows)
-- Admin decisions on flagged worker double-bookings.
-- Deterministic id: cr_<workerId>_<date>_<category>.
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ja_shift_conflict_reviews (
  id            VARCHAR(128) NOT NULL,                 -- xlsx: id (composite string)
  worker_id     VARCHAR(64) DEFAULT '',                -- xlsx: workerId
  worker_name   VARCHAR(255) DEFAULT '',               -- xlsx: workerName
  `date`        DATE DEFAULT NULL,
  category      VARCHAR(32) DEFAULT '',
  shift_ids     JSON DEFAULT NULL,                     -- xlsx: shiftIds — array of conflicting ja_jobs.id
  status        VARCHAR(32) DEFAULT 'Pending',
  reviewer_note TEXT,                                  -- xlsx: reviewerNote
  reviewed_by   VARCHAR(255) DEFAULT '',               -- xlsx: reviewedBy
  reviewed_at   DATETIME DEFAULT NULL,                 -- xlsx: reviewedAt
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,    -- xlsx: createdAt
  PRIMARY KEY (id),
  INDEX idx_ja_conflicts_worker (worker_id),
  INDEX idx_ja_conflicts_date (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ════════════════════════════════════════════════════════════
-- AuditLog (LOG — 4,851 rows, append-only, 4-col variant)
-- xlsx headers: timestamp | actor | action | detail
-- → normalized to the hub's 4-col audit shape ts / user_email /
--   action / details (actor is the acting user's email/name).
-- No natural key in the sheet → surrogate auto-id.
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ja_audit_log (
  id         BIGINT AUTO_INCREMENT,
  ts         DATETIME DEFAULT CURRENT_TIMESTAMP,       -- xlsx: timestamp
  user_email VARCHAR(255) DEFAULT '',                  -- xlsx: actor
  action     VARCHAR(255) DEFAULT '',                  -- xlsx: action
  details    TEXT,                                     -- xlsx: detail
  PRIMARY KEY (id),
  INDEX idx_ja_audit_ts (ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- SKIPPED: "Monthly Summary" tab (computed pivot — rebuilt from
--          ja_jobs by the app; per AI-HANDOFF §9 do not import).
-- RPC-PORT: n/a — no Supabase functions (tool was Apps Script only).
--           Wage math (state multipliers/allowances via ja_states,
--           adjustments via ja_wage_adjustments) and the Monthly
--           Summary pivot move to the Express API in Phase 2.
-- BUCKET:   n/a — dispute photos live in Google Drive folder
--           "BlackLee Dispute Photos" (Drive IDs kept in
--           ja_disputes.photos; files not migrating yet).
-- ============================================================
