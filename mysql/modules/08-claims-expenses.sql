-- ============================================================
-- HG hub — claims + expenses (MySQL 8) — translated from
-- supabase/schema-claims.sql + supabase/schema-expenses.sql
-- Reconciled against 19-claims.xlsx + 04-expenses.xlsx (2026-07-16)
-- ============================================================
SET NAMES utf8mb4;

-- ─── CLAIMS (clm_) ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clm_claims (
  id                  CHAR(36) NOT NULL DEFAULT (uuid()),
  claim_no            VARCHAR(64) NOT NULL,                  -- CLM-YYYY-###
  submitted_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  submitted_by        VARCHAR(255) DEFAULT '',
  receipt_date        DATE NOT NULL DEFAULT (CURRENT_DATE),
  vendor              VARCHAR(255) NOT NULL DEFAULT 'Unknown vendor',
  currency            VARCHAR(255) NOT NULL DEFAULT 'RM',
  subtotal            DECIMAL(14,2) NOT NULL DEFAULT 0,
  service_charge      DECIMAL(14,2) NOT NULL DEFAULT 0,      -- restaurant SC (RM)
  subsidy_amount      DECIMAL(14,2) NOT NULL DEFAULT 0,      -- Budi95 / fuel subsidy deducted
  sst_amount          DECIMAL(14,2) NOT NULL DEFAULT 0,
  rounding_adjustment DECIMAL(14,2) NOT NULL DEFAULT 0,      -- signed 5-sen cash rounding
  total               DECIMAL(14,2) NOT NULL DEFAULT 0,      -- net claimable
  primary_category    VARCHAR(255) NOT NULL DEFAULT 'other',
  status              VARCHAR(255) NOT NULL DEFAULT 'submitted',
  receipt_paths       JSON NOT NULL DEFAULT (JSON_ARRAY()),  -- storage paths in 'claim-receipts'
  remarks             TEXT,
  created_by          VARCHAR(255) DEFAULT '',
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  pdf_url             VARCHAR(512),                          -- XLSX-ADDED
  folder_url          VARCHAR(512),                          -- XLSX-ADDED
  receipt_urls        TEXT,                                  -- XLSX-ADDED (Drive URLs, files not migrating yet)
  PRIMARY KEY (id),
  UNIQUE KEY uq_clm_claims_no (claim_no),
  INDEX idx_clm_claims_by (submitted_by),
  INDEX idx_clm_claims_no (claim_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clm_claim_lines (
  id          CHAR(36) NOT NULL DEFAULT (uuid()),
  claim_id    CHAR(36) NOT NULL,                             -- was FK -> clm_claims(id)
  description TEXT,
  quantity    DECIMAL(12,2) NOT NULL DEFAULT 0,
  unit_price  DECIMAL(14,2) NOT NULL DEFAULT 0,
  line_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  category    VARCHAR(255) NOT NULL DEFAULT 'other',
  remarks     TEXT,
  sort        INT DEFAULT 1,
  PRIMARY KEY (id),
  INDEX idx_clm_lines_claim (claim_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clm_summaries (
  id           CHAR(36) NOT NULL DEFAULT (uuid()),
  summary_no   VARCHAR(64) NOT NULL,                         -- SUM-YYYY-###
  generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  generated_by VARCHAR(255) DEFAULT '',
  claim_nos    TEXT NOT NULL,                                -- 'CLM-2026-001 | CLM-2026-002'
  claim_count  INT NOT NULL DEFAULT 0,
  currency     VARCHAR(255) NOT NULL DEFAULT 'RM',
  grand_total  DECIMAL(14,2) NOT NULL DEFAULT 0,
  period_from  DATE,
  period_to    DATE,
  title        VARCHAR(255) DEFAULT '',
  remarks      TEXT,
  created_by   VARCHAR(255) DEFAULT '',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  pdf_url      VARCHAR(512),                                 -- XLSX-ADDED
  PRIMARY KEY (id),
  UNIQUE KEY uq_clm_summaries_no (summary_no),
  INDEX idx_clm_summaries_by (generated_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SST rate setting (reuses foundation app_settings; seed if missing)
INSERT IGNORE INTO app_settings (`key`, value) VALUES ('SST_PERCENT', '6');

-- ─── EXPENSES (exp_) ────────────────────────────────────────

-- Categories (was Script Properties CATEGORIES_JSON — not in the xlsx; keep)
CREATE TABLE IF NOT EXISTS exp_categories (
  name VARCHAR(64) NOT NULL,
  sort INT DEFAULT 0,
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed = the GAS CATEGORIES list. 'other' is the locked fallback (sort last).
INSERT IGNORE INTO exp_categories (name, sort) VALUES
  ('food', 1), ('grocery', 2), ('fuel', 3), ('transport', 4),
  ('accommodation', 5), ('parking', 6), ('toll', 7), ('materials', 8),
  ('tools', 9), ('office', 10), ('utilities', 11), ('phone', 12),
  ('other', 999);

CREATE TABLE IF NOT EXISTS exp_expenses (
  id           CHAR(36) NOT NULL DEFAULT (uuid()),
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by   VARCHAR(255) DEFAULT '',                      -- was submittedBy (owner email)
  receipt_date DATE NOT NULL DEFAULT (CURRENT_DATE),
  month_key    VARCHAR(64) DEFAULT '',                       -- yyyy-MM, derived from receipt_date (API port of trigger)
  vendor       VARCHAR(255) DEFAULT '',
  description  TEXT,
  category     VARCHAR(255) DEFAULT 'other',
  currency     VARCHAR(255) DEFAULT 'RM',
  amount       DECIMAL(14,2) DEFAULT 0,
  type         VARCHAR(255) DEFAULT 'business',              -- business / personal
  status       VARCHAR(255) DEFAULT 'recorded',
  image_path   VARCHAR(512) DEFAULT '',                      -- storage path in expense-receipts bucket
  remarks      TEXT,
  image_url    VARCHAR(512),                                 -- XLSX-ADDED (Drive URL, files not migrating yet)
  PRIMARY KEY (id),
  INDEX idx_exp_expenses_owner (created_by),
  INDEX idx_exp_expenses_month (month_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Phase 2 checklist ──────────────────────────────────────
-- RPC-PORT: clm_submit_claim(payload jsonb) — server-side recompute of lines (qty x unit), SST/service-charge/subsidy/rounding totals, primary category, atomic CLM-YYYY-### numbering, inserts claim + lines, audit log
-- RPC-PORT: clm_generate_summary(payload jsonb) — bundles selected claims (owner-scoped, admin sees all) into an atomic SUM-YYYY-### summary with count, grand total, dominant currency, period range, audit log
-- RPC-PORT: exp_set_month_key() [trigger on exp_expenses] — keeps month_key = DATE_FORMAT(receipt_date, '%Y-%m') on insert/update
-- RPC-PORT: exp_add_category(p_name text) — admin-only: validate (lowercase, <=24 chars, [a-z0-9 &/-]), reject duplicates, insert with next sort, audit log
-- RPC-PORT: exp_rename_category(p_old text, p_new text) — admin-only: rename category ('other' locked) and re-tag matching exp_expenses rows; returns rows moved; audit log
-- RPC-PORT: exp_delete_category(p_name text) — admin-only: delete category ('other' locked) and re-tag affected exp_expenses rows to 'other'; returns rows moved; audit log

-- BUCKET: claim-receipts
-- BUCKET: expense-receipts
