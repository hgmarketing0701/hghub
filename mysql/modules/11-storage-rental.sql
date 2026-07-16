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
