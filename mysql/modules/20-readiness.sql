-- ============================================================
-- HG hub — Job-spine slice 1: readiness satellite for ja_jobs
-- One optional row per ja_jobs.id carrying the readiness gates +
-- night-dispatch loading previously kept in dsp_jobs/dsp_teams.
-- ja_jobs itself is untouched (wages/history safe). dsp_* frozen.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS ja_job_readiness (
  job_id             VARCHAR(64) NOT NULL,          -- = ja_jobs.id
  -- readiness gates (same semantics as the old dsp_jobs columns)
  measure_status     VARCHAR(32) DEFAULT 'pending', -- pending | sketch_done | not_required
  sketch_url         VARCHAR(512) DEFAULT '',
  quote_status       VARCHAR(32) DEFAULT 'pending', -- pending | sent | confirmed | not_required
  quote_ref          VARCHAR(128) DEFAULT '',
  needs_visual       VARCHAR(8)  DEFAULT 'no',      -- yes | no
  visual_status      VARCHAR(32) DEFAULT 'pending', -- pending | in_progress | approved
  visual_url         VARCHAR(512) DEFAULT '',
  permit_by          VARCHAR(32) DEFAULT '',        -- us | client | already_have | not_required
  permit_status      VARCHAR(32) DEFAULT 'pending', -- pending | applied | approved | not_required
  permit_url         VARCHAR(512) DEFAULT '',
  permit_approved_at DATETIME NULL,
  material_ready     VARCHAR(8)  DEFAULT 'no',      -- yes | no
  material_notes     TEXT,
  -- night-dispatch loading (was dsp_jobs.dispatch_date/team_no/seq)
  dispatch_date      DATE NULL,
  team_no            VARCHAR(16) DEFAULT '',
  seq                INT NULL,
  notes              TEXT,
  updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by         VARCHAR(255) DEFAULT '',
  PRIMARY KEY (job_id),
  INDEX idx_jjr_dispatch (dispatch_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- permit early-warning over the REAL schedule (replaces the old dsp_alarms view
-- for cron daily-alarms + Executive Home; same column shape)
CREATE OR REPLACE VIEW jjr_alarms AS
SELECT
  'permit'                                                        AS alarm_type,
  CONCAT(j.mall, CASE WHEN COALESCE(j.lot,'') <> '' THEN CONCAT(' — ', j.lot) ELSE '' END) AS ref,
  CONCAT('Permit not ready (', COALESCE(NULLIF(r.permit_status,''),'pending'),
         ') — install ', DATE_FORMAT(j.date, '%d %b'))            AS detail,
  j.date                                                          AS due_date
FROM ja_jobs j
JOIN ja_job_readiness r ON r.job_id = j.id
WHERE NOT (r.permit_status IN ('approved','not_required')
           OR r.permit_by IN ('already_have','not_required'))
  AND j.date IS NOT NULL
  AND j.date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 3 DAY);
