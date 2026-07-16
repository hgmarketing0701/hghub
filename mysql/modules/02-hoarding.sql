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
