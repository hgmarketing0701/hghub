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
