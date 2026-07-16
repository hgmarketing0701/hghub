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
