-- ============================================================
-- HG hub — FULL MySQL schema (assembled 2026-07-16)
-- Import this file into the empty database via phpMyAdmin.
-- Idempotent: safe to re-run.
-- ============================================================

-- ####### modules/01-foundation.sql #######
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
  quote_date  DATE NOT NULL DEFAULT (CURRENT_DATE),
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
  action     VARCHAR(255) NOT NULL,
  details    TEXT,
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


-- ####### modules/02-hoarding.sql #######
-- ============================================================
-- HG hub — hoarding pricing (MySQL 8) — translated from supabase/schema-hoarding.sql
-- Reconciled against 03-hoarding-pricing.xlsx (2026-07-16)
-- ============================================================
SET NAMES utf8mb4;

-- ─── 1 · MATERIAL CATALOG (xlsx tab: Materials) ─────────────────────────────
CREATE TABLE IF NOT EXISTS hrd_materials (
  code       VARCHAR(64) NOT NULL,
  type       VARCHAR(255) DEFAULT '',
  size       VARCHAR(255) DEFAULT '',
  thickness  DECIMAL(14,4),                       -- NULL = n/a (GAS stored '')
  bar_qty    DECIMAL(12,2) DEFAULT 1,             -- units per bar / sheet (cost divisor)
  unit       VARCHAR(255) DEFAULT 'm',
  cost_price DECIMAL(14,2) DEFAULT 0,             -- RM per bar/sheet
  markup     DECIMAL(14,4) DEFAULT 0.4,           -- FRACTION (0.4 = 40%), same as GAS sheet
  updated_by VARCHAR(255) DEFAULT '',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 2 · QUOTES (xlsx tab: Quotes; full snapshot incl. dataJson → data) ─────
CREATE TABLE IF NOT EXISTS hrd_quotes (
  id              CHAR(36) NOT NULL DEFAULT (uuid()),
  quote_no        VARCHAR(64) NOT NULL,
  quote_date      DATE DEFAULT (CURRENT_DATE),
  client          VARCHAR(255) NOT NULL,
  contact         VARCHAR(255) DEFAULT '',
  project         VARCHAR(255) DEFAULT '',
  mall            VARCHAR(255) DEFAULT '',
  lot             VARCHAR(255) DEFAULT '',
  location        VARCHAR(255) DEFAULT '',
  validity        DECIMAL(12,2) DEFAULT 0,
  status          VARCHAR(64) NOT NULL DEFAULT 'Draft',  -- Draft / Sent / Won / Lost
  length          DECIMAL(14,4) DEFAULT 0,
  height          DECIMAL(14,4) DEFAULT 0,
  doors           DECIMAL(14,4) DEFAULT 0,
  hoarding_total  DECIMAL(14,2) DEFAULT 0,
  gate_total      DECIMAL(14,2) DEFAULT 0,
  subtotal        DECIMAL(14,2) DEFAULT 0,
  sst_pct         DECIMAL(14,4) DEFAULT 0,
  sst_amount      DECIMAL(14,2) DEFAULT 0,
  grand_total     DECIMAL(14,2) DEFAULT 0,
  data            JSON NOT NULL,                          -- {inputs, lines:{H,G}, metrics} (xlsx: dataJson)
  created_by      VARCHAR(255) DEFAULT '',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by      VARCHAR(255) DEFAULT '',
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  signboard_total DECIMAL(14,2) DEFAULT 0,                -- XLSX-ADDED
  material_total  DECIMAL(14,2) DEFAULT 0,                -- XLSX-ADDED
  labor_total     DECIMAL(14,2) DEFAULT 0,                -- XLSX-ADDED
  PRIMARY KEY (id),
  UNIQUE KEY uq_hrd_quotes_quote_no (quote_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 3 · SUPPLIER PRICES (xlsx tab: SupplierPrices; recordedAt/recordedBy = created_at/created_by) ──
CREATE TABLE IF NOT EXISTS hrd_supplier_prices (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),
  code       VARCHAR(64) NOT NULL,                -- material code
  supplier   VARCHAR(255) NOT NULL,
  cost_price DECIMAL(14,2) DEFAULT 0,
  note       TEXT,
  created_by VARCHAR(255) DEFAULT '',             -- = recordedBy in the GAS sheet
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,  -- = recordedAt in the GAS sheet
  PRIMARY KEY (id),
  INDEX idx_hrd_supplier_prices_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 4 · PRICE HISTORY (xlsx tab: PriceHistory; user → user_email) ──────────
CREATE TABLE IF NOT EXISTS hrd_price_history (
  id         BIGINT AUTO_INCREMENT,
  ts         DATETIME DEFAULT CURRENT_TIMESTAMP,
  code       VARCHAR(64) NOT NULL,
  field      VARCHAR(64) NOT NULL,                -- 'Cost Price' | 'Markup %'
  old_val    DECIMAL(14,4) DEFAULT 0,             -- display values (markup shown as %)
  new_val    DECIMAL(14,4) DEFAULT 0,
  user_email VARCHAR(255) DEFAULT '',
  reason     TEXT,
  PRIMARY KEY (id),
  INDEX idx_hrd_price_history_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 5 · TOOL CONFIG (xlsx tab: Config) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS hrd_config (
  `key`   VARCHAR(64) NOT NULL,
  `value` TEXT,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO hrd_config (`key`, `value`) VALUES
  ('COMPANY_NAME',   'HG Services (M) Sdn Bhd'),
  ('COMPANY_REG',    'Co. No. 958510-M'),
  ('COMPANY_ADDRESS','Bandar Kinrara, Puchong, Selangor'),
  ('COMPANY_EMAIL',  'info@hggroup.com.my'),
  ('COMPANY_WEB',    'www.hggroup.com.my'),
  ('SST_PCT',        '6'),   -- Excel labelled "8%" but computed 6% — 6% is HG standard
  ('DEFAULT_MARKUP', '40'),
  ('QUOTE_PREFIX',   'HG-Q-'),
  ('QUOTE_SEQ',      '0'),
  ('CODE_GI',        'GI-4x8-0.4'),
  ('CODE_DECK_MAIN', 'DECK-0.23'),
  ('CODE_DECK_GATE', 'DECK-0.48'),
  ('CODE_FOOTING',   'FOOTING-450x450x750'),
  ('CODE_BASE',      'BASE-200x200x5'),
  ('CODE_XBRACE',    'MS-50x50x5'),
  ('XBRACE_LEN',     '10.8'),
  ('L_FAB_POST',     '150'),
  ('L_PRELIM',       '1200'),
  ('L_INSTALL',      '1500'),
  ('L_FAB_GATE',     '1200'),
  ('L_INSTALL_GATE', '1500'),
  ('SIGNATORY',      'Lee Chun Hui (Black) — Director'),
  ('TERMS', '1. Validity: As stated above from quote date.\n2. Payment: 50% deposit on confirmation, 50% on completion. Payment within 30 days of invoice.\n3. Lead time: Mobilization within 7 working days of confirmed PO and site readiness.\n4. Site requirements: Client to provide unobstructed access, water & power, and necessary permits.\n5. Variations: Any scope changes quoted separately, require written approval before execution.\n6. Warranty: Workmanship warranty of 6 months from completion against manufacturing defects.\n7. Force majeure: HG not liable for delays from weather, mall restrictions, or third-party works.\n8. Insurance: Public liability coverage included as per HG Group standard policy.');

-- ─── 6 · SEED — 28-material catalog from HG Metal Deck Calculator (3).xlsx ──
INSERT IGNORE INTO hrd_materials (code, type, size, thickness, bar_qty, unit, cost_price, markup, updated_by) VALUES
  ('MS-25x25x2.8','MS Square Hollow','25x25',2.8,6,'m',18,0.4,'seed'),
  ('MS-38x38x2.8','MS Square Hollow','38x38',2.8,6,'m',26.5,0.4,'seed'),
  ('MS-50x50x2.8','MS Square Hollow','50x50',2.8,6,'m',39,0.4,'seed'),
  ('MS-100x100x2.3','MS Square Hollow','100x100',2.3,6,'m',111,0.4,'seed'),
  ('MS-150x150x3','MS Square Hollow','150x150',3,6,'m',272,0.4,'seed'),
  ('MS-150x100x3','MS Rect Hollow','150x100',3,6,'m',200,0.4,'seed'),
  ('MS-100x75x3','MS Rect Hollow','100x75',3,6,'m',120,0.4,'seed'),
  ('MS-50x100x6','MS Rect Hollow','50x100',6,6,'m',233,0.4,'seed'),
  ('MS-65x38x3','MS Rect Hollow','65x38',3,6,'m',73,0.4,'seed'),
  ('MS-50x50x6','MS Square Hollow','50x50',6,6,'m',193,0.4,'seed'),
  ('MS-25x25x1','MS Square Hollow','25x25',1,6,'m',12,0.4,'seed'),
  ('MS-38x38x1.6','MS Square Hollow','38x38',1.6,6,'m',28.5,0.4,'seed'),
  ('MS-25x50x1.5','MS Rect Hollow','25x50',1.5,6,'m',26,0.4,'seed'),
  ('MS-50x50x1.5','MS Square Hollow','50x50',1.5,6,'m',38,0.4,'seed'),
  ('MS-50x75x1.5','MS Rect Hollow','50x75',1.5,6,'m',48,0.4,'seed'),
  ('MS-75x75x1.6','MS Square Hollow','75x75',1.6,6,'m',59,0.4,'seed'),
  ('MS-75x75x4','MS Square Hollow','75x75',4,6,'m',155,0.4,'seed'),
  ('MS-100x75x1.9','MS Rect Hollow','100x75',1.9,6,'m',79,0.4,'seed'),
  ('MS-50x50x5','MS Square Solid','50x50',5,6,'m',205.71,0.4,'seed'),
  ('GI-4x8-0.4','GI Sheet','4x8 ft',0.4,32,'sqft',52,0.4,'seed'),
  ('BASE-200x200x5','MS Base Plate','200x200',5,1,'nos',28,0.4,'seed'),
  ('DECK-0.23','Metal Deck','762mm x 8ft',0.23,20,'sqft',21.2,0.4,'seed'),
  ('DECK-0.35','Metal Deck','762mm x 8ft',0.35,20,'sqft',42,0.4,'seed'),
  ('DECK-0.48','Metal Deck','762mm x 8ft',0.48,20,'sqft',46,0.4,'seed'),
  ('FOOTING-3000x300x600','Concrete Footing','3000x300x600',NULL,1,'nos',35,0.4,'seed'),
  ('FOOTING-450x450x750','Concrete Footing','450x450x750',NULL,1,'nos',40,0.4,'seed'),
  ('BESI-BIRU-0.45x121','Besi Biru','0.45x121',0.75,6,'m',15,0.4,'seed'),
  ('BESI-BIRU-0.73x153','Besi Biru','0.73x153',1.55,6,'m',25,0.4,'seed');

-- ============================================================
-- NOTES
-- - xlsx AuditLog tab (6-col: timestamp, userEmail, action, recordType,
--   recordId, details) imports into the SHARED foundation audit table
--   (log_audit lives in the foundation module, not here).
-- - CALC ENGINE lives in hrd_save_quote (see RPC-PORT below). Verified test
--   case: L=160, H=2.4, CC=3, doors=1 → hoarding 47,860.14 · gate 5,740.26 ·
--   subtotal ex-tax 53,600.39 — port must reproduce to the cent
--   (roundUp_(x) = Math.ceil(x - 1e-9), IEEE-754 double maths,
--   final totals rounded to 2 dp).
-- ============================================================

-- RPC-PORT: hrd_cfg(p_key text) — returns hrd_config.value for a key
-- RPC-PORT: hrd_client_rate(p_code text) — clientRate = (cost_price / bar_qty when bar_qty≠0 else cost_price) × (1 + markup); missing material → 0 (exact port of withRates_ in Code.gs)
-- RPC-PORT: hrd_unit_of(p_code text) — returns hrd_materials.unit for a code, '' if missing
-- RPC-PORT: hrd_roundup(x double) — Math.ceil(x - 1e-9), exact GAS round-up
-- RPC-PORT: hrd_line(item, code, rate, sub, qty, unit) — builds one costing-line JSON object {item, code, rate, sub, qty, unit, total: sub*qty}
-- RPC-PORT: hrd_save_quote(payload json) — AUTHORITATIVE server-side quote recompute (exact Excel/Code.gs calc engine), freezes full snapshot into hrd_quotes.data, sequential quote numbering PREFIX-YYYY-### with QUOTE_SEQ bump, insert/update + audit log
-- RPC-PORT: hrd_edit_material_price(p_code, p_field, p_value, p_reason) — atomic material price/markup edit (form sends % for markup, store fraction) + hrd_price_history row + audit log
-- RPC-PORT: hrd_apply_supplier(p_id) — copies a supplier price into hrd_materials.cost_price + hrd_price_history row + audit log

-- BUCKET: (none — the tool stores no files)


-- ####### modules/03-visual.sql #######
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


-- ####### modules/04-dispatch.sql #######
-- ============================================================
-- HG hub — dispatch (MySQL 8) — translated from supabase/schema-dispatch.sql
-- Reconciled against 13-dispatch-db.xlsx (2026-07-16)
-- Tables: dsp_jobs, dsp_teams, dsp_staff, dsp_lorries, dsp_config,
--         dsp_audit_log (XLSX-ADDED) + view dsp_alarms
-- Note: dsp_alarms view uses CTEs — requires MySQL 8.0.19+.
-- ============================================================
SET NAMES utf8mb4;

-- ─── 1 · JOBS ────────────────────────────────────────────────
-- xlsx "Jobs" tab (rows=0) matches the Supabase columns 1:1 (camelCase → snake_case).
CREATE TABLE IF NOT EXISTS dsp_jobs (
  id                 CHAR(36)     NOT NULL DEFAULT (uuid()) PRIMARY KEY,
  job_code           VARCHAR(64)  NOT NULL DEFAULT '',        -- J-0001 style, assigned by dsp_save_job() (see RPC-PORT)
  client             VARCHAR(255) NOT NULL DEFAULT '',
  client_group       VARCHAR(255) NOT NULL DEFAULT '',        -- client WhatsApp group chat name
  mall               VARCHAR(255) NOT NULL DEFAULT '',
  lot_no             VARCHAR(255) NOT NULL DEFAULT '',
  job_type           VARCHAR(64)  NOT NULL DEFAULT 'install', -- install|dismantle|rectify|modify|other
  scope              VARCHAR(255) NOT NULL DEFAULT '',        -- e.g. "12m hoarding"
  door_type          VARCHAR(64)  NOT NULL DEFAULT 'None',
  install_date       DATE,
  measure_status     VARCHAR(32)  NOT NULL DEFAULT 'pending', -- pending|sketch_done|not_required
  sketch_url         VARCHAR(512) NOT NULL DEFAULT '',        -- Google Drive URL, files not migrating yet
  quote_status       VARCHAR(32)  NOT NULL DEFAULT 'pending', -- pending|sent|confirmed|not_required
  quote_ref          VARCHAR(255) NOT NULL DEFAULT '',
  needs_visual       VARCHAR(8)   NOT NULL DEFAULT 'no',      -- yes|no
  visual_status      VARCHAR(32)  NOT NULL DEFAULT 'na',      -- na|pending|approved
  visual_url         VARCHAR(512) NOT NULL DEFAULT '',        -- Google Drive URL
  permit_by          VARCHAR(32)  NOT NULL DEFAULT 'us',      -- us|client|already_have|not_required
  permit_status      VARCHAR(32)  NOT NULL DEFAULT 'pending', -- not_required|pending|submitted|approved
  permit_url         VARCHAR(512) NOT NULL DEFAULT '',        -- Google Drive URL
  permit_approved_at DATE,
  material_ready     VARCHAR(8)   NOT NULL DEFAULT 'no',      -- yes|no
  material_notes     TEXT,
  job_status         VARCHAR(32)  NOT NULL DEFAULT 'open',    -- open|assigned|done|cancelled
  dispatch_date      DATE,                                    -- the night it is loaded into a team
  team_no            VARCHAR(64)  NOT NULL DEFAULT '',
  seq                VARCHAR(64)  NOT NULL DEFAULT '',
  notes              TEXT,
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by         VARCHAR(255) DEFAULT '',
  updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by         VARCHAR(255) DEFAULT '',
  INDEX idx_dsp_jobs_install  (install_date),
  INDEX idx_dsp_jobs_dispatch (dispatch_date, team_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 2 · TEAMS (crew per night per team number) ──────────────
-- xlsx "Teams" tab (rows=0) matches 1:1. UNIQUE kept: rows=0 in production, no conflict risk.
CREATE TABLE IF NOT EXISTS dsp_teams (
  id            CHAR(36)     NOT NULL DEFAULT (uuid()) PRIMARY KEY,
  dispatch_date DATE         NOT NULL,
  team_no       VARCHAR(64)  NOT NULL,
  driver        VARCHAR(255) NOT NULL DEFAULT '',   -- driver cum supervisor
  workers       VARCHAR(512) NOT NULL DEFAULT '',   -- comma-separated names
  lorry         VARCHAR(64)  NOT NULL DEFAULT '',   -- plate
  notes         TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by    VARCHAR(255) DEFAULT '',
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by    VARCHAR(255) DEFAULT '',
  UNIQUE KEY uq_dsp_teams_night (dispatch_date, team_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 3 · STAFF ───────────────────────────────────────────────
-- xlsx "Staff" tab (rows=0) matches 1:1.
CREATE TABLE IF NOT EXISTS dsp_staff (
  id         CHAR(36)     NOT NULL DEFAULT (uuid()) PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  role       VARCHAR(32)  NOT NULL DEFAULT 'worker',  -- driver | worker
  phone      VARCHAR(64)  NOT NULL DEFAULT '',
  active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(255) DEFAULT '',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255) DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 4 · LORRIES ─────────────────────────────────────────────
-- xlsx "Lorries" tab (rows=0) matches 1:1.
CREATE TABLE IF NOT EXISTS dsp_lorries (
  id         CHAR(36)     NOT NULL DEFAULT (uuid()) PRIMARY KEY,
  plate      VARCHAR(64)  NOT NULL,
  label      VARCHAR(255) NOT NULL DEFAULT '',        -- 3-tonne / 1-tonne
  active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(255) DEFAULT '',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255) DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 5 · CONFIG (same keys + defaults as the GAS Config sheet seed) ───
-- xlsx "Config" tab (rows=6) matches 1:1.
CREATE TABLE IF NOT EXISTS dsp_config (
  `key`   VARCHAR(64) NOT NULL PRIMARY KEY,
  `value` VARCHAR(255) DEFAULT '',
  notes   VARCHAR(255) DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO dsp_config (`key`, `value`, notes) VALUES
  ('permitLeadDays',    '3',  'Working days a permit needs before install — drives the permit early-warning'),
  ('atRiskDays',        '3',  'If install date is within N days and the job is not ready → AMBER "at risk"'),
  ('maxTeams',          '12', 'Max night-install teams'),
  ('maxJobsPerTeam',    '5',  'Max jobs per team per night'),
  ('maxWorkersPerTeam', '5',  'Max workers per team (excludes the driver cum supervisor)'),
  ('emailRecipients',   'blacklee@hggroup.com.my', 'Comma-separated — who gets the daily readiness email (sent by the daily-alarms Edge Function)');

-- ─── 6 · AUDIT LOG ── XLSX-ADDED table ───────────────────────
-- xlsx "AuditLog" tab (rows=10) has NO Supabase equivalent in schema-dispatch.sql
-- (Supabase routed audit rows to the shared foundation audit_log). Landing table
-- for the legacy GAS rows; the surrogate id is structural (tab has no id column).
CREATE TABLE IF NOT EXISTS dsp_audit_log (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  `timestamp` DATETIME DEFAULT CURRENT_TIMESTAMP,   -- XLSX-ADDED
  user_email  VARCHAR(255) DEFAULT '',              -- XLSX-ADDED (xlsx: userEmail)
  action      VARCHAR(255) DEFAULT '',              -- XLSX-ADDED
  record_type VARCHAR(64)  DEFAULT '',              -- XLSX-ADDED (xlsx: recordType)
  record_id   VARCHAR(64)  DEFAULT '',              -- XLSX-ADDED (xlsx: recordId)
  details     TEXT,                                 -- XLSX-ADDED
  INDEX idx_dsp_audit_ts (`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 7 · ALARMS VIEW — was read by the shared `daily-alarms` Edge Function ───
-- Mirrors sendDailyDispatchDigest() in the GAS backend:
--   permit_alarm : permit not OK and install within permitLeadDays (incl. overdue)
--   at_risk      : not ready, install in 0–7 days, within atRiskDays, no permit alarm
--   blocked      : not ready and install far out (or no date)
-- Postgres arrays (array_remove/array_to_string/cardinality) → CONCAT_WS string.
-- CURDATE() assumes server runs Asia/Kuala_Lumpur local time (dates stored KL local).
CREATE OR REPLACE VIEW dsp_alarms AS
WITH cfg AS (
  SELECT
    COALESCE((SELECT CAST(NULLIF(`value`,'') AS SIGNED) FROM dsp_config WHERE `key` = 'permitLeadDays'), 3) AS lead_days,
    COALESCE((SELECT CAST(NULLIF(`value`,'') AS SIGNED) FROM dsp_config WHERE `key` = 'atRiskDays'),     3) AS risk_days,
    COALESCE((SELECT NULLIF(`value`,'')                 FROM dsp_config WHERE `key` = 'emailRecipients'),
             'blacklee@hggroup.com.my') AS recipients
),
base AS (
  SELECT j.*,
         DATEDIFF(j.install_date, CURDATE()) AS days_left,
         (j.permit_status = 'approved' OR j.permit_by IN ('already_have','not_required')
          OR j.permit_status = 'not_required') AS permit_ok
  FROM dsp_jobs j
  WHERE j.job_status NOT IN ('done','cancelled')
),
gated AS (
  SELECT b.*,
         CONCAT_WS(', ',
           CASE WHEN b.mall = '' OR b.lot_no = ''                             THEN 'Lot / Mall' END,
           CASE WHEN b.measure_status NOT IN ('sketch_done','not_required')   THEN 'Measurement sketch' END,
           CASE WHEN b.quote_status   NOT IN ('confirmed','not_required')     THEN 'Quotation' END,
           CASE WHEN NOT b.permit_ok                                          THEN 'Permit' END,
           CASE WHEN b.needs_visual = 'yes' AND b.visual_status <> 'approved' THEN 'Visual artwork' END,
           CASE WHEN b.material_ready <> 'yes'                                THEN 'Material / fab' END
         ) AS missing
  FROM base b
)
SELECT 'permit_alarm'   AS alarm_type,
       g.job_code       AS ref,
       CONCAT(g.mall, ' · ', g.lot_no, ' · ', g.client,
              ' — permit: ', g.permit_by, ' / ', g.permit_status) AS detail,
       g.install_date   AS due_date,
       cfg.recipients   AS recipient
FROM gated g, cfg
WHERE NOT g.permit_ok AND g.days_left IS NOT NULL AND g.days_left <= cfg.lead_days
UNION ALL
SELECT 'at_risk', g.job_code,
       CONCAT(g.mall, ' · ', g.lot_no, ' · ', g.client, ' — missing: ', g.missing),
       g.install_date, cfg.recipients
FROM gated g, cfg
WHERE g.missing <> ''
  AND NOT (NOT g.permit_ok AND g.days_left IS NOT NULL AND g.days_left <= cfg.lead_days)
  AND g.days_left IS NOT NULL AND g.days_left BETWEEN 0 AND 7
  AND g.days_left <= cfg.risk_days
UNION ALL
SELECT 'blocked', g.job_code,
       CONCAT(g.mall, ' · ', g.lot_no, ' · ', g.client, ' — missing: ', g.missing),
       g.install_date, cfg.recipients
FROM gated g, cfg
WHERE g.missing <> ''
  AND (g.days_left IS NULL OR g.days_left > cfg.risk_days);

-- ============================================================
-- Phase 2 checklist
-- ============================================================
-- RPC-PORT: dsp_save_job(payload jsonb) — atomic insert/update of dsp_jobs: mints next sequential J-#### job_code (max of digits across job_code + 1, keeps existing code on update), camelCase payload keys from GAS saveJob(), validates client/mall/lotNo minimum, stamps created_by/updated_by from auth email, writes CREATE/UPDATE Job audit entry.
-- RPC-PORT (shared, foundation module): log_audit(p_action, p_details) — dispatch frontend calls it directly (dispatch-supabase.html:1278); port once in the foundation API, not per-module.
-- RPC-PORT (edge function): daily-alarms — shared Edge Function reads the dsp_alarms view and emails dsp_config.emailRecipients daily; re-implement as a cron job hitting the same view.
--
-- BUCKET: (none — dispatch tool uploads nothing to storage; sketch_url/visual_url/permit_url are Google Drive links kept as text)


-- ####### modules/05-inventory.sql #######
-- ============================================================
-- HG hub — inventory (MySQL 8) — translated from supabase/schema-inventory.sql
-- Reconciled against 01-inventory-v5-LIVE.xlsx (2026-07-16)
-- ============================================================
SET NAMES utf8mb4;

-- ─── MASTERS ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inv_materials (
  id                  CHAR(36) NOT NULL DEFAULT (uuid()),
  name                VARCHAR(255) NOT NULL,
  unit                VARCHAR(255) DEFAULT 'pc',
  category            VARCHAR(255) DEFAULT '',
  low_stock_threshold DECIMAL(12,2) DEFAULT 0,
  photo_url           VARCHAR(512) DEFAULT '',
  created_by          VARCHAR(255) DEFAULT '',
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by          VARCHAR(255) DEFAULT '',
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inv_suppliers (
  id             CHAR(36) NOT NULL DEFAULT (uuid()),
  name           VARCHAR(255) NOT NULL,
  contact        VARCHAR(255) DEFAULT '',
  contact_person VARCHAR(255) DEFAULT '',
  category       VARCHAR(255) DEFAULT '',
  supplier_type  VARCHAR(255) DEFAULT '',            -- '', Material, Tool, Both
  notes          TEXT,
  created_by     VARCHAR(255) DEFAULT '',
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by     VARCHAR(255) DEFAULT '',
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inv_tools (
  id            CHAR(36) NOT NULL DEFAULT (uuid()),
  name          VARCHAR(255) NOT NULL,
  category      VARCHAR(255) DEFAULT '',
  brand         VARCHAR(255) DEFAULT '',
  unit          VARCHAR(255) DEFAULT 'pc',
  total_qty     DECIMAL(12,2) DEFAULT 0,
  serial_number VARCHAR(255) DEFAULT '',
  photo_url     VARCHAR(512) DEFAULT '',
  notes         TEXT,
  created_by    VARCHAR(255) DEFAULT '',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by    VARCHAR(255) DEFAULT '',
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Workers tab exists in 01-inventory-v5-LIVE.xlsx (rows=2) but has no
-- Supabase table in schema-inventory.sql — added whole table. -- XLSX-ADDED
CREATE TABLE IF NOT EXISTS inv_workers (
  id         CHAR(36) NOT NULL DEFAULT (uuid()),     -- XLSX-ADDED
  name       VARCHAR(255) NOT NULL,                  -- XLSX-ADDED
  role       VARCHAR(255) DEFAULT '',                -- XLSX-ADDED
  division   VARCHAR(255) DEFAULT '',                -- XLSX-ADDED
  active     TINYINT(1) DEFAULT 1,                   -- XLSX-ADDED
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,     -- XLSX-ADDED
  created_by VARCHAR(255) DEFAULT '',                -- XLSX-ADDED
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,     -- XLSX-ADDED
  updated_by VARCHAR(255) DEFAULT '',                -- XLSX-ADDED
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── PURCHASES (Stock IN) ───────────────────────────────────
-- supplier/material/tool cross-references are stored as text ids on purpose
-- (original app allows deleting a master even when linked records exist).
-- Header→line cascade was FK-based in Supabase — no FKs here, so the
-- Express API must delete lines/allocations with their header.

CREATE TABLE IF NOT EXISTS inv_purchases (
  id                  CHAR(36) NOT NULL DEFAULT (uuid()),
  date                DATE NOT NULL,
  supplier_id         VARCHAR(64) DEFAULT '',
  do_number           VARCHAR(255) DEFAULT '',
  notes               TEXT,
  invoice_url         VARCHAR(512) DEFAULT '',
  discount            DECIMAL(14,2) DEFAULT 0,
  delivery            DECIMAL(14,2) DEFAULT 0,
  tax                 DECIMAL(14,2) DEFAULT 0,
  rounding_adjustment DECIMAL(14,2) DEFAULT 0,
  delivery_photos     JSON,
  paid_by             VARCHAR(255) DEFAULT 'company',  -- company | self (Black Lee claim)
  created_by          VARCHAR(255) DEFAULT '',
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_inv_purchases_supplier (supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inv_purchase_lines (
  id           CHAR(36) NOT NULL DEFAULT (uuid()),
  purchase_id  CHAR(36) NOT NULL,
  item_type    VARCHAR(255) DEFAULT 'material',       -- material | tool
  material_id  VARCHAR(64) DEFAULT '',                -- inv_materials.id OR inv_tools.id (polymorphic)
  qty          DECIMAL(12,2) DEFAULT 0,
  rate         DECIMAL(14,4) DEFAULT 0,
  amount       DECIMAL(14,2) DEFAULT 0,
  division     VARCHAR(255) DEFAULT '',
  requested_by VARCHAR(255) DEFAULT '',
  PRIMARY KEY (id),
  INDEX idx_inv_purlines_purchase (purchase_id),
  INDEX idx_inv_purlines_material (material_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── STOCK OUTS (Delivery Notes) ────────────────────────────

CREATE TABLE IF NOT EXISTS inv_stock_outs (
  id                CHAR(36) NOT NULL DEFAULT (uuid()),
  dn_number         VARCHAR(64) NOT NULL,             -- system-generated DN-YYYYMMDD-###
  date              DATE NOT NULL,
  division          VARCHAR(255) NOT NULL,
  project           VARCHAR(255) DEFAULT '',
  notes             TEXT,
  requested_by      VARCHAR(255) DEFAULT '',
  collection_photos JSON,
  created_by        VARCHAR(255) DEFAULT '',
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_inv_stock_outs_dn (dn_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inv_stock_out_lines (
  id            CHAR(36) NOT NULL DEFAULT (uuid()),
  stock_out_id  CHAR(36) NOT NULL,
  material_id   VARCHAR(64) DEFAULT '',
  qty           DECIMAL(12,2) DEFAULT 0,
  rate_per_unit DECIMAL(14,4) DEFAULT 0,
  amount        DECIMAL(14,2) DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_inv_outlines_out (stock_out_id),
  INDEX idx_inv_outlines_material (material_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── PRICE QUOTATIONS (supplier quotes) ─────────────────────

CREATE TABLE IF NOT EXISTS inv_quotations (
  id             CHAR(36) NOT NULL DEFAULT (uuid()),
  item_type      VARCHAR(255) DEFAULT 'material',     -- material | tool
  material_id    VARCHAR(64) DEFAULT '',              -- inv_materials.id OR inv_tools.id
  supplier_id    VARCHAR(64) DEFAULT '',
  rate           DECIMAL(14,4) DEFAULT 0,
  qty_offered    DECIMAL(12,2),
  valid_until    DATE,
  source         VARCHAR(255) DEFAULT '',             -- WhatsApp / Email / Phone / ...
  notes          TEXT,
  screenshot_url VARCHAR(512) DEFAULT '',
  created_by     VARCHAR(255) DEFAULT '',
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by     VARCHAR(255) DEFAULT '',
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_inv_quotations_material (material_id),
  INDEX idx_inv_quotations_supplier (supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── TOOL ASSIGNMENTS ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS inv_tool_assignments (
  id                 CHAR(36) NOT NULL DEFAULT (uuid()),
  tool_id            VARCHAR(64) DEFAULT '',
  qty                DECIMAL(12,2) DEFAULT 0,
  person             VARCHAR(255) DEFAULT '',
  division           VARCHAR(255) DEFAULT '',
  assigned_date      DATE,
  assigned_notes     TEXT,
  returned_date      DATE,
  returned_qty       DECIMAL(12,2),
  returned_condition VARCHAR(255) DEFAULT '',         -- OK / TO_REPAIR / TO_DISCARD / TO_REASSIGN
  returned_notes     TEXT,
  returned_photo_url VARCHAR(512) DEFAULT '',
  created_by         VARCHAR(255) DEFAULT '',
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by         VARCHAR(255) DEFAULT '',
  updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_inv_toolassign_tool (tool_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── REPAIRS ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inv_repairs (
  id                 CHAR(36) NOT NULL DEFAULT (uuid()),
  tool_id            VARCHAR(64) DEFAULT '',
  assignment_id      VARCHAR(64) DEFAULT '',
  qty                DECIMAL(12,2) DEFAULT 0,
  supplier_id        VARCHAR(64) DEFAULT '',
  sent_date          DATE,
  sent_notes         TEXT,
  sent_photo_url     VARCHAR(512) DEFAULT '',
  status             VARCHAR(255) DEFAULT 'SENT',     -- SENT | RETURNED
  returned_date      DATE,
  returned_qty       DECIMAL(12,2),
  returned_notes     TEXT,
  returned_photo_url VARCHAR(512) DEFAULT '',
  created_by         VARCHAR(255) DEFAULT '',
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by         VARCHAR(255) DEFAULT '',
  updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_inv_repairs_tool (tool_id),
  INDEX idx_inv_repairs_assignment (assignment_id),
  INDEX idx_inv_repairs_supplier (supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── STOCK COUNTS / AUDIT ───────────────────────────────────

CREATE TABLE IF NOT EXISTS inv_stock_counts (
  id          CHAR(36) NOT NULL DEFAULT (uuid()),
  count_date  DATE,
  item_type   VARCHAR(255) DEFAULT 'material',        -- material | tool
  item_id     VARCHAR(64) DEFAULT '',
  system_qty  DECIMAL(12,2) DEFAULT 0,
  counted_qty DECIMAL(12,2) DEFAULT 0,
  variance    DECIMAL(12,2) DEFAULT 0,
  reason      VARCHAR(255) DEFAULT '',                -- LOST/DAMAGED/FOUND/MISPLACED/DISPUTE/ADJUSTMENT/OTHER
  notes       TEXT,
  photo_url   VARCHAR(512) DEFAULT '',
  created_by  VARCHAR(255) DEFAULT '',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by  VARCHAR(255) DEFAULT '',
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_inv_stockcounts_item (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── PAYMENTS (supplier payments + Black Lee self-claim reimbursements) ─

CREATE TABLE IF NOT EXISTS inv_payments (
  id               CHAR(36) NOT NULL DEFAULT (uuid()),
  payment_date     DATE NOT NULL,
  payee_type       VARCHAR(255) DEFAULT 'supplier',   -- supplier | self
  payee_id         VARCHAR(64) DEFAULT '',            -- inv_suppliers.id when supplier; '' for self
  amount           DECIMAL(14,2) DEFAULT 0,
  method           VARCHAR(255) DEFAULT '',
  reference_number VARCHAR(255) DEFAULT '',
  notes            TEXT,
  slip_photo_url   VARCHAR(512) DEFAULT '',
  created_by       VARCHAR(255) DEFAULT '',
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by       VARCHAR(255) DEFAULT '',
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_inv_payments_payee (payee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inv_payment_allocations (
  id             CHAR(36) NOT NULL DEFAULT (uuid()),
  payment_id     CHAR(36) NOT NULL,
  purchase_id    CHAR(36) NOT NULL,
  amount_applied DECIMAL(14,2) DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_inv_payalloc_payment (payment_id),
  INDEX idx_inv_payalloc_purchase (purchase_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Phase 2 checklist — functions to port to JS in the Express API
-- ============================================================
-- RPC-PORT: inv_save_purchase(payload jsonb) — atomic insert of purchase header + valid lines (skips blank/zero-qty lines); tool lines auto-increase inv_tools.total_qty; writes audit log.
-- RPC-PORT: inv_delete_purchase(p_id uuid) — reverses tool total_qty for tool lines, then deletes purchase; must also delete inv_purchase_lines + inv_payment_allocations (Supabase FK cascade — no FKs in MySQL, API must cascade); writes audit log.
-- RPC-PORT: inv_save_stock_out(payload jsonb) — atomic stock-out header + lines with serialized DN numbering DN-YYYYMMDD-### (Postgres advisory lock — use a MySQL transaction/lock to serialize); writes audit log.
-- RPC-PORT: inv_save_payment(payload jsonb) — insert-or-update payment header with server-computed total from allocations; replaces inv_payment_allocations rows; writes audit log.

-- ============================================================
-- Storage buckets → file storage to replicate on cPanel (files stay in
-- Google Drive / Supabase storage until the separate file migration)
-- ============================================================
-- BUCKET: inventory-files


-- ####### modules/06-subcon-invoice.sql #######
-- ============================================================
-- HG hub — subcon-invoice (MySQL 8) — translated from supabase/schema-subcon-invoice.sql
-- Reconciled against 21-subcon-invoice.xlsx (2026-07-16)
-- Run AFTER the foundation module (app_settings, audit_log live there).
-- xlsx AuditLog tab imports into the foundation audit_log table.
-- ============================================================
SET NAMES utf8mb4;

-- ─── 1 · INVOICES ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sci_invoices (
  id           CHAR(36) NOT NULL DEFAULT (uuid()),
  inv_no       VARCHAR(64) NOT NULL,
  inv_date     DATE NOT NULL DEFAULT (CURRENT_DATE),
  ref          VARCHAR(255) DEFAULT '',            -- claim ref / period
  issuer_type  VARCHAR(16) NOT NULL DEFAULT 'ind', -- 'ind' (individual) / 'co' (company)
  issuer_name  VARCHAR(255) NOT NULL,
  issuer_ic    VARCHAR(64) DEFAULT '',
  issuer_addr  TEXT,
  issuer_phone VARCHAR(64) DEFAULT '',
  issuer_email VARCHAR(255) DEFAULT '',
  bill_to_name VARCHAR(255) DEFAULT '',
  bill_to_addr TEXT,
  subtotal     DECIMAL(14,2) NOT NULL DEFAULT 0,
  sst_enabled  TINYINT(1) NOT NULL DEFAULT 0,
  sst_amount   DECIMAL(14,2) NOT NULL DEFAULT 0,
  total        DECIMAL(14,2) NOT NULL DEFAULT 0,
  pay_info     TEXT,
  notes        TEXT,
  pdf_url      VARCHAR(512) DEFAULT '',            -- XLSX-ADDED (Drive URL, files not migrating yet)
  folder_url   VARCHAR(512) DEFAULT '',            -- XLSX-ADDED (Drive URL, files not migrating yet)
  created_by   VARCHAR(255) DEFAULT '',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sci_invoices_inv_no (inv_no)       -- system-generated SUB-YYYY-####
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sci_invoice_lines (
  id          CHAR(36) NOT NULL DEFAULT (uuid()),
  invoice_id  CHAR(36) NOT NULL,                   -- was FK → sci_invoices(id); no FK by convention
  description TEXT,
  quantity    DECIMAL(12,2) DEFAULT 0,
  unit_price  DECIMAL(14,2) DEFAULT 0,
  line_amount DECIMAL(14,2) DEFAULT 0,
  sort        INT DEFAULT 1,
  PRIMARY KEY (id),
  INDEX idx_sci_lines_invoice (invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 2 · SAVED SUBCONS (remembered issuers, one logo each) ───
-- Supabase had UNIQUE (type, lower(name)) as the upsert identity; user-entered
-- names → plain index per conventions (API enforces the case-insensitive
-- identity; utf8mb4_unicode_ci comparisons are case-insensitive anyway).
CREATE TABLE IF NOT EXISTS sci_subcons (
  id           CHAR(36) NOT NULL DEFAULT (uuid()),
  type         VARCHAR(16) NOT NULL DEFAULT 'ind', -- 'ind' / 'co'
  name         VARCHAR(255) NOT NULL,
  ic           VARCHAR(64) DEFAULT '',
  addr         TEXT,
  phone        VARCHAR(64) DEFAULT '',
  email        VARCHAR(255) DEFAULT '',
  pay_info     TEXT,
  logo_path    VARCHAR(512) DEFAULT '',            -- storage path in 'subcon-invoices' bucket
  logo_file_id VARCHAR(512) DEFAULT '',            -- XLSX-ADDED (legacy Drive file ID for the logo)
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_sci_subcons_key (type, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 3 · MY-COMPANY DEFAULT (was Script Property MY_COMPANY) ─
-- app_settings is created by the foundation module; idempotent seed.
INSERT IGNORE INTO app_settings (`key`, `value`) VALUES
  ('SCI_MY_COMPANY_NAME', ''),
  ('SCI_MY_COMPANY_ADDR', '');

-- ─── Phase 2 checklists ──────────────────────────────────────
-- RPC-PORT: sci_save_invoice(payload jsonb) — recomputes all line amounts server-side (never trusts client maths), SST fixed 6% when enabled, atomic next SUB-YYYY-#### invoice number (advisory lock → use SELECT ... FOR UPDATE / app-level lock), upserts the subcon on (type, lower(name)), persists SCI_MY_COMPANY_* bill-to defaults in app_settings, inserts invoice + lines, logs 'invoice.create' to audit_log, returns {id, invNo, subtotal, sstAmount, total}.
-- BUCKET: subcon-invoices


-- ####### modules/07-project-pl.sql #######
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
  record_id   VARCHAR(64)  DEFAULT '',
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


-- ####### modules/08-claims-expenses.sql #######
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


-- ####### modules/09-lorry-fleet.sql #######
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


-- ####### modules/10-scaffold.sql #######
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
  UNIQUE KEY uq_scf_invoices_inv_no (inv_no),      -- system-generated HG-INV####
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


-- ####### modules/11-storage-rental.sql #######
-- ============================================================
-- HG hub — storage-rental (MySQL 8) — translated from supabase/schema-storage-rental.sql
-- Reconciled against 10-storage-rental.xlsx (2026-07-16)
-- Run AFTER the foundation module (allowed_users, app_settings, audit_log live there).
-- xlsx AuditLog tab (93 rows, 6-col) imports into the foundation audit_log table.
-- xlsx Reminders tab (0 rows) is superseded by the str_alarms view — skip on import.
-- ============================================================
SET NAMES utf8mb4;

-- ─── 1 · LOTS (inventory from the floor plans) ───────────────
CREATE TABLE IF NOT EXISTS str_lots (
  id         VARCHAR(64) NOT NULL,                -- e.g. 'A-01'
  zone       VARCHAR(64) DEFAULT '',
  floor      VARCHAR(64) DEFAULT '',
  type       VARCHAR(64) DEFAULT 'Standard',      -- Standard / Small / Large
  lockset    VARCHAR(64) DEFAULT '',
  width_mm   DECIMAL(12,2) DEFAULT 0,
  depth_mm   DECIMAL(12,2) DEFAULT 0,
  area_sqm   DECIMAL(12,2) DEFAULT NULL,
  notes      TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 2 · RENTALS / ENGAGEMENTS (client + internal HG use) ────
CREATE TABLE IF NOT EXISTS str_rentals (
  id                VARCHAR(64) NOT NULL DEFAULT (REPLACE(UUID(),'-','')),
  engagement_type   VARCHAR(32) NOT NULL DEFAULT 'Client',  -- Client / Internal
  lot_id            VARCHAR(64) NOT NULL DEFAULT '',
  client_company    VARCHAR(255) DEFAULT '',
  department        VARCHAR(255) DEFAULT '',       -- HG dept (internal use)
  client_pic        VARCHAR(255) DEFAULT '',
  client_contact    VARCHAR(255) DEFAULT '',
  client_email      VARCHAR(255) DEFAULT '',
  start_date        DATE DEFAULT NULL,
  end_date          DATE DEFAULT NULL,             -- null = open-ended (internal)
  monthly_rate      DECIMAL(14,2) DEFAULT 0,
  deposit           DECIMAL(14,2) DEFAULT 0,
  deposit_status    VARCHAR(32) DEFAULT 'None',    -- None / Held / Refunded
  status            VARCHAR(32) DEFAULT 'Active',  -- Active/Expiring/Expired/Vacated/SoldOff/Internal/Released
  notice1_sent      VARCHAR(255) DEFAULT '',       -- stamped by the daily-alarms job
  notice2_sent      VARCHAR(255) DEFAULT '',
  agreement_signed  VARCHAR(32) DEFAULT '',        -- '' / Yes / Pending
  cctv_no           VARCHAR(255) DEFAULT '',
  cctv_url          VARCHAR(512) DEFAULT '',
  items_description TEXT,
  photos_url        TEXT,                          -- pasted external links (comma-separated)
  photo_paths       TEXT,                          -- storage-items paths (comma-separated)
  agreement_path    VARCHAR(512) DEFAULT '',       -- storage-items path of signed agreement
  agreement_url     VARCHAR(512) DEFAULT '',       -- XLSX-ADDED (legacy Drive URL of signed agreement, files not migrating yet)
  handled_by        VARCHAR(255) DEFAULT '',
  remarks           TEXT,
  created_by        VARCHAR(255) DEFAULT '',
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by        VARCHAR(255) DEFAULT '',
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_str_rentals_lot (lot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 3 · INVOICES (with SST) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS str_invoices (
  id             CHAR(36) NOT NULL DEFAULT (UUID()),
  inv_no         VARCHAR(64) NOT NULL,
  rental_id      VARCHAR(64) DEFAULT NULL,          -- was FK → str_rentals(id); null = manual / unlinked; no FK by convention
  lot_id         VARCHAR(64) DEFAULT '',
  client_company VARCHAR(255) NOT NULL,
  inv_date       DATE NOT NULL,
  due_date       DATE DEFAULT NULL,
  period_from    DATE DEFAULT NULL,
  period_to      DATE DEFAULT NULL,
  description    VARCHAR(255) DEFAULT '',
  amount         DECIMAL(14,2) NOT NULL DEFAULT 0,
  sst_enabled    TINYINT(1) DEFAULT 0,
  sst_amount     DECIMAL(14,2) NOT NULL DEFAULT 0,
  total          DECIMAL(14,2) NOT NULL DEFAULT 0,
  amount_paid    DECIMAL(14,2) DEFAULT 0,           -- XLSX-ADDED (denormalised paid total from the GAS sheet; str_payments is the source of truth going forward)
  status         VARCHAR(32) DEFAULT '',            -- '' (live) or 'Void'
  file_path      VARCHAR(512) DEFAULT '',           -- storage-items path (PDF/image)
  file_url       VARCHAR(512) DEFAULT '',           -- XLSX-ADDED (legacy Drive URL, files not migrating yet)
  file_id        VARCHAR(512) DEFAULT '',           -- XLSX-ADDED (legacy Drive file ID, files not migrating yet)
  notes          TEXT,
  created_by     VARCHAR(255) DEFAULT '',
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Supabase had UNIQUE on lower(inv_no); utf8mb4_unicode_ci is case-insensitive,
  -- so a plain UNIQUE covers it. inv_no is system-generated (STR-####) → keep UNIQUE.
  UNIQUE KEY uq_str_invoices_inv_no (inv_no),
  INDEX idx_str_invoices_rental (rental_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 4 · PAYMENTS ────────────────────────────────────────────
-- Supabase FK was ON DELETE CASCADE from str_invoices — no FKs in MySQL,
-- the Express API must delete str_payments rows when deleting an invoice.
CREATE TABLE IF NOT EXISTS str_payments (
  id          CHAR(36) NOT NULL DEFAULT (UUID()),
  invoice_id  CHAR(36) NOT NULL,
  pay_date    DATE NOT NULL,
  amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
  method      VARCHAR(255) DEFAULT '',
  reference   VARCHAR(255) DEFAULT '',
  received_by VARCHAR(255) DEFAULT '',
  notes       TEXT,
  created_by  VARCHAR(255) DEFAULT '',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_str_payments_inv (invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 5 · CONFIG (same keys as the GAS Config sheet) ──────────
CREATE TABLE IF NOT EXISTS str_config (
  `key`   VARCHAR(64) NOT NULL,
  `value` VARCHAR(255) DEFAULT '',
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO str_config (`key`, `value`) VALUES
  ('NOTICE1_DAYS',          '30'),
  ('NOTICE2_DAYS',          '7'),
  ('INVOICE_DUE_SOON_DAYS', '5'),
  ('NEW_CLIENT_DAYS',       '60'),
  ('REMINDER_TO',           ''),
  ('COMPANY_NAME',          'HG Group'),
  ('COMPANY_REG',           ''),
  ('COMPANY_ADDRESS',       ''),
  ('COMPANY_PHONE',         ''),
  ('SST_NO',                ''),
  ('INVOICE_PREFIX',        'STR-'),
  ('INVOICE_SEQ',           '0'),
  ('INVOICE_TERMS_DAYS',    '7'),
  ('AUTO_INVOICE_SST',      '1');

-- ─── 6 · SEED THE 32 LOTS FROM THE FLOOR PLANS ───────────────
-- IF-ABSENT seed only (INSERT IGNORE). Production 10-storage-rental.xlsx
-- Lots tab (32 rows, same ids) is authoritative — import it with upsert/REPLACE.
-- area_sqm precomputed as round(width_mm * depth_mm / 1e6, 2); NULL when 0×0.
INSERT IGNORE INTO str_lots (id, zone, floor, type, lockset, width_mm, depth_mm, area_sqm, notes) VALUES
  ('A-01','A','Ground','Standard','34579',6000,6000,36.00,'verify dimensions on site'),
  ('A-02','A','Ground','Standard','24679',6000,6000,36.00,'verify dimensions on site'),
  ('A-03','A','Ground','Standard','23568',6000,6000,36.00,'verify dimensions on site'),
  ('A-04','A','Ground','Standard','25789',6000,6000,36.00,'labelled "ZONE A B04"; verify dimensions on site'),
  ('A-05','A','Ground','Standard','24590',6000,6000,36.00,'lockset 24590 also on B-S01 — confirm'),
  ('A-06','A','Ground','Standard','24567',6000,6000,36.00,'verify dimensions on site'),
  ('A-07','A','Ground','Standard','12340',6000,6000,36.00,'verify dimensions on site'),
  ('A-08','A','Ground','Standard','45890',6000,6000,36.00,'verify dimensions on site'),
  ('A-09','A','Ground','Standard','12690',6000,6000,36.00,'verify dimensions on site'),
  ('B-01','B','Level 1','Standard','26790',6000,6000,36.00,''),
  ('B-02','B','Level 1','Standard','24568',6000,6000,36.00,''),
  ('B-03','B','Level 1','Standard','12578',6000,6000,36.00,''),
  ('B-04','B','Level 1','Standard','13569',6000,6000,36.00,''),
  ('B-05','B','Level 1','Standard','23569',6000,6000,36.00,''),
  ('B-S01','B','Level 1','Small','24590',0,0,NULL,'lockset 24590 also on A-05 — confirm; verify dimensions on site'),
  ('B-S02','B','Level 1','Small','13789',0,0,NULL,'verify dimensions on site'),
  ('B-S03','B','Level 1','Small','26890',0,0,NULL,'verify dimensions on site'),
  ('B-S04','B','Level 1','Small','36789',0,0,NULL,'verify dimensions on site'),
  ('B-S05','B','Level 1','Small','24689',0,0,NULL,'verify dimensions on site'),
  ('B-S06','B','Level 1','Small','24789',0,0,NULL,'verify dimensions on site'),
  ('B-S07','B','Level 1','Small','24578',0,0,NULL,'verify dimensions on site'),
  ('C-01','C','Level 1','Standard','12689',4765,4700,22.40,''),
  ('C-02','C','Level 1','Standard','13568',6000,4700,28.20,''),
  ('C-03','C','Level 1','Large','12457',6000,7000,42.00,''),
  ('C-04','C','Level 1','Standard','24680',6000,4770,28.62,''),
  ('D-01','D','Level 2','Standard','23590',6000,6000,36.00,''),
  ('D-02','D','Level 2','Standard','23670',6000,6000,36.00,''),
  ('D-03','D','Level 2','Standard','35790',6000,6000,36.00,''),
  ('D-S01','D','Level 2','Small','36780',6000,3000,18.00,''),
  ('D-S02','D','Level 2','Standard','34578',8500,3000,25.50,''),
  ('D-S03','D','Level 2','Small','25680',3000,6000,18.00,''),
  ('D-S04','D','Level 2','Small','13680',4000,6000,24.00,'')
;

-- ─── 7 · ALARMS VIEW (read by the daily-alarms job + the UI) ─
-- Renewal 2-notice engine + overdue-invoice nudges. Translated from the
-- Postgres str_alarms view. Columns: alarm_type, ref, detail, due_date, recipient.
-- DATETIME/DATE store Asia/Kuala_Lumpur local time; CURDATE() assumes the
-- MySQL server (or session time_zone) is on KL time.
CREATE OR REPLACE VIEW str_alarms AS
WITH cfg AS (
  SELECT
    COALESCE((SELECT CAST(NULLIF(`value`,'') AS SIGNED) FROM str_config WHERE `key` = 'NOTICE1_DAYS'), 30)          AS n1,
    COALESCE((SELECT CAST(NULLIF(`value`,'') AS SIGNED) FROM str_config WHERE `key` = 'NOTICE2_DAYS'), 7)           AS n2,
    COALESCE((SELECT CAST(NULLIF(`value`,'') AS SIGNED) FROM str_config WHERE `key` = 'INVOICE_DUE_SOON_DAYS'), 5)  AS due_soon,
    COALESCE((SELECT NULLIF(`value`,'') FROM str_config WHERE `key` = 'REMINDER_TO'), '')                           AS reminder_to
)
-- rentals: expiring within NOTICE1_DAYS, or already expired (sell-off decision)
SELECT
  CASE WHEN r.end_date < CURDATE() THEN 'RENTAL_EXPIRED'
       WHEN DATEDIFF(r.end_date, CURDATE()) <= c.n2 THEN 'RENTAL_NOTICE2'
       ELSE 'RENTAL_NOTICE1' END                                        AS alarm_type,
  CONCAT('Lot ', r.lot_id, ' · ', r.client_company)                     AS ref,
  CASE WHEN r.end_date < CURDATE()
    THEN CONCAT('Expired ', DATEDIFF(CURDATE(), r.end_date), 'd ago — no renewal. Decide: renew / sell-off (items become HG). N1: ',
                COALESCE(NULLIF(r.notice1_sent,''),'—'), ' · N2: ', COALESCE(NULLIF(r.notice2_sent,''),'—'))
    ELSE CONCAT('Expires in ', DATEDIFF(r.end_date, CURDATE()), 'd (', r.start_date, ' → ', r.end_date,
                '). N1: ', COALESCE(NULLIF(r.notice1_sent,''),'—'),
                ' · N2: ', COALESCE(NULLIF(r.notice2_sent,''),'—'),
                CASE WHEN r.client_pic <> '' THEN CONCAT(' · PIC: ', r.client_pic) ELSE '' END)
  END                                                                   AS detail,
  r.end_date                                                            AS due_date,
  CASE WHEN c.reminder_to <> '' THEN c.reminder_to
       WHEN r.handled_by REGEXP '^[^[:space:]]+@[^[:space:]]+\\.[^[:space:]]+$' THEN r.handled_by
       ELSE COALESCE(r.created_by, '') END                              AS recipient
FROM str_rentals r CROSS JOIN cfg c
WHERE r.engagement_type <> 'Internal'
  AND r.status NOT IN ('Vacated','SoldOff','Released')
  AND r.end_date IS NOT NULL
  AND DATEDIFF(r.end_date, CURDATE()) <= c.n1

UNION ALL

-- invoices: unpaid balance, due soon or overdue
SELECT
  CASE WHEN i.due_date < CURDATE() THEN 'INVOICE_OVERDUE' ELSE 'INVOICE_DUE' END,
  CONCAT(i.inv_no, ' · ', i.client_company),
  CONCAT('Balance RM ',
         FORMAT(ROUND(i.total - COALESCE((SELECT ROUND(SUM(p.amount), 2) FROM str_payments p WHERE p.invoice_id = i.id), 0), 2), 2),
         ' (total RM ', FORMAT(i.total, 2), ')',
         CASE WHEN i.due_date < CURDATE() THEN CONCAT(' — overdue ', DATEDIFF(CURDATE(), i.due_date), 'd')
              ELSE CONCAT(' — due in ', DATEDIFF(i.due_date, CURDATE()), 'd') END),
  i.due_date,
  CASE WHEN c.reminder_to <> '' THEN c.reminder_to ELSE COALESCE(i.created_by, '') END
FROM str_invoices i CROSS JOIN cfg c
WHERE i.status <> 'Void'
  AND i.due_date IS NOT NULL
  AND (i.total - COALESCE((SELECT SUM(p.amount) FROM str_payments p WHERE p.invoice_id = i.id), 0)) > 0.005
  AND DATEDIFF(i.due_date, CURDATE()) <= c.due_soon
ORDER BY due_date;

-- ============================================================
-- Phase 2 checklist — functions to port to JS in the Express API
-- ============================================================
-- RPC-PORT: str_generate_monthly(p_month text) — atomic auto monthly invoicing (was GAS generateMonthlyInvoices): validates YYYY-MM, one invoice per active Client rental with monthly_rate > 0 active in that month (skips Internal, Vacated/SoldOff/Released, and rentals already invoiced for the same period_from with status <> 'Void'); sequential STR-#### numbers via str_config INVOICE_PREFIX + INVOICE_SEQ (retries past used numbers, persists the new seq — serialize with a transaction + SELECT ... FOR UPDATE on str_config); SST 6% when AUTO_INVOICE_SST, due date = period start + INVOICE_TERMS_DAYS; logs AUTO_INVOICE per invoice to audit_log; returns {month, count, created[]}.

-- ============================================================
-- Storage buckets → file storage to replicate on cPanel (files stay in
-- Google Drive / Supabase storage until the separate file migration)
--   storage-items/photos/…     — item photos at intake
--   storage-items/agreements/… — signed agreement scans
--   storage-items/invoices/…   — invoice PDFs/images
-- ============================================================
-- BUCKET: storage-items


-- ####### modules/12-transport.sql #######
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


-- ####### modules/13-workers.sql #######
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


-- ####### modules/14-mall-platform.sql #######
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
  req_date      DATE NOT NULL DEFAULT (CURRENT_DATE),
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


-- ####### modules/15-hub-home.sql #######
-- ============================================================
-- HG hub — hub home (Executive + Finance dashboards) (MySQL 8)
-- Translated from supabase/schema-executive-home.sql + supabase/schema-finance-home.sql
-- Reconciled against mysql/xlsx-headers.md (2026-07-16) — no matching tabs;
-- these schemas define no data tables of their own (functions/views only).
-- ============================================================
SET NAMES utf8mb4;

-- ------------------------------------------------------------
-- 1. users.home_mode  (durable Home persona assignment)
--    allowed_users was RETIRED in the cPanel migration — auth now lives in the
--    `users` table (foundation module). home_mode attaches there instead.
--    MySQL 8 has no ADD COLUMN IF NOT EXISTS, so guard via information_schema
--    to keep this file safe to re-run.
-- ------------------------------------------------------------
SET @stmt = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE users ADD COLUMN home_mode VARCHAR(32) NOT NULL DEFAULT ''operations'' CHECK (home_mode IN (''operations'', ''executive''))',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'users'
    AND column_name = 'home_mode'
);
PREPARE add_home_mode FROM @stmt;
EXECUTE add_home_mode;
DEALLOCATE PREPARE add_home_mode;

-- Bootstrap: the two executives (no-op until those users are created).
UPDATE users
SET home_mode = 'executive'
WHERE LOWER(email) IN ('lee@hggroup.com.my', 'marketing@hggroup.com.my');

-- NOTE (Phase 2 / API): in Supabase, INSERT/UPDATE grants on allowed_users
-- excluded home_mode so generic team-access screens could NOT assign or change
-- a Home persona. The Express API must enforce the same rule: home_mode is
-- writable only through an admin-only endpoint (users is already deny-listed
-- in server/rules.js — managed solely via /api/auth/users routes).

-- ------------------------------------------------------------
-- 2. pl_user_roles bootstrap  (table created in the project-pl module)
--    Black and Marketing are the Finance administrators.
-- ------------------------------------------------------------
INSERT INTO pl_user_roles (email, role, notes)
VALUES
  ('lee@hggroup.com.my',       'Admin', 'bootstrap admin'),
  ('marketing@hggroup.com.my', 'Admin', 'bootstrap admin · Finance UI/UX administration')
ON DUPLICATE KEY UPDATE
  role = 'Admin',
  notes = VALUES(notes),
  updated_at = NOW(),
  updated_by = 'schema-finance-home';

-- ------------------------------------------------------------
-- 3. No new tables, no MySQL views kept.
--    hub_pl_project_financials_v1 is a heavy multi-CTE view (FILTER clauses,
--    conditional cost rules, invoice fallback logic) — NOT trivially
--    translatable, ported as an RPC below. Everything else is a
--    jsonb-returning function.
-- ------------------------------------------------------------

-- RPC-PORT: hub_pl_project_financials_v1 (view, one row per project) — per-project financial parity rollup: subtotal from pl_job_scopes (client_amount w/ rate fallback), subcon committed (scope subcon + pl_subcon_charges lump − pl_materials InHouseSubcon deduction), supplier material cost (pl_materials non-InHouseSubcon), manpower cost (pl_manpower), internal cost (OtherDivision scopes), estimated-cost count/value, SST + discount/adjustment → computed invoice total with invoice_amount fallback (invoice_evidence / used_computed_invoice flags), credits/refunds (pl_credit_notes), received (pl_client_payments), paid subcon/supplier (pl_subcon_payments, pl_supplier_payments) → invoiced, net_revenue, total_cost, profit, margin, client/subcontractor/supplier outstanding. Reads: pl_projects, pl_job_scopes, pl_materials, pl_subcon_charges, pl_manpower, pl_client_payments, pl_subcon_payments, pl_supplier_payments, pl_credit_notes.
-- RPC-PORT: hub_my_home_mode() — returns the signed-in user's home_mode ('operations'|'executive') by matching the session email against allowed_users. Reads: allowed_users.
-- RPC-PORT: hub_is_executive() — returns true when the signed-in user's allowed_users row has home_mode = 'executive'; gate check used by hub_executive_home_v1. Reads: allowed_users.
-- RPC-PORT: hub_executive_home_v1(p_as_of date, p_attention_limit int) — protected Executive Home JSON summary (requires hub_is_executive; finance block additionally requires pl_role() in Admin/Manager): snapshot KPIs (open quotations from quotes Draft/Sent; active projects, net revenue MTD, client outstanding, profit MTD + margin from hub_pl_project_financials_v1 rollup), execution counters (dispatch dsp_alarms + dsp_jobs active/permit/at-risk/blocked/ready; workforce wkr_alarms expired/due 7/30 days; scaffold+storage scf_alarms/str_alarms overdue/due; inventory low-stock from inv_materials vs inv_purchase_lines − inv_stock_out_lines on-hand), severity-ranked attention items (loss-making projects, dispatch/workforce/scaffold/storage alarms, low stock; sorted critical→warning→watch, capped at p_attention_limit 1..100), last-25 activity feed mapped to tool names from audit_log, data-quality flags (computed invoice fallback used, missing invoice date), per-domain 'unavailable' fallbacks when a source errors. Reads: allowed_users, quotes, hub_pl_project_financials_v1 (i.e. all pl_* tables above), pl_user_roles (via pl_role), dsp_alarms, dsp_jobs, wkr_alarms, scf_alarms, str_alarms, inv_materials, inv_purchase_lines, inv_stock_out_lines, audit_log.
-- RPC-PORT: hub_finance_home_v1(p_as_of date, p_attention_limit int) — protected Finance Home JSON summary (requires pl_role() in Admin/Manager): portfolio snapshot (client/subcontractor/supplier outstanding, net revenue, project profit, average margin from hub_pl_project_financials_v1, excluding cancelled), attention items (loss-making active projects critical, estimated-cost projects warning, plus invoice due-date alarms from scf_alarms [type invoice], str_alarms [INVOICE_OVERDUE/INVOICE_DUE], trn_alarms [INVOICE_OVERDUE]; severity+due-date+amount ranked, capped at p_attention_limit 1..100), work queues (receivables: project outstanding + overdue operational invoice balances from scf_invoices/scf_payments, str_invoices/str_payments, trn_invoices/trn_payments; payables: subcon/supplier outstanding; claims_expenses: clm_claims submitted + exp_expenses business MTD; invoice_production: sci_invoices MTD + open quotes), last-20 finance-filtered activity feed from audit_log. Reads: pl_user_roles (via pl_role), hub_pl_project_financials_v1 (i.e. all pl_* tables above), scf_alarms, str_alarms, trn_alarms, scf_invoices, scf_payments, str_invoices, str_payments, trn_invoices, trn_payments, clm_claims, exp_expenses, sci_invoices, quotes, audit_log.


-- ####### modules/16-new-finance.sql #######
-- ============================================================
-- HG hub — new finance tools (MySQL 8) — NEW tables (never on Supabase)
-- 05 Accounts Payable, 06 Payments Received, 14 Attendance Evidence,
-- 08 Job Completion Report
-- Reconciled against 05-payable.xlsx / 06-receivable.xlsx /
-- 14-attendance.xlsx / 08-job-report.xlsx (2026-07-16, AUTHORITATIVE)
-- ============================================================
SET NAMES utf8mb4;

-- ------------------------------------------------------------
-- 05 Accounts Payable — PaymentRequests
-- Note: sst_applicable / infotech_keyed hold 'Yes'/'No' strings in
-- production (GAS writes them as text), kept as VARCHAR so import
-- never fails. entry_mode = 'AI-read' | 'Manual'.
-- status = Pending / Approved / On Hold / Rejected / Paid.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ap_payment_requests (
  id                   VARCHAR(64)  NOT NULL,
  created_at           DATETIME     DEFAULT CURRENT_TIMESTAMP,
  submitted_by         VARCHAR(255),
  submitter_name       VARCHAR(255),
  requestor            VARCHAR(255),
  department           VARCHAR(255),
  project              VARCHAR(255),
  payee                VARCHAR(255),
  category             VARCHAR(255),
  invoice_no           VARCHAR(255),
  invoice_date         DATE,
  currency             VARCHAR(8),
  description          TEXT,
  line_items           JSON,
  amount               DECIMAL(14,2),
  sst_applicable       VARCHAR(8),
  sst_amount           DECIMAL(14,2),
  total_amount         DECIMAL(14,2),
  due_date             DATE,
  priority             VARCHAR(32),
  attachments          JSON,
  status               VARCHAR(32),
  approved_by          VARCHAR(255),
  approval_date        DATETIME,
  payment_release_date DATETIME,
  payment_method       VARCHAR(64),
  paid_amount          DECIMAL(14,2),
  outstanding          DECIMAL(14,2),
  infotech_keyed       VARCHAR(8),
  approver_remarks     TEXT,
  entry_mode           VARCHAR(16),
  updated_at           DATETIME,
  bank_name            VARCHAR(255),
  bank_account_name    VARCHAR(255),
  bank_account_no      VARCHAR(64),
  last_action          VARCHAR(255),
  last_action_by       VARCHAR(255),
  request_amount       DECIMAL(14,2),
  PRIMARY KEY (id),
  INDEX idx_ap_req_status     (status),
  INDEX idx_ap_req_department (department),
  INDEX idx_ap_req_payee      (payee),
  INDEX idx_ap_req_invoice_no (invoice_no),
  INDEX idx_ap_req_due_date   (due_date),
  INDEX idx_ap_req_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 05 AuditLog (5-col variant: timestamp | userEmail | action | recordId | details)
CREATE TABLE IF NOT EXISTS ap_audit_log (
  log_id     BIGINT AUTO_INCREMENT NOT NULL,
  timestamp  DATETIME DEFAULT CURRENT_TIMESTAMP,
  user_email VARCHAR(255),
  action     VARCHAR(64),
  record_id  VARCHAR(64),
  details    TEXT,
  PRIMARY KEY (log_id),
  INDEX idx_ap_audit_record_id (record_id),
  INDEX idx_ap_audit_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 06 Payments Received — PaymentsReceived
-- invoices = JSON allocation array. attachments = JSON array.
-- transaction_type = DuitNow / IBG-GIRO / Instant Transfer / RENTAS /
-- Cheque / Cash / Other. status starts 'New' → Verified → Keyed.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ar_payments_received (
  id                    VARCHAR(64)  NOT NULL,
  created_at            DATETIME     DEFAULT CURRENT_TIMESTAMP,
  uploaded_by           VARCHAR(255),
  uploader_name         VARCHAR(255),
  payer_name            VARCHAR(255),
  payer_bank            VARCHAR(255),
  our_account           VARCHAR(255),
  transaction_type      VARCHAR(32),
  reference_no          VARCHAR(255),
  value_date            DATE,
  currency              VARCHAR(8),
  amount                DECIMAL(14,2),
  invoices              JSON,
  invoice_nos_text      TEXT,
  allocated_total       DECIMAL(14,2),
  unallocated           DECIMAL(14,2),
  description           TEXT,
  attachments           JSON,
  status                VARCHAR(32),
  verified_by           VARCHAR(255),
  verified_at           DATETIME,
  keyed_by              VARCHAR(255),
  keyed_at              DATETIME,
  possible_duplicate_of VARCHAR(64),
  remarks               TEXT,
  entry_mode            VARCHAR(16),
  updated_at            DATETIME,
  last_action           VARCHAR(255),
  last_action_by        VARCHAR(255),
  PRIMARY KEY (id),
  INDEX idx_ar_recv_status       (status),
  INDEX idx_ar_recv_payer_name   (payer_name),
  INDEX idx_ar_recv_reference_no (reference_no),
  INDEX idx_ar_recv_value_date   (value_date),
  INDEX idx_ar_recv_dup_of       (possible_duplicate_of),
  INDEX idx_ar_recv_created_at   (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 06 AuditLog (5-col variant: timestamp | userEmail | action | recordId | details)
CREATE TABLE IF NOT EXISTS ar_audit_log (
  log_id     BIGINT AUTO_INCREMENT NOT NULL,
  timestamp  DATETIME DEFAULT CURRENT_TIMESTAMP,
  user_email VARCHAR(255),
  action     VARCHAR(64),
  record_id  VARCHAR(64),
  details    TEXT,
  PRIMARY KEY (log_id),
  INDEX idx_ar_audit_record_id (record_id),
  INDEX idx_ar_audit_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 14 Attendance Evidence — Records
-- 'Photo (Drive ID)' → photo_drive_id (Drive file id, files not
-- migrating yet). thumb = base64 data-URI thumbnail → MEDIUMTEXT.
-- worker/date/time are AI-extracted from the screenshot; `time` kept
-- as VARCHAR (free-text like '08:57 AM').
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS att_records (
  id             VARCHAR(64) NOT NULL,
  file_key       VARCHAR(255),
  file_name      VARCHAR(255),
  added_at       DATETIME    DEFAULT CURRENT_TIMESTAMP,
  keyed_by       VARCHAR(255),
  worker         VARCHAR(255),
  `date`         DATE,
  `time`         VARCHAR(32),
  app            VARCHAR(255),
  verify_code    VARCHAR(255),
  machine_tick   VARCHAR(64),
  verdict        VARCHAR(64),
  exif_check     VARCHAR(255),
  notes          TEXT,
  photo_drive_id VARCHAR(512),
  thumb          MEDIUMTEXT,
  ai_json        JSON,
  exif_json      JSON,
  PRIMARY KEY (id),
  INDEX idx_att_worker   (worker),
  INDEX idx_att_date     (`date`),
  INDEX idx_att_file_key (file_key),
  INDEX idx_att_added_at (added_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 08 Job Completion Report — JCR Summary (one row per JCR)
-- Sheet has NO id column (GAS keys rows off 'Submitted At'), so a
-- surrogate BIGINT AUTO_INCREMENT PK is added. Every xlsx column kept.
-- 'Mall / Site' → mall_site, 'Lorry No.' → lorry_no.
-- Drive Folder / PDF Report are Drive URLs (files not migrating yet).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jcr_reports (
  id                BIGINT AUTO_INCREMENT NOT NULL,
  submitted_at      DATETIME,
  job_date          DATE,
  lot_number        VARCHAR(255),
  trade_name        VARCHAR(255),
  mall_site         VARCHAR(255),
  job_scope         VARCHAR(255),
  status            VARCHAR(64),
  client            VARCHAR(255),
  reference         VARCHAR(255),
  lorry_no          VARCHAR(64),
  lorry_code        VARCHAR(64),
  supervisor        VARCHAR(255),
  hoarding_workers  TEXT,
  visual_supervisor VARCHAR(255),
  visual_workers    TEXT,
  hoarding_type     VARCHAR(255),
  panel             VARCHAR(255),
  door              VARCHAR(255),
  counterweight     VARCHAR(255),
  floor_protection  VARCHAR(255),
  fabric            VARCHAR(255),
  visual_material   VARCHAR(255),
  skirting          VARCHAR(255),
  photo_count       INT,
  remarks           TEXT,
  drive_folder      VARCHAR(512),
  pdf_report        VARCHAR(512),
  submitted_by      VARCHAR(255),
  other_workers     TEXT,
  other_materials   TEXT,
  report_type       VARCHAR(64),
  acknowledgement   VARCHAR(255),
  PRIMARY KEY (id),
  INDEX idx_jcr_submitted_at (submitted_at),
  INDEX idx_jcr_job_date     (job_date),
  INDEX idx_jcr_lot_number   (lot_number),
  INDEX idx_jcr_mall_site    (mall_site),
  INDEX idx_jcr_status       (status),
  INDEX idx_jcr_client       (client)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- No Supabase source → no RPC-PORT items. GAS backends are the Phase 2
-- porting source instead:
--   05 payable:    picklists (requestor/department/priority/category) +
--                  payment methods live in Script Properties, not the sheet.
--   06 receivable: 'our accounts' list lives in Script Properties.
--   08 job-report: dropdown master lists live in Script Properties.
-- Files (attachments, photos, PDFs, thumbs) stay on Google Drive for now.


-- ####### modules/17-job-arrangement.sql #######
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


-- ####### modules/18-library-team-4d.sql #######
-- ============================================================
-- HG hub — hoarding-library + team-command + 4d-tracker (MySQL 8)
-- NEW tables — these three tools never had a Supabase schema.
-- Designed from production xlsx headers (AUTHORITATIVE):
--   16-hoarding-library.xlsx / 18-team-command.xlsx / 25-4d-tracker.xlsx (2026-07-16)
-- + AI-HANDOFF.md §6 notes (16 / 18 / 25).
-- Original string IDs are preserved as natural keys (VARCHAR(64)).
-- No FOREIGN KEYs by convention — plain INDEX on every *_id column.
-- ============================================================
SET NAMES utf8mb4;

-- ════════════════════════════════════════════════════════════
-- 16 · HOARDING MEASUREMENT LIBRARY  (hlib_)
-- ════════════════════════════════════════════════════════════

-- ─── Records (2,899 rows — measurements + MailBot email-scraped) ─
CREATE TABLE IF NOT EXISTS hlib_records (
  id            VARCHAR(64) NOT NULL,               -- xlsx: ID
  lot           VARCHAR(255) DEFAULT '',
  mall          VARCHAR(255) DEFAULT '',
  tenant        VARCHAR(255) DEFAULT '',
  length_m      DECIMAL(10,2) DEFAULT NULL,         -- xlsx: Length (m)
  height_m      DECIMAL(10,2) DEFAULT NULL,         -- xlsx: Height (m)
  area_m2       DECIMAL(12,2) DEFAULT NULL,         -- xlsx: Area (m2)
  panels        INT DEFAULT NULL,                   -- panel count
  door_type     VARCHAR(64) DEFAULT '',
  door_qty      INT DEFAULT NULL,
  door_size     VARCHAR(64) DEFAULT '',             -- free text (e.g. "1.2m x 2.4m")
  drawing_no    VARCHAR(64) DEFAULT '',
  `date`        DATE DEFAULT NULL,
  notes         TEXT,
  drive_file_id VARCHAR(512) DEFAULT '',            -- Drive ID, files not migrating yet
  file_name     VARCHAR(255) DEFAULT '',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  run           VARCHAR(64) DEFAULT '',             -- MailBot run identifier
  group_id      VARCHAR(64) DEFAULT '',             -- groups multi-file records
  files         JSON DEFAULT NULL,                  -- xlsx: Files (JSON) — array of Drive files
  PRIMARY KEY (id),
  INDEX idx_hlib_records_mall_lot (mall, lot),
  INDEX idx_hlib_records_group (group_id),
  INDEX idx_hlib_records_date (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Rates (MASTER — per-mall rate card) ─────────────────────
CREATE TABLE IF NOT EXISTS hlib_rates (
  id      VARCHAR(64) NOT NULL,                     -- xlsx: ID
  mall    VARCHAR(255) DEFAULT '',
  item    VARCHAR(255) DEFAULT '',
  unit    VARCHAR(32) DEFAULT '',
  rate_rm DECIMAL(14,2) DEFAULT 0,                  -- xlsx: Rate (RM)
  PRIMARY KEY (id),
  INDEX idx_hlib_rates_mall (mall)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── MailBotLog (append-only — Gmail→Gemini bot) ─────────────
-- xlsx has no ID column (At | Kind | Message) → surrogate auto-id added.
CREATE TABLE IF NOT EXISTS hlib_mailbot_log (
  id      BIGINT AUTO_INCREMENT,
  at      DATETIME DEFAULT NULL,                    -- xlsx: At
  kind    VARCHAR(64) DEFAULT '',
  message TEXT,
  PRIMARY KEY (id),
  INDEX idx_hlib_mailbot_at (at),
  INDEX idx_hlib_mailbot_kind (kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ════════════════════════════════════════════════════════════
-- 18 · TEAM COMMAND / HG CLOUD  (tc_)
-- DYNAMIC SCHEMA (per handoff §6-18): columns = union of record
-- keys at write time; nested objects live serialized in `_json`.
-- Design: each ENTITY table gets the xlsx columns present today
-- PLUS `_json` JSON holding the full record. The API must
-- JSON-parse `_json` and merge to recover complete records; new
-- record keys land inside `_json` (no ALTERs needed).
-- Empty tabs (no headers exported) get the minimal id + `_json`.
-- settings (key/value) and _SyncLog are not entities → no `_json`.
-- ════════════════════════════════════════════════════════════

-- ─── jobs (3 rows) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tc_jobs (
  id           VARCHAR(64) NOT NULL,
  `no`         VARCHAR(64) DEFAULT '',              -- job number
  service      VARCHAR(64) DEFAULT '',
  invoice_no   VARCHAR(64) DEFAULT '',
  invoice_date DATE DEFAULT NULL,
  status       VARCHAR(64) DEFAULT '',
  client_name  VARCHAR(255) DEFAULT '',
  `value`      DECIMAL(14,2) DEFAULT 0,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by   VARCHAR(255) DEFAULT '',
  updated_at   DATETIME DEFAULT NULL,
  updated_by   VARCHAR(255) DEFAULT '',
  b2b_exempt   TINYINT(1) DEFAULT 0,
  client_type  VARCHAR(64) DEFAULT '',
  `_json`      JSON DEFAULT NULL,                   -- full record incl. nested objects
  PRIMARY KEY (id),
  INDEX idx_tc_jobs_status (status),
  INDEX idx_tc_jobs_invoice_no (invoice_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── scaffoldMaterials (empty tab — no headers exported) ─────
CREATE TABLE IF NOT EXISTS tc_scaffold_materials (
  id         VARCHAR(64) NOT NULL,
  `_json`    JSON DEFAULT NULL,                     -- full record (dynamic schema)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── greenTagLogs (empty tab — no headers exported) ──────────
CREATE TABLE IF NOT EXISTS tc_green_tag_logs (
  id         VARCHAR(64) NOT NULL,
  `_json`    JSON DEFAULT NULL,                     -- full record (dynamic schema)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── rorobinEvents (empty tab — no headers exported) ─────────
-- NOTE handoff transport note: rorobin ops overlap tool 12 (transport);
-- reconcile at import time — schema stays independent here.
CREATE TABLE IF NOT EXISTS tc_rorobin_events (
  id         VARCHAR(64) NOT NULL,
  `_json`    JSON DEFAULT NULL,                     -- full record (dynamic schema)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── storageReminders (empty tab — no headers exported) ──────
CREATE TABLE IF NOT EXISTS tc_storage_reminders (
  id         VARCHAR(64) NOT NULL,
  `_json`    JSON DEFAULT NULL,                     -- full record (dynamic schema)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── hoardingQuotes (empty tab — no headers exported) ────────
CREATE TABLE IF NOT EXISTS tc_hoarding_quotes (
  id         VARCHAR(64) NOT NULL,
  `_json`    JSON DEFAULT NULL,                     -- full record (dynamic schema)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── expenses (3 rows) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS tc_expenses (
  id            VARCHAR(64) NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  amount        DECIMAL(14,2) DEFAULT 0,
  category      VARCHAR(64) DEFAULT '',
  `date`        DATE DEFAULT NULL,
  description   TEXT,
  linked_job_id VARCHAR(64) DEFAULT '',             -- → tc_jobs.id (no FK by convention)
  paid_via      VARCHAR(64) DEFAULT '',
  `_json`       JSON DEFAULT NULL,                  -- full record (dynamic schema)
  PRIMARY KEY (id),
  INDEX idx_tc_expenses_linked_job (linked_job_id),
  INDEX idx_tc_expenses_date (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── clients (5 rows, MASTER) ────────────────────────────────
CREATE TABLE IF NOT EXISTS tc_clients (
  id            VARCHAR(64) NOT NULL,
  b2b_exempt    TINYINT(1) DEFAULT 0,
  contact_email VARCHAR(255) DEFAULT '',
  contact_name  VARCHAR(255) DEFAULT '',
  contact_tel   VARCHAR(64) DEFAULT '',
  name          VARCHAR(255) DEFAULT '',
  notes         TEXT,
  type          VARCHAR(64) DEFAULT '',
  `_json`       JSON DEFAULT NULL,                  -- full record (dynamic schema)
  PRIMARY KEY (id),
  INDEX idx_tc_clients_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── sites (3 rows, MASTER) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS tc_sites (
  id      VARCHAR(64) NOT NULL,
  address TEXT,
  name    VARCHAR(255) DEFAULT '',
  `_json` JSON DEFAULT NULL,                        -- full record (dynamic schema)
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── team (6 rows, MASTER) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS tc_team (
  id       VARCHAR(64) NOT NULL,
  category VARCHAR(64) DEFAULT '',
  name     VARCHAR(255) DEFAULT '',
  role     VARCHAR(64) DEFAULT '',
  tel      VARCHAR(64) DEFAULT '',
  `_json`  JSON DEFAULT NULL,                       -- full record (dynamic schema)
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── lorries (3 rows, MASTER) ────────────────────────────────
CREATE TABLE IF NOT EXISTS tc_lorries (
  id       VARCHAR(64) NOT NULL,
  capacity VARCHAR(64) DEFAULT '',                  -- free text ("1 ton" etc.)
  category VARCHAR(64) DEFAULT '',
  code     VARCHAR(64) DEFAULT '',
  notes    TEXT,
  plate_no VARCHAR(32) DEFAULT '',
  type     VARCHAR(64) DEFAULT '',
  `_json`  JSON DEFAULT NULL,                       -- full record (dynamic schema)
  PRIMARY KEY (id),
  INDEX idx_tc_lorries_plate (plate_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── settings (key/value — not an entity, no _json) ──────────
CREATE TABLE IF NOT EXISTS tc_settings (
  `key`   VARCHAR(128) NOT NULL,
  `value` TEXT,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── _SyncLog (81 rows, append-only — not an entity, no _json)
-- xlsx has no ID column → surrogate auto-id added.
CREATE TABLE IF NOT EXISTS tc_sync_log (
  id            BIGINT AUTO_INCREMENT,
  `timestamp`   DATETIME DEFAULT NULL,
  `user`        VARCHAR(255) DEFAULT '',
  action        VARCHAR(64) DEFAULT '',
  job_count     INT DEFAULT 0,
  total_records INT DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_tc_sync_log_ts (`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ════════════════════════════════════════════════════════════
-- 25 · 4D TRACKER  (fd_)  — personal, nightly scraper
-- xlsx "Sheet1" is an empty default tab → SKIPPED (per handoff §9-6).
-- ════════════════════════════════════════════════════════════

-- ─── Results (3,578 rows — one draw per row) ─────────────────
-- xlsx has no ID column → surrogate auto-id added.
-- Prize numbers are 4-digit strings — leading zeros matter, and
-- scrapes may contain placeholders ("----") → VARCHAR(8), not INT.
-- No UNIQUE on (date, draw_no): production data wins; scraper
-- re-runs must not fail the import. Plain indexes instead.
CREATE TABLE IF NOT EXISTS fd_results (
  id      BIGINT AUTO_INCREMENT,
  `date`  DATE DEFAULT NULL,
  draw_no VARCHAR(32) DEFAULT '',                   -- e.g. "123/26" — keep as text
  p1      VARCHAR(8) DEFAULT '',                    -- 1st prize
  p2      VARCHAR(8) DEFAULT '',                    -- 2nd prize
  p3      VARCHAR(8) DEFAULT '',                    -- 3rd prize
  s1      VARCHAR(8) DEFAULT '',                    -- special 1..10
  s2      VARCHAR(8) DEFAULT '',
  s3      VARCHAR(8) DEFAULT '',
  s4      VARCHAR(8) DEFAULT '',
  s5      VARCHAR(8) DEFAULT '',
  s6      VARCHAR(8) DEFAULT '',
  s7      VARCHAR(8) DEFAULT '',
  s8      VARCHAR(8) DEFAULT '',
  s9      VARCHAR(8) DEFAULT '',
  s10     VARCHAR(8) DEFAULT '',
  c1      VARCHAR(8) DEFAULT '',                    -- consolation 1..10
  c2      VARCHAR(8) DEFAULT '',
  c3      VARCHAR(8) DEFAULT '',
  c4      VARCHAR(8) DEFAULT '',
  c5      VARCHAR(8) DEFAULT '',
  c6      VARCHAR(8) DEFAULT '',
  c7      VARCHAR(8) DEFAULT '',
  c8      VARCHAR(8) DEFAULT '',
  c9      VARCHAR(8) DEFAULT '',
  c10     VARCHAR(8) DEFAULT '',
  PRIMARY KEY (id),
  INDEX idx_fd_results_date (`date`),
  INDEX idx_fd_results_draw_no (draw_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Phase 2 checklists ──────────────────────────────────────
-- RPC-PORT: (none — these three tools have no Supabase schema; all logic
--            lives in Apps Script Code.gs and is ported directly to Express.)
-- NOTE Phase 2 (team-command API): write path must merge typed columns +
--            `_json` on read, and route unknown record keys into `_json`
--            on write (replaces the Apps Script header-union behavior).
-- NOTE Phase 2 (hoarding-library): MailBot (Gmail→Gemini) writes
--            hlib_records + hlib_mailbot_log — needs a new ingest endpoint.
-- BUCKET: (none — Drive file IDs/URLs kept as-is, files not migrating yet)

