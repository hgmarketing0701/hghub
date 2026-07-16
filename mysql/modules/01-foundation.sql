-- ============================================================
-- HG hub — foundation + assistant + blog (MySQL 8)
-- Translated from supabase/schema.sql, schema-assistant.sql, schema-blog.sql
-- Reconciled against 02-smart-quotation.xlsx + 22-blog-linkedin.xlsx (2026-07-16)
-- ============================================================
SET NAMES utf8mb4;

-- ─── USERS (replaces allowed_users — cPanel has no Google auth) ─────────────
CREATE TABLE IF NOT EXISTS users (
  id            CHAR(36) NOT NULL DEFAULT (uuid()),
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(255),
  role          ENUM('admin','staff') NOT NULL DEFAULT 'staff',
  active        TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── CLIENTS (BLUE layer — shared backbone) ─────────────────────────────────
-- superset definition: includes the project-pl extension columns so module 07's
-- CREATE IF NOT EXISTS can safely no-op (this file runs first)
CREATE TABLE IF NOT EXISTS clients (
  id             CHAR(36) NOT NULL DEFAULT (uuid()),
  name           VARCHAR(255) NOT NULL,
  type           VARCHAR(64) DEFAULT 'Contractor',  -- Mall / Contractor / Tenant
  phone          VARCHAR(255) DEFAULT '',
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

-- ─── MASTERS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS malls (
  id       CHAR(36) NOT NULL DEFAULT (uuid()),
  name     VARCHAR(255) NOT NULL,
  code     VARCHAR(64) DEFAULT '',
  location VARCHAR(255) DEFAULT '',
  notes    TEXT,
  PRIMARY KEY (id),
  INDEX idx_malls_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS services (
  id       CHAR(36) NOT NULL DEFAULT (uuid()),
  name     VARCHAR(255) NOT NULL,
  is_extra TINYINT(1) DEFAULT 0,   -- Fit-Out / Scaffold style "extra work"
  sort     INT DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_services_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── PRICE BOOK ─────────────────────────────────────────────────────────────
-- mall = '(All Malls)' rows apply everywhere; a mall-specific row overrides.
CREATE TABLE IF NOT EXISTS price_book (
  id               CHAR(36) NOT NULL DEFAULT (uuid()),
  mall             VARCHAR(255) NOT NULL DEFAULT '(All Malls)',
  service          VARCHAR(255) NOT NULL,
  sub_scope        VARCHAR(255) NOT NULL,
  item             VARCHAR(255) NOT NULL,
  unit             VARCHAR(64) NOT NULL DEFAULT 'nos',  -- sqft/ft/m/nos/lot/day/month/trip/item
  compulsory       TINYINT(1) DEFAULT 1,
  min_qty          DECIMAL(12,2) DEFAULT 0,
  min_charge       DECIMAL(14,2) DEFAULT 0,
  price_mall       DECIMAL(14,2) DEFAULT 0,
  price_contractor DECIMAL(14,2) DEFAULT 0,
  price_tenant     DECIMAL(14,2) DEFAULT 0,
  sort             INT DEFAULT 1,
  notes            TEXT,
  updated_by       VARCHAR(255) DEFAULT '',
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  calc_type        VARCHAR(255) DEFAULT '',        -- XLSX-ADDED
  calc_param       VARCHAR(255) DEFAULT '',        -- XLSX-ADDED
  link_key         VARCHAR(255) DEFAULT '',        -- XLSX-ADDED
  cond             VARCHAR(255) DEFAULT '',        -- XLSX-ADDED
  def_qty          DECIMAL(12,2) DEFAULT 0,        -- XLSX-ADDED
  PRIMARY KEY (id),
  INDEX idx_pricebook_mall (mall),
  INDEX idx_pricebook_key (service, sub_scope, item)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── SETTINGS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  `key` VARCHAR(191) NOT NULL,
  value TEXT,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── QUOTES ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotes (
  id          CHAR(36) NOT NULL DEFAULT (uuid()),
  quote_no    VARCHAR(64) NOT NULL,
  quote_date  DATE NULL,  -- production has blank dates
  mall        VARCHAR(255) NOT NULL,
  client_id   CHAR(36),
  client_name VARCHAR(255) NOT NULL,
  client_type VARCHAR(64) NOT NULL DEFAULT 'Mall',   -- Mall / Contractor / Tenant
  attention   VARCHAR(255) DEFAULT '',
  project     VARCHAR(255) DEFAULT '',
  subtotal    DECIMAL(14,2) NOT NULL DEFAULT 0,
  sst_pct     DECIMAL(14,2) NOT NULL DEFAULT 0,
  sst         DECIMAL(14,2) NOT NULL DEFAULT 0,
  total       DECIMAL(14,2) NOT NULL DEFAULT 0,
  status      VARCHAR(32) NOT NULL DEFAULT 'Draft',  -- Draft / Sent / Confirmed / Cancelled
  notes       TEXT,
  created_by  VARCHAR(255) DEFAULT '',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_quotes_quote_no (quote_no),
  INDEX idx_quotes_client_id (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quote_lines (
  id        CHAR(36) NOT NULL DEFAULT (uuid()),
  quote_id  CHAR(36) NOT NULL,
  service   VARCHAR(255) DEFAULT '',
  sub_scope VARCHAR(255) DEFAULT '',
  item      VARCHAR(255) NOT NULL,
  unit      VARCHAR(64) DEFAULT '',
  qty       DECIMAL(12,2) DEFAULT 0,
  rate      DECIMAL(14,2) DEFAULT 0,
  amount    DECIMAL(14,2) DEFAULT 0,
  note      VARCHAR(255) DEFAULT '',
  sort      INT DEFAULT 1,
  PRIMARY KEY (id),
  INDEX idx_quotelines_quote (quote_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── AUDIT LOG ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGINT AUTO_INCREMENT,
  at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  user_email VARCHAR(255) DEFAULT '',
  action      VARCHAR(255) NOT NULL,
  record_type VARCHAR(64)  DEFAULT '',
  record_id   VARCHAR(255) DEFAULT '',
  details     TEXT,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── AI BRIEFINGS (one row per KL day) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_briefings (
  brief_date DATE NOT NULL DEFAULT (CURRENT_DATE),
  summary    TEXT NOT NULL,
  activity_n INT DEFAULT 0,             -- how many audit rows it was built from
  created_by VARCHAR(255) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (brief_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── BLOG & LINKEDIN POSTS (blg_) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blg_posts (
  id              CHAR(36) NOT NULL DEFAULT (uuid()),
  ref             VARCHAR(64) NOT NULL,               -- human ref, e.g. P1719912345678
  job_scope       VARCHAR(255) DEFAULT '',
  mall            VARCHAR(255) DEFAULT '',
  brand           VARCHAR(255) DEFAULT '',
  job_date        DATE,
  caption         TEXT,
  target          VARCHAR(32) NOT NULL DEFAULT 'Both',     -- Both / Wix / LinkedIn
  wix_status      VARCHAR(32) NOT NULL DEFAULT 'Pending',  -- Pending / Drafted / Posted / N/A
  linkedin_status VARCHAR(32) NOT NULL DEFAULT 'Pending',  -- Pending / Drafted / Posted / N/A
  wix_link        VARCHAR(512) DEFAULT '',
  linkedin_link   VARCHAR(512) DEFAULT '',
  image_paths     JSON NOT NULL DEFAULT (JSON_ARRAY()),    -- storage paths, first = cover
  image_url       VARCHAR(512) DEFAULT '',            -- XLSX-ADDED (Drive URL, files not migrating yet)
  image_file_id   VARCHAR(255) DEFAULT '',            -- XLSX-ADDED (Drive file ID)
  pushed_at       DATETIME,
  created_by      VARCHAR(255) DEFAULT '',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_blg_posts_ref (ref),
  INDEX idx_blg_posts_created (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── PENDING QUEUE VIEW (was blg_pending) ───────────────────────────────────
CREATE OR REPLACE VIEW blg_pending AS
SELECT id, ref, job_scope, mall, brand, job_date, caption, target,
       wix_status, linkedin_status, image_paths, created_at
FROM blg_posts
WHERE wix_status = 'Pending' OR linkedin_status = 'Pending';

-- ============================================================
-- Phase 2 checklist — functions to port to the Express API
-- ============================================================
-- RPC-PORT: is_allowed() — allowlist gate → auth middleware: session user exists in `users` and active=1
-- RPC-PORT: is_admin() — admin gate → auth middleware: users.role='admin'
-- RPC-PORT: current_email() — signed-in user's email → from session/JWT, stamped by API on writes
-- RPC-PORT: log_audit(p_action, p_details) — insert audit_log row (user_email = current user, details truncated to 300 chars)
-- RPC-PORT: save_quote(payload json) — POST /quotes: validate mall/clientName/lines, server-side recompute of every line (min_qty bump + min_charge floor, notes annotated), subtotal/SST/total, atomic sequential quote_no `<QUOTE_PREFIX>-YYYY-###` (KL year), insert quotes + quote_lines in one transaction, log_audit('SAVE QUOTE', ...), return quote id
-- RPC-PORT: ai_run_select(q) — admin-only guarded read-only query runner: single statement, SELECT/WITH only, forbidden-keyword blocklist, LIMIT 200, ~8s timeout, returns JSON rows (was Edge-Function-only)
-- RPC-PORT: blg_mark(p_ref, p_channel, p_status, p_link) — update blg_posts wix/linkedin status + link by ref, stamp pushed_at, log_audit('MARK POST', ...), returns {ok|error}

-- ============================================================
-- Storage buckets → cPanel upload dirs (Phase 2)
-- ============================================================
-- BUCKET: blog-images
