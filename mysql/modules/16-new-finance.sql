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
