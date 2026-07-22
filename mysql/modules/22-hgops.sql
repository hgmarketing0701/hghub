-- ============================================================
-- HG Ops v1 — invoice → confirmed jobs → arrange → proof → wages
-- ja_invoices (confirmed client invoices, AI-read), job links,
-- lightweight completion proofs, no-login proof tokens.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS ja_invoices (
  id          CHAR(36) NOT NULL DEFAULT (uuid()),
  invoice_no  VARCHAR(64)  DEFAULT '',
  client      VARCHAR(255) DEFAULT '',
  mall        VARCHAR(255) DEFAULT '',
  amount      DECIMAL(14,2) NULL,
  sst         DECIMAL(14,2) NULL,
  file_url    VARCHAR(512) DEFAULT '',
  ai_json     JSON NULL,                        -- raw AI extraction (audit/debug)
  status      VARCHAR(24) NOT NULL DEFAULT 'confirmed',  -- confirmed | payment_received
  notes       TEXT,
  uploaded_by VARCHAR(255) DEFAULT '',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_jinv_no (invoice_no),
  INDEX idx_jinv_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- lightweight per-job completion proof (photo evidence from site)
CREATE TABLE IF NOT EXISTS ja_job_completions (
  id             BIGINT AUTO_INCREMENT,
  job_id         VARCHAR(64) NOT NULL,
  submitted_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  submitted_name VARCHAR(255) DEFAULT '',       -- free text (no login yet)
  photos         JSON NULL,                     -- array of public URLs
  notes          TEXT,
  via_token      VARCHAR(64) DEFAULT '',
  PRIMARY KEY (id),
  INDEX idx_jjc_job (job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- no-login proof-upload links (token IS the auth; minted by staff, WhatsApp'd to site)
CREATE TABLE IF NOT EXISTS ja_proof_tokens (
  token      VARCHAR(64) NOT NULL,
  job_id     VARCHAR(64) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NULL,
  used_at    DATETIME NULL,
  created_by VARCHAR(255) DEFAULT '',
  PRIMARY KEY (token),
  INDEX idx_jpt_job (job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ja_jobs: link to invoice + flow status ('' legacy renders as confirmed)
SET @s := (SELECT IF(COUNT(*)=0,
  'ALTER TABLE ja_jobs ADD COLUMN invoice_id VARCHAR(64) DEFAULT '''', ADD INDEX idx_jaj_inv (invoice_id)',
  'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='ja_jobs' AND column_name='invoice_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*)=0,
  'ALTER TABLE ja_jobs ADD COLUMN job_status VARCHAR(24) DEFAULT ''''',
  'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='ja_jobs' AND column_name='job_status');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
