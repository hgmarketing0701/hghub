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
